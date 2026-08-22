import { Type, type Static, type TSchema } from '@sinclair/typebox';

const queuePayloadOptions = { additionalProperties: false } as const;
const queueIdentifier = () => Type.String({ minLength: 1, maxLength: 128 });
const queueCorrelationId = () => Type.String({ minLength: 1, maxLength: 128 });

export const CheckJob = Type.Object(
  {
    version: Type.Literal(1),
    monitorId: queueIdentifier(),
    monitorRevision: Type.Integer({ minimum: 1 }),
    checkId: queueIdentifier(),
    correlationId: queueCorrelationId(),
  },
  queuePayloadOptions,
);
export type CheckJob = Static<typeof CheckJob>;

export const MonitorScheduleJob = Type.Object(
  {
    version: Type.Literal(1),
    monitorId: queueIdentifier(),
    monitorRevision: Type.Integer({ minimum: 1 }),
    correlationId: queueCorrelationId(),
  },
  queuePayloadOptions,
);
export type MonitorScheduleJob = Static<typeof MonitorScheduleJob>;

export const ChangeDetectionJob = Type.Object(
  {
    version: Type.Literal(1),
    monitorId: queueIdentifier(),
    monitorRevision: Type.Integer({ minimum: 1 }),
    checkId: queueIdentifier(),
    correlationId: queueCorrelationId(),
  },
  queuePayloadOptions,
);
export type ChangeDetectionJob = Static<typeof ChangeDetectionJob>;

export const NotificationJob = Type.Object(
  {
    version: Type.Literal(1),
    outboxEventId: queueIdentifier(),
    correlationId: queueCorrelationId(),
  },
  queuePayloadOptions,
);
export type NotificationJob = Static<typeof NotificationJob>;

export const DigestJob = Type.Object(
  {
    version: Type.Literal(1),
    userId: queueIdentifier(),
    digestWindowStartedAt: Type.String({ minLength: 1, maxLength: 64 }),
    correlationId: queueCorrelationId(),
  },
  queuePayloadOptions,
);
export type DigestJob = Static<typeof DigestJob>;

export const MaintenanceJob = Type.Object(
  {
    version: Type.Literal(1),
    task: Type.Union([
      Type.Literal('retention'),
      Type.Literal('reconciliation'),
      Type.Literal('stale-state'),
    ]),
    correlationId: queueCorrelationId(),
  },
  queuePayloadOptions,
);
export type MaintenanceJob = Static<typeof MaintenanceJob>;

export const QueueNames = {
  monitorSchedule: 'monitor-schedule',
  pageFetch: 'page-fetch',
  browserFetch: 'browser-fetch',
  changeDetection: 'change-detection',
  notification: 'notification',
  digest: 'digest',
  maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export const QueuePayloadSchemas = {
  [QueueNames.monitorSchedule]: MonitorScheduleJob,
  [QueueNames.pageFetch]: CheckJob,
  [QueueNames.browserFetch]: CheckJob,
  [QueueNames.changeDetection]: ChangeDetectionJob,
  [QueueNames.notification]: NotificationJob,
  [QueueNames.digest]: DigestJob,
  [QueueNames.maintenance]: MaintenanceJob,
} as const satisfies Record<QueueName, TSchema>;

export type QueuePayloadByName = {
  [QueueNames.monitorSchedule]: MonitorScheduleJob;
  [QueueNames.pageFetch]: CheckJob;
  [QueueNames.browserFetch]: CheckJob;
  [QueueNames.changeDetection]: ChangeDetectionJob;
  [QueueNames.notification]: NotificationJob;
  [QueueNames.digest]: DigestJob;
  [QueueNames.maintenance]: MaintenanceJob;
};

export const HealthResponse = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
  service: Type.String(),
  version: Type.String(),
  uptimeSeconds: Type.Integer(),
});
