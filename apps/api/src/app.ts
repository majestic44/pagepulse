import { timingSafeEqual } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import Fastify from 'fastify';
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
  probeDatabase,
} from '@pagepulse/db';
import {
  AuthenticationAcceptedResponse,
  AuthenticationUnavailableResponse,
  AuthenticationCredentials,
  DiagnosticsResponse,
  HealthResponse,
  InvalidAuthenticationRequestResponse,
  LoginRequest,
  PasswordResetRequest,
  TokenRequest,
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

function hasOwnerDiagnosticsAccess(authorization: string | undefined, token: string) {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(authorization ?? '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function authenticationRateLimitPolicies(
  environment: Environment,
): AuthenticationRateLimitPolicies {
  return {
    login: {
      limit: environment.AUTH_LOGIN_RATE_LIMIT_MAX,
      windowMs: environment.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
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

  if (env.OWNER_DIAGNOSTICS_TOKEN) {
    app.get(
      '/api/v1/system/diagnostics',
      {
        preHandler: async (request, reply) => {
          if (
            !hasOwnerDiagnosticsAccess(request.headers.authorization, env.OWNER_DIAGNOSTICS_TOKEN!)
          ) {
            return reply.code(401).send({ error: 'Unauthorized' });
          }
        },
        schema: { response: { 200: DiagnosticsResponse, 401: UnauthorizedResponse } },
      },
      async () => {
        const diagnostics = await healthService.collectDiagnostics();
        return { ...serviceHealth(diagnostics.status), dependencies: diagnostics.dependencies };
      },
    );
  }

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

  const invalidAuthenticationResponse = { error: 'Invalid authentication request' } as const;
  const isInvalidAuthenticationRequest = (error: unknown) =>
    error instanceof AuthenticationTokenError ||
    error instanceof AuthenticationStateError ||
    error instanceof EmailValidationError ||
    error instanceof PasswordValidationError;

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
        const authenticated = await authentication.service.login(
          request.body.email,
          request.body.password,
        );
        return authenticated
          ? reply.code(204).send()
          : reply.code(401).send({ error: 'Unauthorized' });
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
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

  return app;
}
