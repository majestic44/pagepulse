import { and, eq } from 'drizzle-orm';

import { type Database } from './client.js';
import { monitorSchedules, monitors } from './schema.js';

export const MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS = 3_600_000;
export const MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MS = 2_147_483_647;
export const MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES =
  MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS / 60_000;
export const MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES = Math.floor(
  MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MS / 60_000,
);

export type MonitorScheduleType = 'custom' | 'daily' | 'hourly';

export type MonitorScheduleConfiguration = Readonly<{
  customIntervalMinutes?: number | undefined;
  dailyTime?: string | undefined;
  hourlyMinute?: number | undefined;
  scheduleType: MonitorScheduleType;
  timeZone: string;
}>;

export type NormalizedMonitorScheduleConfiguration = Readonly<{
  customIntervalMinutes: number | null;
  dailyTime: string | null;
  hourlyMinute: number | null;
  scheduleType: MonitorScheduleType;
  timeZone: string;
}>;

export type MonitorSchedule = Readonly<{
  correlationId: string;
  customIntervalMinutes: number | null;
  dailyTime: string | null;
  hourlyMinute: number | null;
  monitorId: string;
  monitorRevision: number;
  scheduleType: MonitorScheduleType;
  timeZone: string;
}>;

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DatabaseSession = Database | DatabaseTransaction;

export class MonitorScheduleValidationError extends Error {
  constructor(message: string) {
    super(`Invalid monitor schedule: ${message}`);
    this.name = 'MonitorScheduleValidationError';
  }
}

function validateIdentifier(value: string, field: string, maximumLength: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new MonitorScheduleValidationError(
      `${field} must be between 1 and ${maximumLength} characters`,
    );
  }
}

function normalizeTimeZone(value: string) {
  if (typeof value !== 'string') {
    throw new MonitorScheduleValidationError('timeZone must be a valid IANA time zone');
  }
  const timeZone = value.trim();
  if (timeZone.length === 0 || timeZone.length > 64) {
    throw new MonitorScheduleValidationError('timeZone must be a valid IANA time zone');
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new MonitorScheduleValidationError('timeZone must be a valid IANA time zone');
  }
}

function normalizeDailyTime(value: string | undefined) {
  if (typeof value !== 'string' || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u.test(value)) {
    throw new MonitorScheduleValidationError('dailyTime must use 24-hour HH:MM format');
  }
  return value;
}

function normalizeHourlyMinute(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 59) {
    throw new MonitorScheduleValidationError('hourlyMinute must be an integer from 0 through 59');
  }
  return value;
}

function normalizeCustomInterval(value: number | undefined) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES ||
    value > MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES
  ) {
    throw new MonitorScheduleValidationError(
      `customIntervalMinutes must be an integer from ${MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES} through ${MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES}`,
    );
  }
  return value;
}

export function normalizeMonitorScheduleConfiguration(
  configuration: MonitorScheduleConfiguration,
): NormalizedMonitorScheduleConfiguration {
  const timeZone = normalizeTimeZone(configuration.timeZone);
  switch (configuration.scheduleType) {
    case 'custom':
      return {
        customIntervalMinutes: normalizeCustomInterval(configuration.customIntervalMinutes),
        dailyTime: null,
        hourlyMinute: null,
        scheduleType: 'custom',
        timeZone,
      };
    case 'daily':
      return {
        customIntervalMinutes: null,
        dailyTime: normalizeDailyTime(configuration.dailyTime),
        hourlyMinute: null,
        scheduleType: 'daily',
        timeZone,
      };
    case 'hourly':
      return {
        customIntervalMinutes: null,
        dailyTime: null,
        hourlyMinute: normalizeHourlyMinute(configuration.hourlyMinute),
        scheduleType: 'hourly',
        timeZone,
      };
    default:
      throw new MonitorScheduleValidationError('scheduleType must be hourly, daily, or custom');
  }
}

function storageIntervalMilliseconds(schedule: NormalizedMonitorScheduleConfiguration) {
  if (schedule.scheduleType === 'custom') {
    return schedule.customIntervalMinutes! * 60_000;
  }
  return schedule.scheduleType === 'daily'
    ? MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS * 24
    : MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS;
}

