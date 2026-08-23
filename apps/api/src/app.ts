import { Type } from '@sinclair/typebox';
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
  AuthenticationStateError,
  AuthenticationTokenError,
  createDatabasePool,
  MemberLifecycleStateError,
  MemberNotFoundError,
  probeDatabase,
  type ActiveSession,
} from '@pagepulse/db';
import {
  ActiveSessionsResponse,
  AuthenticationAcceptedResponse,
  AuthenticationUnavailableResponse,
  AuthenticationCredentials,
  DiagnosticsResponse,
  ForbiddenResponse,
  HealthResponse,
  InvalidAuthenticationRequestResponse,
  LoginRequest,
  ManagedMembersResponse,
  MemberIdParameters,
  MemberLifecycleConflictResponse,
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
  UnauthorizedResponse,
  VersionResponse,
} from '@pagepulse/contracts';
import { createRedisConnection, probeRedis } from '@pagepulse/queue';
import {
  createAuthenticationService,
  type AuthenticationDependencies,
  type AuthenticationRateLimitPolicies,
} from './auth.js';
import { createHealthService, type HealthService } from './health.js';
import { createMemberService } from './members.js';
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
  now?: () => number;
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
    login: {
      limit: environment.AUTH_LOGIN_RATE_LIMIT_MAX,
      windowMs: environment.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
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
      close: async () => {
        await Promise.allSettled([pool.end(), redis.quit()]);
      },
      rateLimitPolicies: authenticationRateLimitPolicies(environment),
      rateLimitStore: new RedisFixedWindowRateLimitStore(redis),
      service,
      members: createMemberService({ pool }),
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
        reply.code(429).send({ error: 'Too many authentication attempts' });
        return undefined;
      }
      if (error instanceof AuthRateLimitUnavailableError) {
        reply.code(503).send({ error: 'Authentication temporarily unavailable' });
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
  const isInvalidAuthenticationRequest = (error: unknown) =>
    error instanceof AuthenticationTokenError ||
    error instanceof AuthenticationStateError ||
    error instanceof EmailValidationError ||
    error instanceof PasswordValidationError;

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
        await authentication.service.redeemOwnerSetup(request.body.token, request.body.password);
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
        await authentication.service.redeemInvitation(request.body.token, request.body.password);
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
        await authentication.service.confirmEmailVerification(request.body.token);
        return reply.code(204).send();
      } catch (error) {
        if (isInvalidAuthenticationRequest(error)) {
          return reply.code(400).send(invalidAuthenticationResponse);
        }
        throw error;
      }
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
          await authentication.sessions.revokeByToken(token);
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
        return await current.authentication.totp.beginEnrollment({
          email: current.session.email,
          userId: current.session.userId,
        });
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
        );
        return reply.code(204).send();
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
    action: (authentication: AuthenticationDependencies, memberId: string) => Promise<void>,
  ) {
    const current = await getCurrentOwnerSession(request, reply);
    if (!current) {
      return reply;
    }
    try {
      await action(current.authentication, request.params.memberId);
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
      completeOwnerMemberAction(request, reply, (authentication, memberId) =>
        authentication.members.suspend(memberId),
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
      completeOwnerMemberAction(request, reply, (authentication, memberId) =>
        authentication.members.reactivate(memberId),
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
      completeOwnerMemberAction(request, reply, (authentication, memberId) =>
        authentication.members.remove(memberId),
      ),
  );

  return app;
}
