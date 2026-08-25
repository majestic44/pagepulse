import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

type CheckOutcomeConnection = Pick<
  PoolConnection,
  'beginTransaction' | 'commit' | 'query' | 'release' | 'rollback'
>;

export type CheckOutcomePool = Pick<Pool, 'getConnection'>;

export type SnapshotRecord = Readonly<{
  byteSize: number;
  checkId: string;
  checksum: string;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  mediaType: string;
  monitorId: string;
  storageKey: string;
}>;

export type SuccessfulCheckInput = Readonly<{
  checkId: string;
  completedAt: Date;
  contentHash: string;
  correlationId: string;
  expiresAt: Date;
  monitorId: string;
  monitorRevision: number;
  snapshot: Omit<SnapshotRecord, 'checkId' | 'createdAt' | 'monitorId'>;
  startedAt: Date;
}>;

export type FailedCheckInput = Readonly<{
  checkId: string;
  completedAt: Date;
  correlationId: string;
  expiresAt: Date;
  failureCode: string;
  monitorId: string;
  monitorRevision: number;
  startedAt: Date;
}>;

export type ExpiredSnapshot = Pick<SnapshotRecord, 'id' | 'storageKey'>;

export class CheckOutcomeValidationError extends Error {
  constructor(message: string) {
    super(`Check outcome is invalid: ${message}`);
    this.name = 'CheckOutcomeValidationError';
  }
}

function validateIdentifier(value: string, field: string, maximumLength = 128) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    !identifierPattern.test(value)
  ) {
    throw new CheckOutcomeValidationError(`${field} is invalid`);
  }
}

function validateDate(value: Date, field: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new CheckOutcomeValidationError(`${field} is invalid`);
  }
}

function validatePositiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CheckOutcomeValidationError(`${field} is invalid`);
  }
}

function validateSha256(value: string, field: string) {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    throw new CheckOutcomeValidationError(`${field} is invalid`);
  }
}

function validateStorageKey(value: string) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new CheckOutcomeValidationError('snapshot storageKey is invalid');
  }
}

function validateSnapshot(snapshot: SuccessfulCheckInput['snapshot']) {
  validateIdentifier(snapshot.id, 'snapshot id', 36);
  validateStorageKey(snapshot.storageKey);
  validateSha256(snapshot.checksum, 'snapshot checksum');
  validatePositiveInteger(snapshot.byteSize, 'snapshot byteSize');
  if (
    typeof snapshot.mediaType !== 'string' ||
    snapshot.mediaType.length === 0 ||
    snapshot.mediaType.length > 128
  ) {
    throw new CheckOutcomeValidationError('snapshot mediaType is invalid');
  }
  validateDate(snapshot.expiresAt, 'snapshot expiresAt');
}

function validateSuccessfulInput(input: SuccessfulCheckInput) {
  validateIdentifier(input.checkId, 'checkId', 36);
  validateIdentifier(input.monitorId, 'monitorId', 36);
  validateIdentifier(input.correlationId, 'correlationId');
  validatePositiveInteger(input.monitorRevision, 'monitorRevision');
  validateSha256(input.contentHash, 'contentHash');
  validateDate(input.startedAt, 'startedAt');
  validateDate(input.completedAt, 'completedAt');
  validateDate(input.expiresAt, 'expiresAt');
  validateSnapshot(input.snapshot);
}

function validateFailedInput(input: FailedCheckInput) {
  validateIdentifier(input.checkId, 'checkId', 36);
  validateIdentifier(input.monitorId, 'monitorId', 36);
  validateIdentifier(input.correlationId, 'correlationId');
  validatePositiveInteger(input.monitorRevision, 'monitorRevision');
  validateIdentifier(input.failureCode, 'failureCode', 64);
  validateDate(input.startedAt, 'startedAt');
  validateDate(input.completedAt, 'completedAt');
  validateDate(input.expiresAt, 'expiresAt');
}

async function withTransaction<T>(
  pool: CheckOutcomePool,
  operation: (connection: CheckOutcomeConnection) => Promise<T>,
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    try {
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original persistence failure.
      }
      throw error;
    }
  } finally {
    connection.release();
  }
}

async function checkAlreadyRecorded(
  connection: Pick<CheckOutcomeConnection, 'query'>,
  checkId: string,
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT id FROM checks WHERE id = ? LIMIT 1 FOR UPDATE',
    [checkId],
  );
  return rows.length > 0;
}

type PreviousSnapshot = Readonly<{
  contentHash: string;
  id: string;
}>;

