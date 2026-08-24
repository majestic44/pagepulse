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

export const VersionResponse = Type.Object({
  service: Type.String(),
  version: Type.String(),
  uptimeSeconds: Type.Integer(),
});

const DependencyHealthStatus = Type.Union([Type.Literal('ok'), Type.Literal('unavailable')]);

export const DiagnosticsResponse = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
  service: Type.String(),
  version: Type.String(),
  uptimeSeconds: Type.Integer(),
  dependencies: Type.Object({
    database: DependencyHealthStatus,
    redis: DependencyHealthStatus,
  }),
});

export const UnauthorizedResponse = Type.Object({
  error: Type.Literal('Unauthorized'),
});

export const ForbiddenResponse = Type.Object({
  error: Type.Literal('Forbidden'),
});

export const NotFoundResponse = Type.Object({
  error: Type.Literal('Not found'),
});

export const AuthenticationCredentials = Type.Object(
  {
    password: Type.String({ minLength: 1, maxLength: 4_096 }),
    token: Type.String({ minLength: 1, maxLength: 256 }),
  },
  queuePayloadOptions,
);

export const LoginRequest = Type.Object(
  {
    email: Type.String({ minLength: 1, maxLength: 320 }),
    password: Type.String({ minLength: 1, maxLength: 4_096 }),
  },
  queuePayloadOptions,
);

export const TotpCodeRequest = Type.Object(
  { code: Type.String({ minLength: 6, maxLength: 6, pattern: '^\\d{6}$' }) },
  queuePayloadOptions,
);

export const TotpRecoveryCodeRequest = Type.Object(
  { recoveryCode: Type.String({ minLength: 12, maxLength: 32 }) },
  queuePayloadOptions,
);

export const TotpProofRequest = Type.Union([TotpCodeRequest, TotpRecoveryCodeRequest]);

export const AccountDeletionRequest = Type.Union([
  Type.Object(
    {
      code: Type.String({ minLength: 6, maxLength: 6, pattern: '^\\d{6}$' }),
      password: Type.String({ minLength: 1, maxLength: 4_096 }),
    },
    queuePayloadOptions,
  ),
  Type.Object(
    {
      password: Type.String({ minLength: 1, maxLength: 4_096 }),
      recoveryCode: Type.String({ minLength: 12, maxLength: 32 }),
    },
    queuePayloadOptions,
  ),
  Type.Object(
    {
      password: Type.String({ minLength: 1, maxLength: 4_096 }),
    },
    queuePayloadOptions,
  ),
]);

export const AccountDeletionRecoveryRequest = Type.Object(
  { token: Type.String({ minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' }) },
  queuePayloadOptions,
);

export const TokenRequest = Type.Object(
  { token: Type.String({ minLength: 1, maxLength: 256 }) },
  queuePayloadOptions,
);

export const PasswordResetRequest = Type.Object(
  { email: Type.String({ minLength: 1, maxLength: 320 }) },
  queuePayloadOptions,
);

export const AuthenticationAcceptedResponse = Type.Object({
  status: Type.Union([
    Type.Literal('reset_requested'),
    Type.Literal('totp_required'),
    Type.Literal('verification_required'),
  ]),
});

export const InvalidAuthenticationRequestResponse = Type.Object({
  error: Type.Literal('Invalid authentication request'),
});

export const TooManyRequestsResponse = Type.Object({
  error: Type.Literal('Too many authentication attempts'),
});

export const AuthenticationUnavailableResponse = Type.Object({
  error: Type.Literal('Authentication temporarily unavailable'),
});

export const AccountDeletionScheduledResponse = Type.Object({
  deletionDeadline: Type.String({ format: 'date-time' }),
  recoveryToken: Type.String({ minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' }),
});

export const InvalidAccountDeletionConfirmationResponse = Type.Object({
  error: Type.Literal('Invalid account deletion confirmation'),
});

export const AccountDeletionConflictResponse = Type.Object({
  error: Type.Literal('Account deletion cannot be completed'),
});

export const SessionSummary = Type.Object({
  absoluteExpiresAt: Type.String({ format: 'date-time' }),
  createdAt: Type.String({ format: 'date-time' }),
  current: Type.Boolean(),
  deviceLabel: Type.String({ minLength: 1, maxLength: 160 }),
  id: Type.String({ minLength: 1, maxLength: 36 }),
  idleExpiresAt: Type.String({ format: 'date-time' }),
  lastUsedAt: Type.String({ format: 'date-time' }),
});

export const ActiveSessionsResponse = Type.Object({
  sessions: Type.Array(SessionSummary),
});

export const SessionIdParameters = Type.Object({
  sessionId: Type.String({ minLength: 1, maxLength: 36 }),
});

export const TotpStatusResponse = Type.Object({
  enabled: Type.Boolean(),
});

export const TotpEnrollmentResponse = Type.Object({
  manualEntryKey: Type.String({ minLength: 16, maxLength: 128 }),
  otpauthUri: Type.String({ minLength: 1, maxLength: 2_048 }),
});

export const RecoveryCodesResponse = Type.Object({
  recoveryCodes: Type.Array(Type.String({ minLength: 14, maxLength: 14 }), {
    minItems: 1,
    maxItems: 20,
  }),
});

export const ManagedMemberStatus = Type.Union([
  Type.Literal('active'),
  Type.Literal('deleting'),
  Type.Literal('invited'),
  Type.Literal('suspended'),
]);

export const ManagedMemberSummary = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  email: Type.String({ format: 'email', maxLength: 320 }),
  emailVerified: Type.Boolean(),
  id: Type.String({ minLength: 1, maxLength: 36 }),
  monitorLimit: Type.Integer({ minimum: 0 }),
  status: ManagedMemberStatus,
});

export const ManagedMembersResponse = Type.Object({
  members: Type.Array(ManagedMemberSummary),
});

export const MemberIdParameters = Type.Object({
  memberId: Type.String({ minLength: 1, maxLength: 36 }),
});

export const MemberLifecycleConflictResponse = Type.Object({
  error: Type.Literal('Member lifecycle action cannot be completed'),
});
