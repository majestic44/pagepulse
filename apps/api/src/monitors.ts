import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  listMonitors,
  pauseMonitor,
  resumeMonitor,
  updateMonitor,
  type Monitor,
  type MonitorConfiguration,
  type MonitorPool,
  withMonitorTransaction,
} from '@pagepulse/db';

export type MonitorService = Readonly<{
  create: (userId: string, configuration: MonitorConfiguration) => Promise<Monitor>;
  delete: (userId: string, monitorId: string, expectedRevision: number) => Promise<void>;
  get: (userId: string, monitorId: string) => Promise<Monitor>;
  list: (userId: string) => Promise<ReadonlyArray<Monitor>>;
  pause: (userId: string, monitorId: string, expectedRevision: number) => Promise<Monitor>;
  resume: (userId: string, monitorId: string, expectedRevision: number) => Promise<Monitor>;
  update: (
    userId: string,
    monitorId: string,
    expectedRevision: number,
    configuration: MonitorConfiguration,
  ) => Promise<Monitor>;
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
    get: (userId, monitorId) =>
      withMonitorTransaction(pool, (connection) => getMonitor(connection, userId, monitorId)),
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
  };
}
