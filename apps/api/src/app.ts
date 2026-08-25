import { Type, type Static } from '@sinclair/typebox';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import {
  AuthRateLimitExceededError,
  AuthRateLimitUnavailableError,
  EmailValidationError,
  enforceAuthRateLimit,
  PasswordValidationError,
  RedisFixedWindowRateLimitStore,
} from '@pagepulse/auth';
import { createLogger, loadEnvironment, type Environment } from '@pagepulse/config';
import {
  AccountDeletionStateError,
  AccountDeletionTokenError,
  AuthenticationStateError,
  AuthenticationTokenError,
  createDatabasePool,
  hashAuditRequesterIp,
  MemberLifecycleStateError,
  MemberNotFoundError,
  MonitorAccessError,
  MonitorInputError,
  MonitorLimitError,
  MonitorNotFoundError,
  MonitorRevisionConflictError,
  MonitorScheduleNotFoundError,
  MonitorScheduleValidationError,
  MonitorStateError,
  MonitorTargetValidationError,
  probeDatabase,
  type ActiveSession,
  type Monitor,
  type MonitorSchedule,
  type MonitorTarget,
} from '@pagepulse/db';
import {
  AccountDeletionConflictResponse,
  AccountDeletionRecoveryRequest,
  AccountDeletionScheduledResponse,
  AccountDeletionRequest,
  ActiveSessionsResponse,
  AuthenticationAcceptedResponse,
  AuthenticationUnavailableResponse,
  AuthenticationCredentials,
  AuditEventsResponse,
  DiagnosticsResponse,
  EmailVerificationRequest,
  ForbiddenResponse,
  HealthResponse,
  InvalidMonitorRequestResponse,
  InvalidMonitorScheduleRequestResponse,
  InvalidMonitorTargetRequestResponse,
  InvalidAuthenticationRequestResponse,
  InvalidAccountDeletionConfirmationResponse,
  LoginRequest,
  ManagedMembersResponse,
  MemberIdParameters,
  MemberLifecycleConflictResponse,
  MonitorConfiguration,
  MonitorIdParameters,
  MonitorLimitResponse,
  MonitorMutationConflictResponse,
  MonitorRevisionConflictResponse,
  MonitorScheduleConfiguration,
  MonitorScheduleResponse,
  MonitorSummary,
  MonitorTargetConfiguration,
  MonitorTargetPreviewResponse,
  MonitorTargetResponse,
  MonitorsResponse,
  MonitorPreviewFailureResponse,
  MonitorUnavailableResponse,
  NotFoundResponse,
  PasswordResetRequest,
  RecoveryCodesResponse,
  SessionIdParameters,
  TokenRequest,
  TotpCodeRequest,
  TotpEnrollmentResponse,
  TotpProofRequest,
  TotpStatusResponse,
  TooManyRequestsResponse,
  TooManyMonitorPreviewRequestsResponse,
  UnauthorizedResponse,
  VersionResponse,
} from '@pagepulse/contracts';
import {
  MonitorPreviewError,
  previewHtmlTarget,
  type HtmlExtractionPreview,
  type MonitorTargetConfiguration as MonitorTargetConfigurationInput,
} from '@pagepulse/monitor-engine';
import { createRedisConnection, probeRedis } from '@pagepulse/queue';
import { createAccountDeletionService } from './account-deletion.js';
import { createAuditService } from './audit.js';
import {
  createAuthenticationService,
  type AuthenticationDependencies,
  type AuthenticationRateLimitPolicies,
} from './auth.js';
import { createVerificationEmailDelivery } from './email-delivery.js';
import { createHealthService, type HealthService } from './health.js';
import { createMemberService } from './members.js';
import { createMonitorService } from './monitors.js';
import {
  clearSessionCookie,
  createSessionService,
  deviceLabel,
  readSessionCookie,
  serializeSessionCookie,
} from './session.js';
import {
  clearTotpLoginChallengeCookie,
  createTotpService,
  readTotpLoginChallengeCookie,
  serializeTotpLoginChallengeCookie,
} from './totp.js';

export type BuildAppOptions = Readonly<{
  authentication?: AuthenticationDependencies;
  environment?: Environment;
  healthService?: HealthService;
  monitorPreview?: MonitorPreviewService;
  now?: () => number;
}>;

export type MonitorPreviewService = Readonly<{
  preview: (
    monitor: Monitor,
    target: MonitorTargetConfigurationInput,
  ) => Promise<HtmlExtractionPreview>;
}>;

type DefaultAuthenticationDependencies = AuthenticationDependencies &
  Readonly<{
    close: () => Promise<void>;
  }>;

type AuthenticationRateLimitScope = keyof AuthenticationRateLimitPolicies;