function validateSchedule(schedule: MonitorSchedule) {
  if (schedule.monitorId.length === 0 || schedule.monitorId.length > 36) {
    throw new MonitorScheduleValidationError('monitorId must be between 1 and 36 characters');
  }
  if (!Number.isSafeInteger(schedule.monitorRevision) || schedule.monitorRevision < 1) {
    throw new MonitorScheduleValidationError('monitorRevision must be a positive integer');
  }
  validateIdentifier(schedule.correlationId, 'correlationId', 128);
  const normalized = normalizeMonitorScheduleConfiguration({
    ...(schedule.customIntervalMinutes === null
      ? {}
      : { customIntervalMinutes: schedule.customIntervalMinutes }),
    ...(schedule.dailyTime === null ? {} : { dailyTime: schedule.dailyTime }),
    ...(schedule.hourlyMinute === null ? {} : { hourlyMinute: schedule.hourlyMinute }),
    scheduleType: schedule.scheduleType,
    timeZone: schedule.timeZone,
  });
  if (
    normalized.customIntervalMinutes !== schedule.customIntervalMinutes ||
    normalized.dailyTime !== schedule.dailyTime ||
    normalized.hourlyMinute !== schedule.hourlyMinute ||
    normalized.scheduleType !== schedule.scheduleType ||
    normalized.timeZone !== schedule.timeZone
  ) {
    throw new MonitorScheduleValidationError('schedule fields must be normalized');
  }
}

export async function upsertMonitorSchedule(session: DatabaseSession, schedule: MonitorSchedule) {
  validateSchedule(schedule);
  await session
    .insert(monitorSchedules)
    .values({
      correlationId: schedule.correlationId,
      customIntervalMinutes: schedule.customIntervalMinutes,
      dailyTime: schedule.dailyTime,
      hourlyMinute: schedule.hourlyMinute,
      intervalMs: storageIntervalMilliseconds(schedule),
      monitorId: schedule.monitorId,
      monitorRevision: schedule.monitorRevision,
      scheduleType: schedule.scheduleType,
      timeZone: schedule.timeZone,
    })
    .onDuplicateKeyUpdate({
      set: {
        correlationId: schedule.correlationId,
        customIntervalMinutes: schedule.customIntervalMinutes,
        dailyTime: schedule.dailyTime,
        hourlyMinute: schedule.hourlyMinute,
        intervalMs: storageIntervalMilliseconds(schedule),
        monitorRevision: schedule.monitorRevision,
        scheduleType: schedule.scheduleType,
        timeZone: schedule.timeZone,
      },
    });
  return schedule;
}

export async function listActiveMonitorSchedules(database: Database): Promise<MonitorSchedule[]> {
  return database
    .select({
      correlationId: monitorSchedules.correlationId,
      customIntervalMinutes: monitorSchedules.customIntervalMinutes,
      dailyTime: monitorSchedules.dailyTime,
      hourlyMinute: monitorSchedules.hourlyMinute,
      monitorId: monitorSchedules.monitorId,
      monitorRevision: monitorSchedules.monitorRevision,
      scheduleType: monitorSchedules.scheduleType,
      timeZone: monitorSchedules.timeZone,
    })
    .from(monitorSchedules)
    .innerJoin(monitors, eq(monitorSchedules.monitorId, monitors.id))
    .where(
      and(eq(monitors.state, 'active'), eq(monitorSchedules.monitorRevision, monitors.revision)),
    );
}

export type ScheduledMonitorFetchTarget = Readonly<{
  id: string;
  revision: number;
  url: string;
}>;

export async function getActiveMonitorForScheduledFetch(
  database: Database,
  monitorId: string,
  monitorRevision: number,
): Promise<ScheduledMonitorFetchTarget | null> {
  const rows = await database
    .select({ id: monitors.id, revision: monitors.revision, url: monitors.url })
    .from(monitors)
    .where(
      and(
        eq(monitors.id, monitorId),
        eq(monitors.revision, monitorRevision),
        eq(monitors.state, 'active'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
