import {
  createMonitor,
  deleteOwnedMonitorSchedule,
  deleteMonitor,
  getMonitorSchedule,
  getMonitorTarget,
  getMonitorRules,
  getMonitor,
  listMonitors,
  pauseMonitor,
  resumeMonitor,
  upsertOwnedMonitorSchedule,
  upsertOwnedMonitorTarget,
  upsertOwnedMonitorRules,
  updateMonitor,
  type Monitor,
  type MonitorConfiguration,
  type MonitorPool,
  type MonitorScheduleConfiguration,
  type MonitorScheduleWithMonitor,
  type MonitorRuleConfiguration,
  type MonitorRulesWithMonitor,
  type MonitorTargetConfiguration,
  type MonitorTargetWithMonitor,
  withMonitorTransaction,
} from '@pagepulse/db';

export type MonitorService = Readonly<{
  create: (userId: string, configuration: MonitorConfiguration) => Promise<Monitor>;
  deleteSchedule: (userId: string, monitorId: string, expectedRevision: number) => Promise<Monitor>;
  delete: (userId: string, monitorId: string, expectedRevision: number) => Promise<void>;
  get: (userId: string, monitorId: string) => Promise<Monitor>;
  getSchedule: (
    userId: string,
    monitorId: string,
  ) => Promise<Awaited<ReturnType<typeof getMonitorSchedule>>>;
  getTarget: (
    userId: string,
    monitorId: string,
  ) => Promise<Awaited<ReturnType<typeof getMonitorTarget>>>;
  getRules: (
    userId: string,
    monitorId: string,
  ) => Promise<Awaited<ReturnType<typeof getMonitorRules>>>;
  list: (userId: string) => Promise<ReadonlyArray<Monitor>>;
  pause: (userId: string, monitorId: string, expectedRevision: number) => Promise<Monitor>;
  resume: (userId: string, monitorId: string, expectedRevision: number) => Promise<Monitor>;
  update: (
    userId: string,
    monitorId: string,
    expectedRevision: number,
    configuration: MonitorConfiguration,
  ) => Promise<Monitor>;
  updateSchedule: (
    userId: string,
    monitorId: string,
    expectedRevision: number,
    configuration: MonitorScheduleConfiguration,
  ) => Promise<MonitorScheduleWithMonitor>;
  updateTarget: (
    userId: string,
    monitorId: string,
    expectedRevision: number,
    configuration: MonitorTargetConfiguration,
  ) => Promise<MonitorTargetWithMonitor>;
  updateRules: (
    userId: string,
    monitorId: string,
    expectedRevision: number,
    configuration: MonitorRuleConfiguration,
  ) => Promise<MonitorRulesWithMonitor>;
}>;

export type MonitorServiceOptions = Readonly<{
  now?: () => Date;
  pool: MonitorPool;
}>;

export function createMonitorService({
  now = () => new Date(),
  pool,
}: MonitorServiceOptions): MonitorService {
  return {
    create: (userId, configuration) =>
      withMonitorTransaction(pool, (connection) =>
        createMonitor(connection, userId, configuration, now()),
      ),
    delete: (userId, monitorId, expectedRevision) =>
      withMonitorTransaction(pool, (connection) =>
        deleteMonitor(connection, userId, monitorId, expectedRevision),
      ),
    deleteSchedule: (userId, monitorId, expectedRevision) =>
      withMonitorTransaction(pool, (connection) =>
        deleteOwnedMonitorSchedule(connection, userId, monitorId, expectedRevision),
      ),
    get: (userId, monitorId) =>
      withMonitorTransaction(pool, (connection) => getMonitor(connection, userId, monitorId)),
    getSchedule: (userId, monitorId) =>
      withMonitorTransaction(pool, (connection) =>
        getMonitorSchedule(connection, userId, monitorId),
      ),
    getTarget: (userId, monitorId) =>
      withMonitorTransaction(pool, (connection) => getMonitorTarget(connection, userId, monitorId)),
    getRules: (userId, monitorId) =>
      withMonitorTransaction(pool, (connection) => getMonitorRules(connection, userId, monitorId)),
    list: (userId) =>
      withMonitorTransaction(pool, (connection) => listMonitors(connection, userId)),
    pause: (userId, monitorId, expectedRevision) =>
      withMonitorTransaction(pool, (connection) =>
        pauseMonitor(connection, userId, monitorId, expectedRevision),
      ),
    resume: (userId, monitorId, expectedRevision) =>
      withMonitorTransaction(pool, (connection) =>
        resumeMonitor(connection, userId, monitorId, expectedRevision),
      ),
    update: (userId, monitorId, expectedRevision, configuration) =>
      withMonitorTransaction(pool, (connection) =>
        updateMonitor(connection, userId, monitorId, expectedRevision, configuration),
      ),
    updateSchedule: (userId, monitorId, expectedRevision, configuration) =>
      withMonitorTransaction(pool, (connection) =>
        upsertOwnedMonitorSchedule(connection, userId, monitorId, expectedRevision, configuration),
      ),
    updateTarget: (userId, monitorId, expectedRevision, configuration) =>
      withMonitorTransaction(pool, (connection) =>
        upsertOwnedMonitorTarget(connection, userId, monitorId, expectedRevision, configuration),
      ),
    updateRules: (userId, monitorId, expectedRevision, configuration) =>
      withMonitorTransaction(pool, (connection) =>
        upsertOwnedMonitorRules(connection, userId, monitorId, expectedRevision, configuration),
      ),
  };
}