function authenticationRateLimitPolicies(
  environment: Environment,
): AuthenticationRateLimitPolicies {
  return {
    deletion: {
      limit: environment.AUTH_DELETION_RATE_LIMIT_MAX,
      windowMs: environment.AUTH_DELETION_RATE_LIMIT_WINDOW_MS,
    },
    login: {
      limit: environment.AUTH_LOGIN_RATE_LIMIT_MAX,
      windowMs: environment.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
    },
    preview: {
      limit: environment.MONITOR_PREVIEW_RATE_LIMIT_MAX,
      windowMs: environment.MONITOR_PREVIEW_RATE_LIMIT_WINDOW_MS,
    },
    totp: {
      limit: environment.AUTH_TOTP_RATE_LIMIT_MAX,
      windowMs: environment.AUTH_TOTP_RATE_LIMIT_WINDOW_MS,
    },
    redemption: {
      limit: environment.AUTH_REDEMPTION_RATE_LIMIT_MAX,
      windowMs: environment.AUTH_REDEMPTION_RATE_LIMIT_WINDOW_MS,
    },
    reset: {
      limit: environment.AUTH_RESET_RATE_LIMIT_MAX,
      windowMs: environment.AUTH_RESET_RATE_LIMIT_WINDOW_MS,
    },
  };
}

async function createDefaultAuthenticationDependencies(
  environment: Environment,
): Promise<DefaultAuthenticationDependencies> {
  const pool = createDatabasePool(environment.DATABASE_URL);
  const redis = createRedisConnection(environment.REDIS_URL);
  try {
    const service = await createAuthenticationService({
      emailVerificationTokenTtlMinutes: environment.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES,
      passwordHashing: {
        memoryKiB: environment.AUTH_ARGON2_MEMORY_KIB,
        parallelism: environment.AUTH_ARGON2_PARALLELISM,
        passes: environment.AUTH_ARGON2_PASSES,
      },
      passwordResetTokenTtlMinutes: environment.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      pool,
    });
    return {
      accountDeletion: createAccountDeletionService({ pool }),
      audit: createAuditService({ pool }),
      close: async () => {
        await Promise.allSettled([pool.end(), redis.quit()]);
      },
      rateLimitPolicies: authenticationRateLimitPolicies(environment),
      rateLimitStore: new RedisFixedWindowRateLimitStore(redis),
      emailDelivery: createVerificationEmailDelivery(environment),
      service,
      members: createMemberService({ pool }),
      monitors: createMonitorService({ pool }),
      sessions: createSessionService({
        pool,
        timing: {
          absoluteTtlMinutes: environment.SESSION_ABSOLUTE_TTL_MINUTES,
          idleTtlMinutes: environment.SESSION_IDLE_TTL_MINUTES,
        },
      }),
      totp: createTotpService({
        encryptionKey: environment.TOTP_ENCRYPTION_KEK,
        pool,
      }),
    };
  } catch (error) {
    await Promise.allSettled([pool.end(), redis.quit()]);
    throw error;
  }
}