async function previousSuccessfulSnapshot(
  connection: Pick<CheckOutcomeConnection, 'query'>,
  monitorId: string,
  monitorRevision: number,
): Promise<PreviousSnapshot | undefined> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT snapshots.id, checks.content_hash AS contentHash
     FROM snapshots
     INNER JOIN checks ON checks.id = snapshots.check_id
     WHERE snapshots.monitor_id = ?
       AND checks.monitor_revision = ?
       AND checks.result = 'succeeded'
     ORDER BY checks.completed_at DESC, snapshots.id DESC
     LIMIT 1 FOR UPDATE`,
    [monitorId, monitorRevision],
  );
  const row = rows[0];
  if (!row || typeof row.id !== 'string' || typeof row.contentHash !== 'string') {
    return undefined;
  }
  validateIdentifier(row.id, 'previous snapshot id', 36);
  validateSha256(row.contentHash, 'previous snapshot contentHash');
  return { contentHash: row.contentHash, id: row.id };
}

async function establishRuleBaseline(
  connection: Pick<CheckOutcomeConnection, 'query'>,
  monitorId: string,
  monitorRevision: number,
) {
  await connection.query(
    `INSERT INTO monitor_rules (
       monitor_id, monitor_revision, configuration, baseline_state, baseline_revision
     ) VALUES (?, ?, ?, 'established', ?)
     ON DUPLICATE KEY UPDATE
       baseline_state = IF(
         monitor_rules.monitor_revision = VALUES(monitor_revision)
         AND monitor_rules.baseline_state = 'pending',
         'established',
         monitor_rules.baseline_state
       )`,
    [
      monitorId,
      monitorRevision,
      JSON.stringify({ newItem: false, textChange: true }),
      monitorRevision,
    ],
  );
}

export async function recordSuccessfulCheck(pool: CheckOutcomePool, input: SuccessfulCheckInput) {
  validateSuccessfulInput(input);
  return withTransaction(pool, async (connection) => {
    if (await checkAlreadyRecorded(connection, input.checkId)) {
      return { recorded: false as const };
    }
    const previous = await previousSuccessfulSnapshot(
      connection,
      input.monitorId,
      input.monitorRevision,
    );
    await connection.query(
      `INSERT INTO checks (
        id, monitor_id, monitor_revision, correlation_id, result, failure_code, content_hash,
        started_at, completed_at, expires_at
      ) VALUES (?, ?, ?, ?, 'succeeded', NULL, ?, ?, ?, ?)`,
      [
        input.checkId,
        input.monitorId,
        input.monitorRevision,
        input.correlationId,
        input.contentHash,
        input.startedAt,
        input.completedAt,
        input.expiresAt,
      ],
    );
    await connection.query(
      `INSERT INTO snapshots (
        id, check_id, monitor_id, storage_key, checksum, byte_size, media_type, confidential, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'yes', ?, ?)`,
      [
        input.snapshot.id,
        input.checkId,
        input.monitorId,
        input.snapshot.storageKey,
        input.snapshot.checksum,
        input.snapshot.byteSize,
        input.snapshot.mediaType,
        input.snapshot.expiresAt,
        input.completedAt,
      ],
    );
    await establishRuleBaseline(connection, input.monitorId, input.monitorRevision);
    if (previous && previous.contentHash !== input.contentHash) {
      await connection.query(
        `INSERT INTO changes (
           id, monitor_id, previous_snapshot_id, current_snapshot_id, summary, state, reviewed_at, created_at
         ) VALUES (?, ?, ?, ?, 'Extracted content changed', 'pending', NULL, ?)`,
        [input.checkId, input.monitorId, previous.id, input.snapshot.id, input.completedAt],
      );
    }
    return {
      recorded: true as const,
      reviewCreated: previous !== undefined && previous.contentHash !== input.contentHash,
    };
  });
}

export async function recordFailedCheck(pool: CheckOutcomePool, input: FailedCheckInput) {
  validateFailedInput(input);
  return withTransaction(pool, async (connection) => {
    if (await checkAlreadyRecorded(connection, input.checkId)) {
      return { recorded: false as const };
    }
    await connection.query(
      `INSERT INTO checks (
        id, monitor_id, monitor_revision, correlation_id, result, failure_code, content_hash,
        started_at, completed_at, expires_at
      ) VALUES (?, ?, ?, ?, 'failed', ?, NULL, ?, ?, ?)`,
      [
        input.checkId,
        input.monitorId,
        input.monitorRevision,
        input.correlationId,
        input.failureCode,
        input.startedAt,
        input.completedAt,
        input.expiresAt,
      ],
    );
    return { recorded: true as const };
  });
}

export async function listExpiredSnapshots(
  connection: Pick<CheckOutcomeConnection, 'query'>,
  now = new Date(),
  limit = 100,
): Promise<ReadonlyArray<ExpiredSnapshot>> {
  validateDate(now, 'now');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new CheckOutcomeValidationError('purge limit is invalid');
  }
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, storage_key AS storageKey FROM snapshots
     WHERE expires_at <= ? ORDER BY expires_at ASC, id ASC LIMIT ${limit}`,
    [now],
  );
  return rows.map((row) => ({
    id: String(row.id),
    storageKey: String(row.storageKey),
  }));
}

export async function removeExpiredSnapshotRecord(
  connection: Pick<CheckOutcomeConnection, 'query'>,
  snapshotId: string,
  now = new Date(),
) {
  validateIdentifier(snapshotId, 'snapshotId', 36);
  validateDate(now, 'now');
  const [result] = await connection.query<ResultSetHeader>(
    'DELETE FROM snapshots WHERE id = ? AND expires_at <= ?',
    [snapshotId, now],
  );
  return result.affectedRows;
}

export async function purgeExpiredChecks(
  connection: Pick<CheckOutcomeConnection, 'query'>,
  now = new Date(),
  limit = 1_000,
) {
  validateDate(now, 'now');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new CheckOutcomeValidationError('purge limit is invalid');
  }
  const [result] = await connection.query<ResultSetHeader>(
    `DELETE FROM checks WHERE expires_at <= ? ORDER BY expires_at ASC, id ASC LIMIT ${limit}`,
    [now],
  );
  return result.affectedRows;
}
