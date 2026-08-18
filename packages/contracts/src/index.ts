import { Type, type Static } from '@sinclair/typebox';

export const CheckJob = Type.Object({
  version: Type.Literal(1),
  monitorId: Type.String({ minLength: 1 }),
  monitorRevision: Type.Integer({ minimum: 1 }),
  checkId: Type.String({ minLength: 1 }),
  correlationId: Type.String({ minLength: 1 }),
});
export type CheckJob = Static<typeof CheckJob>;

export const QueueNames = {
  monitorSchedule: 'monitor-schedule',
  pageFetch: 'page-fetch',
  browserFetch: 'browser-fetch',
  changeDetection: 'change-detection',
  notification: 'notification',
  digest: 'digest',
  maintenance: 'maintenance',
} as const;

export const HealthResponse = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
  service: Type.String(),
  version: Type.String(),
  uptimeSeconds: Type.Integer(),
});