export async function buildApp(options: BuildAppOptions = {}) {
  const env = options.environment ?? loadEnvironment();
  const app = Fastify({ loggerInstance: createLogger('api', env.LOG_LEVEL) });
  await app.register(swagger, {
    openapi: { info: { title: 'PagePulse API', version: env.APP_VERSION } },
  });
  const now = options.now ?? Date.now;
  const started = now();
  const healthService =
    options.healthService ??
    createHealthService({
      database: () => probeDatabase(env.DATABASE_URL),
      redis: () => probeRedis(env.REDIS_URL),
    });
  const monitorPreview: MonitorPreviewService = options.monitorPreview ?? {
    preview: (monitor, target) =>
      previewHtmlTarget(
        { target, url: monitor.url },
        {
          maxBytes: Math.min(env.HTTP_FETCH_MAX_BYTES, 512 * 1_024),
          timeoutMs: env.HTTP_FETCH_TIMEOUT_MS,
        },
      ),
  };
  let defaultAuthentication: DefaultAuthenticationDependencies | undefined;
  let defaultAuthenticationPromise: Promise<DefaultAuthenticationDependencies> | undefined;
  const getAuthentication = async () => {
    if (options.authentication) {
      return options.authentication;
    }
    defaultAuthenticationPromise ??= createDefaultAuthenticationDependencies(env);
    defaultAuthentication = await defaultAuthenticationPromise;
    return defaultAuthentication;
  };
  app.addHook('onClose', async () => {
    await defaultAuthentication?.close();
  });
  app.addHook('onRequest', async (request, reply) => {
    if (
      request.url.startsWith('/api/v1/auth/') ||
      request.url.startsWith('/api/v1/account/') ||
      request.url.startsWith('/api/v1/monitors') ||
      request.url.startsWith('/api/v1/owner/') ||
      request.url.startsWith('/api/v1/system/diagnostics')
    ) {
      reply.header('Cache-Control', 'no-store');
    }
  });
  const serviceHealth = (status: 'ok' | 'degraded') => ({
    status,
    service: 'api',
    version: env.APP_VERSION,
    uptimeSeconds: Math.floor((now() - started) / 1000),
  });

  app.get('/health/live', { schema: { response: { 200: HealthResponse } } }, () => ({
    ...serviceHealth('ok'),
  }));

  app.get(
    '/health/ready',
    { schema: { response: { 200: HealthResponse, 503: HealthResponse } } },
    async (_request, reply) => {
      const diagnostics = await healthService.collectDiagnostics();
      return reply
        .code(diagnostics.status === 'ok' ? 200 : 503)
        .send(serviceHealth(diagnostics.status));
    },
  );

  app.get('/api/v1/system/version', { schema: { response: { 200: VersionResponse } } }, () => ({
    service: 'api',
    version: env.APP_VERSION,
    uptimeSeconds: Math.floor((now() - started) / 1000),
  }));

  async function getRateLimitedAuthentication(
    scope: AuthenticationRateLimitScope,
    requesterIp: string,
    reply: {
      code: (statusCode: number) => { send: (payload: unknown) => unknown };
      header: (name: string, value: string) => unknown;
    },
    errors: Readonly<{
      tooMany: string;
      unavailable: string;
    }> = {
      tooMany: 'Too many authentication attempts',
      unavailable: 'Authentication temporarily unavailable',
    },
  ): Promise<AuthenticationDependencies | undefined> {
    const authentication = await getAuthentication();
    try {
      await enforceAuthRateLimit(
        authentication.rateLimitStore,
        scope,
        requesterIp,
        authentication.rateLimitPolicies[scope],
      );
      return authentication;
    } catch (error) {
      if (error instanceof AuthRateLimitExceededError) {
        reply.header('Retry-After', String(error.retryAfterSeconds));
        reply.code(429).send({ error: errors.tooMany });
        return undefined;
      }
      if (error instanceof AuthRateLimitUnavailableError) {
        reply.code(503).send({ error: errors.unavailable });
        return undefined;
      }
      throw error;
    }
  }

  const sessionCookieIsSecure = env.NODE_ENV === 'production';
  const serializeSession = (session: ActiveSession) => ({
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    deviceLabel: session.deviceLabel,
    id: session.id,
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
  });
  const serializeManagedMember = (
    member: Awaited<ReturnType<AuthenticationDependencies['members']['list']>>[number],
  ) => ({
    createdAt: member.createdAt.toISOString(),
    email: member.email,
    emailVerified: member.emailVerified,
    id: member.id,
    monitorLimit: member.monitorLimit,
    status: member.status,
  });
  const serializeMonitor = (monitor: Monitor) => ({
    createdAt: monitor.createdAt.toISOString(),
    id: monitor.id,
    name: monitor.name,
    revision: monitor.revision,
    state: monitor.state,
    url: monitor.url,
  });
  const serializeMonitorSchedule = (schedule: MonitorSchedule) => ({
    customIntervalMinutes: schedule.customIntervalMinutes,
    dailyTime: schedule.dailyTime,
    hourlyMinute: schedule.hourlyMinute,
    scheduleType: schedule.scheduleType,
    timeZone: schedule.timeZone,
  });
  const serializeMonitorTarget = (target: MonitorTarget) => ({
    repeatedList: target.repeatedList,
    selector: target.selector,
    targetType: target.targetType,
  });
  const auditContext = (request: FastifyRequest) => ({
    requesterIpHash: hashAuditRequesterIp(request.ip),
    requestId: request.id,
  });

  async function getCurrentSession(request: FastifyRequest, reply: FastifyReply) {
    const token = readSessionCookie(request.headers.cookie);
    if (!token) {
      reply.code(401).send({ error: 'Unauthorized' });
      return undefined;
    }
    try {
      const authentication = await getAuthentication();
      const session = await authentication.sessions.authenticate(token);
      if (!session) {
        reply.header('Set-Cookie', clearSessionCookie(sessionCookieIsSecure));
        reply.code(401).send({ error: 'Unauthorized' });
        return undefined;
      }
      return { authentication, session, token };
    } catch {
      reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      return undefined;
    }
  }

  async function getCurrentOwnerSession(request: FastifyRequest, reply: FastifyReply) {
    const current = await getCurrentSession(request, reply);
    if (!current) {
      return undefined;
    }
    if (current.session.role !== 'owner') {
      reply.code(403).send({ error: 'Forbidden' });
      return undefined;
    }
    return current;
  }

  const invalidAuthenticationResponse = { error: 'Invalid authentication request' } as const;
  const invalidAccountDeletionConfirmationResponse = {
    error: 'Invalid account deletion confirmation',
  } as const;
  const invalidMonitorResponse = { error: 'Invalid monitor request' } as const;
  const invalidMonitorScheduleResponse = { error: 'Invalid monitor schedule' } as const;
  const invalidMonitorTargetResponse = { error: 'Invalid monitor target' } as const;
  const monitorLimitResponse = { error: 'Monitor limit reached' } as const;
  const monitorPreviewTargetNotAllowedResponse = {
    error: 'Preview target is not allowed',
  } as const;
  const monitorPreviewUnavailableResponse = { error: 'Preview unavailable' } as const;
  const tooManyMonitorPreviewRequestsResponse = { error: 'Too many preview attempts' } as const;
  const monitorRevisionConflictResponse = { error: 'Monitor has changed' } as const;
  const monitorStateConflictResponse = { error: 'Monitor state cannot be changed' } as const;
  const monitorUnavailableResponse = {
    error: 'Monitor configuration temporarily unavailable',
  } as const;
  const isInvalidAuthenticationRequest = (error: unknown) =>
    error instanceof AuthenticationTokenError ||
    error instanceof AuthenticationStateError ||
    error instanceof EmailValidationError ||
    error instanceof PasswordValidationError;
  const monitorRevision = (value: string | string[] | undefined) => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const match = /^"?([1-9][0-9]*)"?$/u.exec(value);
    if (!match) {
      return undefined;
    }
    const revision = Number(match[1]);
    return Number.isSafeInteger(revision) ? revision : undefined;
  };
  const sendMonitorError = (reply: FastifyReply, error: unknown) => {
    if (error instanceof MonitorAccessError) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (error instanceof MonitorInputError) {
      return reply.code(400).send(invalidMonitorResponse);
    }
    if (error instanceof MonitorScheduleValidationError) {
      return reply.code(400).send(invalidMonitorScheduleResponse);
    }
    if (error instanceof MonitorTargetValidationError) {
      return reply.code(400).send(invalidMonitorTargetResponse);
    }
    if (error instanceof MonitorLimitError) {
      return reply.code(409).send(monitorLimitResponse);
    }
    if (error instanceof MonitorNotFoundError) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (error instanceof MonitorScheduleNotFoundError) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (error instanceof MonitorRevisionConflictError) {
      return reply.code(409).send(monitorRevisionConflictResponse);
    }
    if (error instanceof MonitorStateError) {
      return reply.code(409).send(monitorStateConflictResponse);
    }
    return reply.code(503).send(monitorUnavailableResponse);
  };

  app.get(
    '/api/v1/system/diagnostics',
    {
      schema: {
        response: {
          200: DiagnosticsResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentOwnerSession(request, reply);
      if (!current) {
        return reply;
      }
      const diagnostics = await healthService.collectDiagnostics();
      return { ...serviceHealth(diagnostics.status), dependencies: diagnostics.dependencies };
    },
  );

  app.post<{ Body: { password: string; token: string } }>(
    '/api/v1/auth/owner-setup',
    {
      schema: {
        body: AuthenticationCredentials,
        response: {
          202: AuthenticationAcceptedResponse,
          400: InvalidAuthenticationRequestResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('redemption', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      try {
        if (!authentication.emailDelivery.enabled) {
          return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
        }
        const verification = await authentication.service.redeemOwnerSetup(
          request.body.token,
          request.body.password,
          auditContext(request),
        );
        try {
          await authentication.emailDelivery.sendVerification(verification);
        } catch {
          return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
        }
        return reply.code(202).send({ status: 'verification_required' });
      } catch (error) {
        if (isInvalidAuthenticationRequest(error)) {
          return reply.code(400).send(invalidAuthenticationResponse);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { password: string; token: string } }>(
    '/api/v1/auth/invitations/redeem',
    {
      schema: {
        body: AuthenticationCredentials,
        response: {
          202: AuthenticationAcceptedResponse,
          400: InvalidAuthenticationRequestResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('redemption', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      try {
        if (!authentication.emailDelivery.enabled) {
          return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
        }
        const verification = await authentication.service.redeemInvitation(
          request.body.token,
          request.body.password,
          auditContext(request),
        );
        try {
          await authentication.emailDelivery.sendVerification(verification);
        } catch {
          return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
        }
        return reply.code(202).send({ status: 'verification_required' });
      } catch (error) {
        if (isInvalidAuthenticationRequest(error)) {
          return reply.code(400).send(invalidAuthenticationResponse);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { token: string } }>(
    '/api/v1/auth/email-verifications/confirm',
    {
      schema: {
        body: TokenRequest,
        response: {
          204: Type.Null(),
          400: InvalidAuthenticationRequestResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('redemption', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      try {
        await authentication.service.confirmEmailVerification(
          request.body.token,
          auditContext(request),
        );
        return reply.code(204).send();
      } catch (error) {
        if (isInvalidAuthenticationRequest(error)) {
          return reply.code(400).send(invalidAuthenticationResponse);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { email: string } }>(
    '/api/v1/auth/email-verifications/resend',
    {
      schema: {
        body: EmailVerificationRequest,
        response: {
          202: AuthenticationAcceptedResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('redemption', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      if (!authentication.emailDelivery.enabled) {
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
      let verification: Awaited<
        ReturnType<AuthenticationDependencies['service']['requestEmailVerification']>
      >;
      try {
        verification = await authentication.service.requestEmailVerification(
          request.body.email,
          auditContext(request),
        );
      } catch (error) {
        if (error instanceof EmailValidationError) {
          return reply.code(202).send({ status: 'verification_required' });
        }
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
      if (verification) {
        try {
          await authentication.emailDelivery.sendVerification(verification);
        } catch {
          return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
        }
      }
      return reply.code(202).send({ status: 'verification_required' });
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    '/api/v1/auth/login',
    {
      schema: {
        body: LoginRequest,
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('login', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      try {
        const login = await authentication.service.login(request.body.email, request.body.password);
        if (!login) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        if (login.totpEnabled) {
          try {
            const challenge = await authentication.totp.createLoginChallenge(login.user.id);
            reply.header(
              'Set-Cookie',
              serializeTotpLoginChallengeCookie(
                challenge.token,
                challenge.expiresAt,
                new Date(now()),
                sessionCookieIsSecure,
              ),
            );
            return reply.code(202).send({ status: 'totp_required' });
          } catch {
            return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
          }
        }
        try {
          const issued = await authentication.sessions.issue(
            {
              deviceLabel: deviceLabel(request.headers['user-agent']),
              userId: login.user.id,
            },
            readSessionCookie(request.headers.cookie),
            auditContext(request),
          );
          reply.header(
            'Set-Cookie',
            serializeSessionCookie(
              issued.token,
              issued.expiresAt,
              new Date(now()),
              sessionCookieIsSecure,
            ),
          );
          return reply.code(204).send();
        } catch {
          return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
        }
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  );

  app.post<{ Body: { code?: string; recoveryCode?: string } }>(
    '/api/v1/auth/totp/login',
    {
      schema: {
        body: TotpProofRequest,
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('totp', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      const challengeToken = readTotpLoginChallengeCookie(request.headers.cookie);
      if (!challengeToken) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      try {
        const user = await authentication.totp.completeLogin(challengeToken, request.body);
        const issued = await authentication.sessions.issue(
          {
            deviceLabel: deviceLabel(request.headers['user-agent']),
            userId: user.userId,
          },
          readSessionCookie(request.headers.cookie),
          auditContext(request),
        );
        reply.header('Set-Cookie', [
          clearTotpLoginChallengeCookie(sessionCookieIsSecure),
          serializeSessionCookie(
            issued.token,
            issued.expiresAt,
            new Date(now()),
            sessionCookieIsSecure,
          ),
        ]);
        return reply.code(204).send();
      } catch (error) {
        if (
          error instanceof AuthenticationTokenError ||
          error instanceof AuthenticationStateError
        ) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.post<{ Body: { email: string } }>(
    '/api/v1/auth/password-resets',
    {
      schema: {
        body: PasswordResetRequest,
        response: {
          202: AuthenticationAcceptedResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('reset', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      try {
        await authentication.service.requestPasswordReset(request.body.email);
      } catch {
        // Return the same accepted response for invalid and unknown email addresses.
      }
      return reply.code(202).send({ status: 'reset_requested' });
    },
  );

  app.post<{ Body: { password: string; token: string } }>(
    '/api/v1/auth/password-resets/confirm',
    {
      schema: {
        body: AuthenticationCredentials,
        response: {
          204: Type.Null(),
          400: InvalidAuthenticationRequestResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('reset', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      try {
        await authentication.service.completePasswordReset(
          request.body.token,
          request.body.password,
          auditContext(request),
        );
        return reply.code(204).send();
      } catch (error) {
        if (isInvalidAuthenticationRequest(error)) {
          return reply.code(400).send(invalidAuthenticationResponse);
        }
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/auth/logout',
    {
      schema: {
        response: {
          204: Type.Null(),
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const token = readSessionCookie(request.headers.cookie);
      if (token) {
        try {
          const authentication = await getAuthentication();
          await authentication.sessions.revokeByToken(token, auditContext(request));
        } catch {
          return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
        }
      }
      reply.header('Set-Cookie', clearSessionCookie(sessionCookieIsSecure));
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/v1/account/totp',
    {
      schema: {
        response: {
          200: TotpStatusResponse,
          401: UnauthorizedResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        return { enabled: await current.authentication.totp.isEnabled(current.session.userId) };
      } catch {
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.post(
    '/api/v1/account/totp/enrollments',
    {
      schema: {
        response: {
          200: TotpEnrollmentResponse,
          400: InvalidAuthenticationRequestResponse,
          401: UnauthorizedResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        return await current.authentication.totp.beginEnrollment(
          {
            email: current.session.email,
            userId: current.session.userId,
          },
          auditContext(request),
        );
      } catch (error) {
        if (error instanceof AuthenticationStateError) {
          return reply.code(400).send(invalidAuthenticationResponse);
        }
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.post<{ Body: { code: string } }>(
    '/api/v1/account/totp/enrollments/confirm',
    {
      schema: {
        body: TotpCodeRequest,
        response: {
          200: RecoveryCodesResponse,
          400: InvalidAuthenticationRequestResponse,
          401: UnauthorizedResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('totp', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        return {
          recoveryCodes: await current.authentication.totp.confirmEnrollment(
            current.session.userId,
            current.session.id,
            request.body.code,
            auditContext(request),
          ),
        };
      } catch (error) {
        if (error instanceof AuthenticationTokenError) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        if (error instanceof AuthenticationStateError) {
          return reply.code(400).send(invalidAuthenticationResponse);
        }
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.post<{ Body: { code?: string; recoveryCode?: string } }>(
    '/api/v1/account/totp/recovery-codes',
    {
      schema: {
        body: TotpProofRequest,
        response: {
          200: RecoveryCodesResponse,
          401: UnauthorizedResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('totp', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        return {
          recoveryCodes: await current.authentication.totp.replaceRecoveryCodes(
            current.session.userId,
            current.session.id,
            request.body,
            auditContext(request),
          ),
        };
      } catch (error) {
        if (
          error instanceof AuthenticationTokenError ||
          error instanceof AuthenticationStateError
        ) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.delete<{ Body: { code?: string; recoveryCode?: string } }>(
    '/api/v1/account/totp',
    {
      schema: {
        body: TotpProofRequest,
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('totp', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        await current.authentication.totp.disable(
          current.session.userId,
          current.session.id,
          request.body,
          auditContext(request),
        );
        return reply.code(204).send();
      } catch (error) {
        if (
          error instanceof AuthenticationTokenError ||
          error instanceof AuthenticationStateError
        ) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.post<{ Body: { code?: string; password: string; recoveryCode?: string } }>(
    '/api/v1/account/deletion',
    {
      schema: {
        body: AccountDeletionRequest,
        response: {
          200: AccountDeletionScheduledResponse,
          401: Type.Union([UnauthorizedResponse, InvalidAccountDeletionConfirmationResponse]),
          409: AccountDeletionConflictResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('deletion', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        if (
          !(await current.authentication.service.verifyCurrentPassword(
            current.session.userId,
            request.body.password,
          ))
        ) {
          return reply.code(401).send(invalidAccountDeletionConfirmationResponse);
        }
        const factorEnabled = await current.authentication.totp.isEnabled(current.session.userId);
        if (factorEnabled) {
          const proof =
            request.body.code !== undefined
              ? { code: request.body.code }
              : request.body.recoveryCode !== undefined
                ? { recoveryCode: request.body.recoveryCode }
                : {};
          await current.authentication.totp.verify(current.session.userId, proof);
        } else if (request.body.code !== undefined || request.body.recoveryCode !== undefined) {
          return reply.code(401).send(invalidAccountDeletionConfirmationResponse);
        }
        const deletion = await current.authentication.accountDeletion.request(
          current.session.userId,
          auditContext(request),
        );
        reply.header('Set-Cookie', clearSessionCookie(sessionCookieIsSecure));
        return {
          deletionDeadline: deletion.deadline.toISOString(),
          recoveryToken: deletion.token,
        };
      } catch (error) {
        if (error instanceof AuthenticationTokenError) {
          return reply.code(401).send(invalidAccountDeletionConfirmationResponse);
        }
        if (error instanceof AccountDeletionStateError) {
          return reply.code(409).send({ error: 'Account deletion cannot be completed' });
        }
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.post<{ Body: { token: string } }>(
    '/api/v1/account/deletion/recover',
    {
      schema: {
        body: AccountDeletionRecoveryRequest,
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          429: TooManyRequestsResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const authentication = await getRateLimitedAuthentication('deletion', request.ip, reply);
      if (!authentication) {
        return reply;
      }
      try {
        await authentication.accountDeletion.recover(request.body.token, auditContext(request));
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof AccountDeletionTokenError) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.get(
    '/api/v1/monitors',
    {
      schema: {
        response: {
          200: MonitorsResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const monitors = await current.authentication.monitors.list(current.session.userId);
        return { monitors: monitors.map(serializeMonitor) };
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.post<{ Body: { name: string; url: string } }>(
    '/api/v1/monitors',
    {
      schema: {
        body: MonitorConfiguration,
        response: {
          201: MonitorSummary,
          400: InvalidMonitorRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          409: MonitorLimitResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const monitor = await current.authentication.monitors.create(
          current.session.userId,
          request.body,
        );
        return reply
          .code(201)
          .header('ETag', `"${monitor.revision}"`)
          .send(serializeMonitor(monitor));
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.get<{ Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId/schedule',
    {
      schema: {
        params: MonitorIdParameters,
        response: {
          200: MonitorScheduleResponse,
          400: InvalidMonitorScheduleRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const result = await current.authentication.monitors.getSchedule(
          current.session.userId,
          request.params.monitorId,
        );
        return reply.header('ETag', `"${result.monitor.revision}"`).send({
          monitor: serializeMonitor(result.monitor),
          schedule: result.schedule ? serializeMonitorSchedule(result.schedule) : null,
        });
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.put<{ Body: Static<typeof MonitorScheduleConfiguration>; Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId/schedule',
    {
      schema: {
        body: MonitorScheduleConfiguration,
        params: MonitorIdParameters,
        response: {
          200: MonitorScheduleResponse,
          400: InvalidMonitorScheduleRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MonitorRevisionConflictResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      const expectedRevision = monitorRevision(request.headers['if-match']);
      if (!expectedRevision) {
        return reply.code(400).send(invalidMonitorScheduleResponse);
      }
      try {
        const result = await current.authentication.monitors.updateSchedule(
          current.session.userId,
          request.params.monitorId,
          expectedRevision,
          request.body,
        );
        return reply.header('ETag', `"${result.monitor.revision}"`).send({
          monitor: serializeMonitor(result.monitor),
          schedule: serializeMonitorSchedule(result.schedule),
        });
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.delete<{ Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId/schedule',
    {
      schema: {
        params: MonitorIdParameters,
        response: {
          200: MonitorScheduleResponse,
          400: InvalidMonitorScheduleRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MonitorRevisionConflictResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      const expectedRevision = monitorRevision(request.headers['if-match']);
      if (!expectedRevision) {
        return reply.code(400).send(invalidMonitorScheduleResponse);
      }
      try {
        const monitor = await current.authentication.monitors.deleteSchedule(
          current.session.userId,
          request.params.monitorId,
          expectedRevision,
        );
        return reply.header('ETag', `"${monitor.revision}"`).send({
          monitor: serializeMonitor(monitor),
          schedule: null,
        });
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.get<{ Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId/target',
    {
      schema: {
        params: MonitorIdParameters,
        response: {
          200: MonitorTargetResponse,
          400: InvalidMonitorTargetRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const result = await current.authentication.monitors.getTarget(
          current.session.userId,
          request.params.monitorId,
        );
        return reply.header('ETag', `"${result.monitor.revision}"`).send({
          monitor: serializeMonitor(result.monitor),
          target: serializeMonitorTarget(result.target),
        });
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.put<{ Body: Static<typeof MonitorTargetConfiguration>; Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId/target',
    {
      schema: {
        body: MonitorTargetConfiguration,
        params: MonitorIdParameters,
        response: {
          200: MonitorTargetResponse,
          400: InvalidMonitorTargetRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MonitorRevisionConflictResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      const expectedRevision = monitorRevision(request.headers['if-match']);
      if (!expectedRevision) {
        return reply.code(400).send(invalidMonitorTargetResponse);
      }
      try {
        const result = await current.authentication.monitors.updateTarget(
          current.session.userId,
          request.params.monitorId,
          expectedRevision,
          request.body,
        );
        return reply.header('ETag', `"${result.monitor.revision}"`).send({
          monitor: serializeMonitor(result.monitor),
          target: serializeMonitorTarget(result.target),
        });
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.post<{ Body: Static<typeof MonitorTargetConfiguration>; Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId/target/preview',
    {
      schema: {
        body: MonitorTargetConfiguration,
        params: MonitorIdParameters,
        response: {
          200: MonitorTargetPreviewResponse,
          400: InvalidMonitorTargetRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          422: MonitorPreviewFailureResponse,
          429: TooManyMonitorPreviewRequestsResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      const authentication = await getRateLimitedAuthentication('preview', request.ip, reply, {
        tooMany: tooManyMonitorPreviewRequestsResponse.error,
        unavailable: monitorUnavailableResponse.error,
      });
      if (!authentication) {
        return reply;
      }
      try {
        const monitor = await authentication.monitors.get(
          current.session.userId,
          request.params.monitorId,
        );
        return { preview: await monitorPreview.preview(monitor, request.body) };
      } catch (error) {
        if (error instanceof MonitorTargetValidationError) {
          return reply.code(400).send(invalidMonitorTargetResponse);
        }
        if (error instanceof MonitorPreviewError) {
          return error.code === 'destination_not_allowed'
            ? reply.code(422).send(monitorPreviewTargetNotAllowedResponse)
            : reply.code(422).send(monitorPreviewUnavailableResponse);
        }
        return sendMonitorError(reply, error);
      }
    },
  );

  app.get<{ Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId',
    {
      schema: {
        params: MonitorIdParameters,
        response: {
          200: MonitorSummary,
          400: InvalidMonitorRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const monitor = await current.authentication.monitors.get(
          current.session.userId,
          request.params.monitorId,
        );
        return reply.header('ETag', `"${monitor.revision}"`).send(serializeMonitor(monitor));
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.put<{ Body: { name: string; url: string }; Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId',
    {
      schema: {
        body: MonitorConfiguration,
        params: MonitorIdParameters,
        response: {
          200: MonitorSummary,
          400: InvalidMonitorRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MonitorRevisionConflictResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      const expectedRevision = monitorRevision(request.headers['if-match']);
      if (!expectedRevision) {
        return reply.code(400).send(invalidMonitorResponse);
      }
      try {
        const monitor = await current.authentication.monitors.update(
          current.session.userId,
          request.params.monitorId,
          expectedRevision,
          request.body,
        );
        return reply.header('ETag', `"${monitor.revision}"`).send(serializeMonitor(monitor));
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  async function transitionCurrentMonitor(
    request: FastifyRequest<{ Params: { monitorId: string } }>,
    reply: FastifyReply,
    transition: (
      authentication: AuthenticationDependencies,
      userId: string,
      monitorId: string,
      expectedRevision: number,
    ) => Promise<Monitor>,
  ) {
    const current = await getCurrentSession(request, reply);
    if (!current) {
      return reply;
    }
    const expectedRevision = monitorRevision(request.headers['if-match']);
    if (!expectedRevision) {
      return reply.code(400).send(invalidMonitorResponse);
    }
    try {
      const monitor = await transition(
        current.authentication,
        current.session.userId,
        request.params.monitorId,
        expectedRevision,
      );
      return reply.header('ETag', `"${monitor.revision}"`).send(serializeMonitor(monitor));
    } catch (error) {
      return sendMonitorError(reply, error);
    }
  }

  app.post<{ Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId/pause',
    {
      schema: {
        params: MonitorIdParameters,
        response: {
          200: MonitorSummary,
          400: InvalidMonitorRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MonitorMutationConflictResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    (request, reply) =>
      transitionCurrentMonitor(
        request,
        reply,
        (authentication, userId, monitorId, expectedRevision) =>
          authentication.monitors.pause(userId, monitorId, expectedRevision),
      ),
  );

  app.post<{ Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId/resume',
    {
      schema: {
        params: MonitorIdParameters,
        response: {
          200: MonitorSummary,
          400: InvalidMonitorRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MonitorMutationConflictResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    (request, reply) =>
      transitionCurrentMonitor(
        request,
        reply,
        (authentication, userId, monitorId, expectedRevision) =>
          authentication.monitors.resume(userId, monitorId, expectedRevision),
      ),
  );

  app.delete<{ Params: { monitorId: string } }>(
    '/api/v1/monitors/:monitorId',
    {
      schema: {
        params: MonitorIdParameters,
        response: {
          204: Type.Null(),
          400: InvalidMonitorRequestResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MonitorRevisionConflictResponse,
          503: MonitorUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      const expectedRevision = monitorRevision(request.headers['if-match']);
      if (!expectedRevision) {
        return reply.code(400).send(invalidMonitorResponse);
      }
      try {
        await current.authentication.monitors.delete(
          current.session.userId,
          request.params.monitorId,
          expectedRevision,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendMonitorError(reply, error);
      }
    },
  );

  app.get(
    '/api/v1/account/sessions',
    {
      schema: {
        response: {
          200: ActiveSessionsResponse,
          401: UnauthorizedResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const sessions = await current.authentication.sessions.list(current.session.userId);
        return {
          sessions: sessions.map((session) => ({
            ...serializeSession(session),
            current: session.id === current.session.id,
          })),
        };
      } catch {
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.delete<{ Params: { sessionId: string } }>(
    '/api/v1/account/sessions/:sessionId',
    {
      schema: {
        params: SessionIdParameters,
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const revoked = await current.authentication.sessions.revoke(
          current.session.userId,
          request.params.sessionId,
          auditContext(request),
        );
        if (revoked && request.params.sessionId === current.session.id) {
          reply.header('Set-Cookie', clearSessionCookie(sessionCookieIsSecure));
        }
        return reply.code(204).send();
      } catch {
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.post(
    '/api/v1/account/sessions/revoke-others',
    {
      schema: {
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        await current.authentication.sessions.revokeOthers(
          current.session.userId,
          current.session.id,
          auditContext(request),
        );
        return reply.code(204).send();
      } catch {
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.get(
    '/api/v1/owner/audit-events',
    {
      schema: {
        response: {
          200: AuditEventsResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentOwnerSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const events = await current.authentication.audit.list();
        return {
          events: events.map((event) => ({
            action: event.action,
            actorUserId: event.actorUserId ?? null,
            createdAt: event.createdAt.toISOString(),
            id: event.id,
            targetId: event.targetId ?? null,
            targetType: event.targetType,
          })),
        };
      } catch {
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  app.get(
    '/api/v1/owner/members',
    {
      schema: {
        response: {
          200: ManagedMembersResponse,
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    async (request, reply) => {
      const current = await getCurrentOwnerSession(request, reply);
      if (!current) {
        return reply;
      }
      try {
        const members = await current.authentication.members.list();
        return { members: members.map(serializeManagedMember) };
      } catch {
        return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
      }
    },
  );

  async function completeOwnerMemberAction(
    request: FastifyRequest<{ Params: { memberId: string } }>,
    reply: FastifyReply,
    action: (
      authentication: AuthenticationDependencies,
      memberId: string,
      audit: Readonly<{ actorUserId: string; requesterIpHash: string; requestId: string }>,
    ) => Promise<void>,
  ) {
    const current = await getCurrentOwnerSession(request, reply);
    if (!current) {
      return reply;
    }
    try {
      await action(current.authentication, request.params.memberId, {
        ...auditContext(request),
        actorUserId: current.session.userId,
      });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof MemberNotFoundError) {
        return reply.code(404).send({ error: 'Not found' });
      }
      if (error instanceof MemberLifecycleStateError) {
        return reply.code(409).send({ error: 'Member lifecycle action cannot be completed' });
      }
      return reply.code(503).send({ error: 'Authentication temporarily unavailable' });
    }
  }

  app.post<{ Params: { memberId: string } }>(
    '/api/v1/owner/members/:memberId/suspend',
    {
      schema: {
        params: MemberIdParameters,
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MemberLifecycleConflictResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    (request, reply) =>
      completeOwnerMemberAction(request, reply, (authentication, memberId, audit) =>
        authentication.members.suspend(memberId, audit),
      ),
  );

  app.post<{ Params: { memberId: string } }>(
    '/api/v1/owner/members/:memberId/reactivate',
    {
      schema: {
        params: MemberIdParameters,
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          409: MemberLifecycleConflictResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    (request, reply) =>
      completeOwnerMemberAction(request, reply, (authentication, memberId, audit) =>
        authentication.members.reactivate(memberId, audit),
      ),
  );

  app.delete<{ Params: { memberId: string } }>(
    '/api/v1/owner/members/:memberId',
    {
      schema: {
        params: MemberIdParameters,
        response: {
          204: Type.Null(),
          401: UnauthorizedResponse,
          403: ForbiddenResponse,
          404: NotFoundResponse,
          503: AuthenticationUnavailableResponse,
        },
      },
    },
    (request, reply) =>
      completeOwnerMemberAction(request, reply, (authentication, memberId, audit) =>
        authentication.members.remove(memberId, audit),
      ),
  );

  return app;
}
