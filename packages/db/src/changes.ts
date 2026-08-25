import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { MonitorNotFoundError } from './monitors.js';

type ChangeConnection = Pick<PoolConnection, 'query'>;

export type ChangeReviewState = 'expected' | 'ignored' | 'pending';

export type ChangeReview = Readonly<{
  createdAt: Date;
  current: Readonly<{ id: string; storageKey: string }>;
  id: string;
  monitor: Readonly<{ id: string; name: string }>;
  previous: Readonly<{ id: string; storageKey: string }>;
  reviewedAt: Date | null;
  state: ChangeReviewState;
  summary: string;
}>;

export class ChangeReviewConflictError extends Error {
  constructor() {
    super('The change has already been reviewed');
    this.name = 'ChangeReviewConflictError';
  }
}

export class ChangeReviewInputError extends Error {
  constructor(message: string) {
    super(`Change review input is invalid: ${message}`);
    this.name = 'ChangeReviewInputError';
  }
}

function record(row: RowDataPacket): Record<string, unknown> {
  return row;
}

function readString(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error(`Change review data is invalid: ${key}`);
  }
  return field;
}

function readDate(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (!(field instanceof Date) || Number.isNaN(field.getTime())) {
    throw new Error(`Change review data is invalid: ${key}`);
  }
  return field;
}

function readNullableDate(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (field === null) {
    return null;
  }
  return readDate(value, key);
}

function readState(value: Record<string, unknown>, key: string): ChangeReviewState {
  const field = readString(value, key);
  if (field !== 'pending' && field !== 'expected' && field !== 'ignored') {
    throw new Error(`Change review data is invalid: ${key}`);
  }
  return field;
}

function validateIdentifier(value: string, field: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/u.test(value)) {
    throw new ChangeReviewInputError(`${field} is invalid`);
  }
}

function toChangeReview(row: RowDataPacket): ChangeReview {
  const value = record(row);
  return {
    createdAt: readDate(value, 'createdAt'),
    current: {
      id: readString(value, 'currentSnapshotId'),
      storageKey: readString(value, 'currentStorageKey'),
    },
    id: readString(value, 'id'),
    monitor: { id: readString(value, 'monitorId'), name: readString(value, 'monitorName') },
    previous: {
      id: readString(value, 'previousSnapshotId'),
      storageKey: readString(value, 'previousStorageKey'),
    },
    reviewedAt: readNullableDate(value, 'reviewedAt'),
    state: readState(value, 'state'),
    summary: readString(value, 'summary'),
  };
}

const changeSelect = `SELECT changes.id, changes.summary, changes.state,
  changes.reviewed_at AS reviewedAt, changes.created_at AS createdAt,
  monitors.id AS monitorId, monitors.name AS monitorName,
  previous_snapshot.id AS previousSnapshotId, previous_snapshot.storage_key AS previousStorageKey,
  current_snapshot.id AS currentSnapshotId, current_snapshot.storage_key AS currentStorageKey
  FROM changes
  INNER JOIN monitors ON monitors.id = changes.monitor_id
  INNER JOIN snapshots AS previous_snapshot ON previous_snapshot.id = changes.previous_snapshot_id
  INNER JOIN snapshots AS current_snapshot ON current_snapshot.id = changes.current_snapshot_id`;

export async function listOwnedChangeReviews(
  connection: ChangeConnection,
  ownerId: string,
  limit = 100,
): Promise<ReadonlyArray<ChangeReview>> {
  validateIdentifier(ownerId, 'ownerId');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ChangeReviewInputError('limit is invalid');
  }
  const [rows] = await connection.query<RowDataPacket[]>(
    `${changeSelect}
     WHERE monitors.owner_id = ?
     ORDER BY changes.created_at DESC, changes.id DESC
     LIMIT ${limit}`,
    [ownerId],
  );
  return rows.map(toChangeReview);
}

export async function resolveOwnedChangeReview(
  connection: ChangeConnection,
  ownerId: string,
  changeId: string,
  state: Exclude<ChangeReviewState, 'pending'>,
  now = new Date(),
): Promise<ChangeReview> {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(changeId, 'changeId');
  if (state !== 'expected' && state !== 'ignored') {
    throw new ChangeReviewInputError('state is invalid');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ChangeReviewInputError('reviewedAt is invalid');
  }
  const [result] = await connection.query<ResultSetHeader>(
    `UPDATE changes
     INNER JOIN monitors ON monitors.id = changes.monitor_id
     SET changes.state = ?, changes.reviewed_at = ?
     WHERE changes.id = ? AND monitors.owner_id = ? AND changes.state = 'pending'`,
    [state, now, changeId, ownerId],
  );
  if (result.affectedRows === 0) {
    const [rows] = await connection.query<RowDataPacket[]>(
      `${changeSelect}
       WHERE changes.id = ? AND monitors.owner_id = ?
       LIMIT 1`,
      [changeId, ownerId],
    );
    if (!rows[0]) {
      throw new MonitorNotFoundError();
    }
    throw new ChangeReviewConflictError();
  }
  const [rows] = await connection.query<RowDataPacket[]>(
    `${changeSelect}
     WHERE changes.id = ? AND monitors.owner_id = ?
     LIMIT 1`,
    [changeId, ownerId],
  );
  if (!rows[0]) {
    throw new Error('Change review was not available after resolution');
  }
  return toChangeReview(rows[0]);
}
