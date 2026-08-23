import { and, eq } from 'drizzle-orm';

import { type Database } from './client.js';
import { monitorSchedules, monitors } from './schema.js';

export const MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS = 3_600_000;
export const MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MS = 2_147_483_647;

export type MonitorSchedule = Readonly<{
  correlationId: string;
  everyMilliseconds: number;
  monitorId: string;
  monitorRevision: number;
}>;

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DatabaseSession = Database | DatabaseTransaction;

export class MonitorScheduleValidationError extends Error {
  constructor(message: string) {
    super(`Invalid monitor schedule: ${message}`);
    this.name = 'MonitorScheduleValidationError';
  }
}

function validateSchedule(schedule: MonitorSchedule) {
  if (schedule.monitorId.length === 0 || schedule.monitorId.length > 36) {
    throw new MonitorScheduleValidationError('monitorId must be between 1 and 36 characters');
  }
  if (!Number.isSafeInteger(schedule.monitorRevision) || schedule.monitorRevision < 1) {
    throw new MonitorScheduleValidationError('monitorRevision must be a positive integer');
  }
  if (
    !Number.isSafeInteger(schedule.everyMilliseconds) ||
    schedule.everyMilliseconds < MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS ||
    schedule.everyMilliseconds > MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MS
  ) {
    throw new MonitorScheduleValidationError(
      `everyMilliseconds must be between ${MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS} and ${MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MS}`,
    );
  }
  if (schedule.correlationId.length === 0 || schedule.correlationId.length > 128) {
    throw new MonitorScheduleValidationError('correlationId must be between 1 and 128 characters');
  }
}

export async function upsertMonitorSchedule(session: DatabaseSession, schedule: MonitorSchedule) {
  validateSchedule(schedule);
  await session
    .insert(monitorSchedules)
    .values({
      correlationId: schedule.correlationId,
      intervalMs: schedule.everyMilliseconds,
      monitorId: schedule.monitorId,
      monitorRevision: schedule.monitorRevision,
    })
    .onDuplicateKeyUpdate({
      set: {
        correlationId: schedule.correlationId,
        intervalMs: schedule.everyMilliseconds,
        monitorRevision: schedule.monitorRevision,
      },
    });
  return schedule;
}

export async function listActiveMonitorSchedules(database: Database): Promise<MonitorSchedule[]> {
  return database
    .select({
      correlationId: monitorSchedules.correlationId,
      everyMilliseconds: monitorSchedules.intervalMs,
      monitorId: monitorSchedules.monitorId,
      monitorRevision: monitorSchedules.monitorRevision,
    })
    .from(monitorSchedules)
    .innerJoin(monitors, eq(monitorSchedules.monitorId, monitors.id))
    .where(
      and(eq(monitors.state, 'active'), eq(monitorSchedules.monitorRevision, monitors.revision)),
    );
}
