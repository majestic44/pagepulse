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

export const EmailVerificationRequest = Type.Object(
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

const AuditOptionalIdentifier = Type.Union([
  Type.String({ minLength: 1, maxLength: 128 }),
  Type.Null(),
]);

export const AuditEventSummary = Type.Object({
  action: Type.String({ minLength: 1, maxLength: 96 }),
  actorUserId: AuditOptionalIdentifier,
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ minLength: 1, maxLength: 36 }),
  targetId: AuditOptionalIdentifier,
  targetType: Type.Union([
    Type.Literal('account'),
    Type.Literal('member'),
    Type.Literal('session'),
    Type.Literal('system'),
  ]),
});

export const AuditEventsResponse = Type.Object({
  events: Type.Array(AuditEventSummary, { maxItems: 100 }),
});

export const MonitorState = Type.Union([
  Type.Literal('active'),
  Type.Literal('authentication_required'),
  Type.Literal('blocked'),
  Type.Literal('paused'),
]);

export const MonitorConfiguration = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
  },
  queuePayloadOptions,
);

export const MonitorSummary = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ minLength: 1, maxLength: 36 }),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  revision: Type.Integer({ minimum: 1 }),
  state: MonitorState,
  url: Type.String({ minLength: 1, maxLength: 2_048 }),
});

export const MonitorScheduleType = Type.Union([
  Type.Literal('custom'),
  Type.Literal('daily'),
  Type.Literal('hourly'),
]);

export const MonitorScheduleConfiguration = Type.Object(
  {
    customIntervalMinutes: Type.Optional(Type.Integer({ minimum: 60, maximum: 35_791 })),
    dailyTime: Type.Optional(Type.String({ minLength: 5, maxLength: 5 })),
    hourlyMinute: Type.Optional(Type.Integer({ minimum: 0, maximum: 59 })),
    scheduleType: MonitorScheduleType,
    timeZone: Type.String({ minLength: 1, maxLength: 64 }),
  },
  queuePayloadOptions,
);

export const MonitorScheduleSummary = Type.Object({
  customIntervalMinutes: Type.Union([Type.Integer({ minimum: 60, maximum: 35_791 }), Type.Null()]),
  dailyTime: Type.Union([Type.String({ minLength: 5, maxLength: 5 }), Type.Null()]),
  hourlyMinute: Type.Union([Type.Integer({ minimum: 0, maximum: 59 }), Type.Null()]),
  scheduleType: MonitorScheduleType,
  timeZone: Type.String({ minLength: 1, maxLength: 64 }),
});

export const MonitorScheduleResponse = Type.Object({
  monitor: MonitorSummary,
  schedule: Type.Union([MonitorScheduleSummary, Type.Null()]),
});

export const MonitorTargetType = Type.Union([
  Type.Literal('whole_page'),
  Type.Literal('css_selector'),
]);

export const MonitorTargetConfiguration = Type.Object(
  {
    selector: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    targetType: MonitorTargetType,
  },
  queuePayloadOptions,
);

export const MonitorTargetSummary = Type.Object({
  selector: Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
  targetType: MonitorTargetType,
});

export const MonitorTargetResponse = Type.Object({
  monitor: MonitorSummary,
  target: MonitorTargetSummary,
});

export const MonitorTargetPreview = Type.Object({
  matchCount: Type.Integer({ minimum: 1 }),
  text: Type.String({ maxLength: 20_000 }),
  truncated: Type.Boolean(),
});

export const MonitorTargetPreviewResponse = Type.Object({
  preview: MonitorTargetPreview,
});

export const MonitorsResponse = Type.Object({
  monitors: Type.Array(MonitorSummary),
});

export const MonitorIdParameters = Type.Object({
  monitorId: Type.String({ minLength: 1, maxLength: 36 }),
});

export const InvalidMonitorRequestResponse = Type.Object({
  error: Type.Literal('Invalid monitor request'),
});

export const InvalidMonitorScheduleRequestResponse = Type.Object({
  error: Type.Literal('Invalid monitor schedule'),
});

export const InvalidMonitorTargetRequestResponse = Type.Object({
  error: Type.Literal('Invalid monitor target'),
});

export const MonitorPreviewFailureResponse = Type.Object({
  error: Type.Union([
    Type.Literal('Preview target is not allowed'),
    Type.Literal('Preview unavailable'),
  ]),
});

export const TooManyMonitorPreviewRequestsResponse = Type.Object({
  error: Type.Literal('Too many preview attempts'),
});

export const MonitorLimitResponse = Type.Object({
  error: Type.Literal('Monitor limit reached'),
});

export const MonitorRevisionConflictResponse = Type.Object({
  error: Type.Literal('Monitor has changed'),
});

export const MonitorStateConflictResponse = Type.Object({
  error: Type.Literal('Monitor state cannot be changed'),
});

export const MonitorMutationConflictResponse = Type.Union([
  MonitorRevisionConflictResponse,
  MonitorStateConflictResponse,
]);

export const MonitorUnavailableResponse = Type.Object({
  error: Type.Literal('Monitor configuration temporarily unavailable'),
});

export const MemberIdParameters = Type.Object({
  memberId: Type.String({ minLength: 1, maxLength: 36 }),
});

export const MemberLifecycleConflictResponse = Type.Object({
  error: Type.Literal('Member lifecycle action cannot be completed'),
});
