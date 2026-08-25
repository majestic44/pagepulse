import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import {
  MonitorRuleValidationError,
  normalizeMonitorRuleConfiguration,
  type MonitorRuleConfiguration,
  type NormalizedMonitorRuleConfiguration,
} from '@pagepulse/monitor-engine';

import {
  MonitorNotFoundError,
  MonitorRevisionConflictError,
  type Monitor,
  type MonitorPool,
} from './monitors.js';

type MonitorRuleConnection = Pick<PoolConnection, 'query'>;

export type MonitorRules = Readonly<{
  baseline: Readonly<{ revision: number; state: 'established' | 'pending' }>;
  configuration: NormalizedMonitorRuleConfiguration;
}>;

export type MonitorRulesWithMonitor = Readonly<{
  monitor: Monitor;
  rules: MonitorRules;
}>;

export { MonitorRuleValidationError, type MonitorRuleConfiguration };

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Monitor rule data is invalid: ${key}`);
  }
  return value;
}

function readInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Monitor rule data is invalid: ${key}`);
  }
  return value;
}

function readDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Monitor rule data is invalid: ${key}`);
  }
  return value;
}

function readMonitor(row: RowDataPacket): Monitor {
  const record = asRecord(row);
  const state = readString(record, 'state');
  if (!['active', 'authentication_required', 'blocked', 'paused'].includes(state)) {
    throw new Error('Monitor rule data is invalid: state');
  }
  return {
    createdAt: readDate(record, 'createdAt'),
    id: readString(record, 'id'),
    name: readString(record, 'name'),
    revision: readInteger(record, 'revision'),
    state: state as Monitor['state'],
    url: readString(record, 'url'),
  };
}

function validateIdentifier(value: string, field: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/u.test(value)) {
    throw new MonitorRuleValidationError(`${field} is invalid`);
  }
}

function validateRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MonitorRuleValidationError('revision is invalid');
  }
}

function configurationInput(
  configuration: NormalizedMonitorRuleConfiguration,
): MonitorRuleConfiguration {
  return {
    ...(configuration.keyword === null ? {} : { keyword: configuration.keyword }),
    newItem: configuration.newItem,
    textChange: configuration.textChange,
  };
}

function readConfiguration(value: unknown): NormalizedMonitorRuleConfiguration {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('Monitor rule data is invalid: configuration');
    }
  }
  try {
    return normalizeMonitorRuleConfiguration(parsed as MonitorRuleConfiguration);
  } catch {
    throw new Error('Monitor rule data is invalid: configuration');
  }
}

function readRules(row: RowDataPacket): MonitorRules {
  const record = asRecord(row);
  const state = readString(record, 'baselineState');
  if (state !== 'pending' && state !== 'established') {
    throw new Error('Monitor rule data is invalid: baselineState');
  }
  return {
    baseline: { revision: readInteger(record, 'baselineRevision'), state },
    configuration: readConfiguration(record.configuration),
  };
}

async function findOwnedMonitor(
  connection: MonitorRuleConnection,
  ownerId: string,
  monitorId: string,
  forUpdate: boolean,
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, name, url, state, revision, created_at AS createdAt
     FROM monitors
     WHERE id = ? AND owner_id = ?
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [monitorId, ownerId],
  );
  if (!rows[0]) {
    throw new MonitorNotFoundError();
  }
  return readMonitor(rows[0]);
}

function defaultRules(monitor: Monitor): MonitorRules {
  return {
    baseline: { revision: monitor.revision, state: 'pending' },
    configuration: { keyword: null, newItem: false, textChange: true },
  };
}

export async function getMonitorRules(
  connection: MonitorRuleConnection,
  ownerId: string,
  monitorId: string,
): Promise<MonitorRulesWithMonitor> {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const monitor = await findOwnedMonitor(connection, ownerId, monitorId, false);
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT configuration, baseline_state AS baselineState, baseline_revision AS baselineRevision
     FROM monitor_rules WHERE monitor_id = ? LIMIT 1`,
    [monitorId],
  );
  return { monitor, rules: rows[0] ? readRules(rows[0]) : defaultRules(monitor) };
}

export async function upsertOwnedMonitorRules(
  connection: MonitorRuleConnection,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
  configuration: MonitorRuleConfiguration,
): Promise<MonitorRulesWithMonitor> {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  validateRevision(expectedRevision);
  const normalized = normalizeMonitorRuleConfiguration(configuration);
  const monitor = await findOwnedMonitor(connection, ownerId, monitorId, true);
  if (monitor.revision !== expectedRevision) {
    throw new MonitorRevisionConflictError();
  }
  if (normalized.newItem) {
    const [targetRows] = await connection.query<RowDataPacket[]>(
      `SELECT item_selector AS itemSelector, identity_selector AS identitySelector
       FROM monitor_targets WHERE monitor_id = ? LIMIT 1`,
      [monitorId],
    );
    const target = targetRows[0] ? asRecord(targetRows[0]) : undefined;
    if (
      !target ||
      typeof target.itemSelector !== 'string' ||
      typeof target.identitySelector !== 'string'
    ) {
      throw new MonitorRuleValidationError('newItem requires a repeated-list target');
    }
  }
  const revision = monitor.revision + 1;
  await connection.query(
    'UPDATE monitors SET revision = ? WHERE id = ? AND owner_id = ? AND revision = ?',
    [revision, monitorId, ownerId, monitor.revision],
  );
  await connection.query('UPDATE monitor_schedules SET monitor_revision = ? WHERE monitor_id = ?', [
    revision,
    monitorId,
  ]);
  await connection.query(
    `INSERT INTO monitor_rules (monitor_id, monitor_revision, configuration, baseline_state, baseline_revision)
     VALUES (?, ?, ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE monitor_revision = VALUES(monitor_revision),
                             configuration = VALUES(configuration), baseline_state = 'pending',
                             baseline_revision = VALUES(baseline_revision), updated_at = CURRENT_TIMESTAMP`,
    [monitorId, revision, JSON.stringify(configurationInput(normalized)), revision],
  );
  return {
    monitor: { ...monitor, revision },
    rules: { baseline: { revision, state: 'pending' }, configuration: normalized },
  };
}

export type MonitorRulePool = MonitorPool;
