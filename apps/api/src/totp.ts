import {
  createOpaqueToken,
  createRecoveryCodes,
  createTotpProvisioningUri,
  createTotpSecret,
  decryptTotpSecret,
  encryptTotpSecret,
  hashOpaqueToken,
  hashRecoveryCode,
  verifyTotpCode,
} from '@pagepulse/auth';
import {
  AuthenticationStateError,
  AuthenticationTokenError,
  beginTotpEnrollment,
  consumeTotpLoginChallenge,
  consumeTotpRecoveryCode,
  createTotpLoginChallenge,
  disableTotpMethod,
  enableTotpMethod,
  findTotpEnrollmentForUpdate,
  findTotpLoginChallengeForUpdate,
  findTotpMethodForUpdate,
  hasTotpMethod,
  recordTotpTimeStep,
  replaceTotpRecoveryCodes,
  revokeSessionsForUser,
  type TotpLoginChallenge,
  type TotpPool,
  withTotpTransaction,
} from '@pagepulse/db';

export const TOTP_LOGIN_CHALLENGE_COOKIE_NAME = 'pagepulse_totp_challenge';

const loginChallengeLifetimeMinutes = 5;
const enrollmentLifetimeMinutes = 10;

export type TotpProof = Readonly<{
  code?: string;
  recoveryCode?: string;
}>;

export type TotpEnrollment = Readonly<{
  manualEntryKey: string;
  otpauthUri: string;
}>;

export type TotpLoginChallengeIssue = Readonly<{
  expiresAt: Date;
  token: string;
}>;

export type TotpService = Readonly<{
  beginEnrollment: (input: Readonly<{ email: string; userId: string }>) => Promise<TotpEnrollment>;
  completeLogin: (challengeToken: string, proof: TotpProof) => Promise<TotpLoginChallenge>;
  confirmEnrollment: (
    userId: string,
    currentSessionId: string,
    code: string,
  ) => Promise<ReadonlyArray<string>>;
  createLoginChallenge: (userId: string) => Promise<TotpLoginChallengeIssue>;
  disable: (userId: string, currentSessionId: string, proof: TotpProof) => Promise<void>;
  isEnabled: (userId: string) => Promise<boolean>;
  replaceRecoveryCodes: (
    userId: string,
    currentSessionId: string,
    proof: TotpProof,
  ) => Promise<ReadonlyArray<string>>;
}>;

export type TotpServiceOptions = Readonly<{
  encryptionKey: string | undefined;
  issuer?: string;
  now?: () => Date;
  pool: TotpPool;
}>;

function expiresAfterMinutes(minutes: number, now: Date) {
  return new Date(now.getTime() + minutes * 60_000);
}

function requireEncryptionKey(value: string | undefined) {
  if (!value) {
    throw new Error('TOTP_ENCRYPTION_KEK must be configured before TOTP can be used');
  }
  return value;
}

function opaqueCookieAttributes(secure: boolean) {
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function readTotpLoginChallengeCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return undefined;
  }
  let token: string | undefined;
  for (const item of cookieHeader.split(';')) {
    const [name, ...valueParts] = item.trim().split('=');
    if (name !== TOTP_LOGIN_CHALLENGE_COOKIE_NAME || valueParts.length !== 1) {
      continue;
    }
    const value = valueParts[0];
    if (!value || !/^[A-Za-z0-9_-]{43}$/u.test(value) || token) {
      return undefined;
    }
    token = value;
  }
  return token;
}

export function serializeTotpLoginChallengeCookie(
  token: string,
  expiresAt: Date,
  now: Date,
  secure: boolean,
) {
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000));
  return `${TOTP_LOGIN_CHALLENGE_COOKIE_NAME}=${token}; Max-Age=${maxAge}; ${opaqueCookieAttributes(secure)}`;
}

export function clearTotpLoginChallengeCookie(secure: boolean) {
  return `${TOTP_LOGIN_CHALLENGE_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${opaqueCookieAttributes(secure)}`;
}

function hasExactlyOneProof(proof: TotpProof) {
  return (proof.code !== undefined) !== (proof.recoveryCode !== undefined);
}

export function createTotpService({
  encryptionKey,
  issuer = 'PagePulse',
  now = () => new Date(),
  pool,
}: TotpServiceOptions): TotpService {
  async function verifyCurrentFactor(
    connection: Parameters<typeof findTotpMethodForUpdate>[0],
    userId: string,
    proof: TotpProof,
    current: Date,
  ) {
    if (!hasExactlyOneProof(proof)) {
      throw new AuthenticationTokenError();
    }
    const method = await findTotpMethodForUpdate(connection, userId);
    const key = requireEncryptionKey(encryptionKey);
    if (proof.code !== undefined) {
      const timeStep = verifyTotpCode(
        decryptTotpSecret(method.encryptedSecret, key, userId),
        proof.code,
        current,
      );
      if (
        timeStep === undefined ||
        (method.lastVerifiedTimeStep !== undefined && timeStep <= method.lastVerifiedTimeStep)
      ) {
        throw new AuthenticationTokenError();
      }
      await recordTotpTimeStep(connection, userId, timeStep, current);
      return;
    }
    const consumed = await consumeTotpRecoveryCode(
      connection,
      userId,
      hashRecoveryCode(proof.recoveryCode!, key, userId),
      current,
    );
    if (!consumed) {
      throw new AuthenticationTokenError();
    }
  }

  return {
    async beginEnrollment(input) {
      const current = now();
      const key = requireEncryptionKey(encryptionKey);
      const secret = createTotpSecret();
      await withTotpTransaction(pool, async (connection) => {
        if (await hasTotpMethod(connection, input.userId)) {
          throw new AuthenticationStateError('an authenticator app is already enabled');
        }
        await beginTotpEnrollment(
          connection,
          {
            encryptedSecret: encryptTotpSecret(secret, key, input.userId),
            expiresAt: expiresAfterMinutes(enrollmentLifetimeMinutes, current),
            userId: input.userId,
          },
          current,
        );
      });
      return {
        manualEntryKey: secret,
        otpauthUri: createTotpProvisioningUri(issuer, input.email, secret),
      };
    },

    async completeLogin(challengeToken, proof) {
      const current = now();
      return withTotpTransaction(pool, async (connection) => {
        const challenge = await findTotpLoginChallengeForUpdate(
          connection,
          hashOpaqueToken(challengeToken),
          current,
        );
        await verifyCurrentFactor(connection, challenge.userId, proof, current);
        await consumeTotpLoginChallenge(connection, challenge.challengeId, current);
        return challenge;
      });
    },

    async confirmEnrollment(userId, currentSessionId, code) {
      const current = now();
      const key = requireEncryptionKey(encryptionKey);
      const recoveryCodes = createRecoveryCodes();
      await withTotpTransaction(pool, async (connection) => {
        if (await hasTotpMethod(connection, userId)) {
          throw new AuthenticationStateError('an authenticator app is already enabled');
        }
        const enrollment = await findTotpEnrollmentForUpdate(connection, userId, current);
        const timeStep = verifyTotpCode(
          decryptTotpSecret(enrollment.encryptedSecret, key, userId),
          code,
          current,
        );
        if (timeStep === undefined) {
          throw new AuthenticationTokenError();
        }
        await enableTotpMethod(
          connection,
          {
            encryptedSecret: enrollment.encryptedSecret,
            initialVerifiedTimeStep: timeStep,
            recoveryCodeHashes: recoveryCodes.map((recoveryCode) =>
              hashRecoveryCode(recoveryCode, key, userId),
            ),
            userId,
          },
          currentSessionId,
          current,
        );
      });
      return recoveryCodes;
    },

    async createLoginChallenge(userId) {
      const current = now();
      const token = createOpaqueToken();
      const expiresAt = expiresAfterMinutes(loginChallengeLifetimeMinutes, current);
      await withTotpTransaction(pool, (connection) =>
        createTotpLoginChallenge(
          connection,
          { expiresAt, tokenHash: hashOpaqueToken(token), userId },
          current,
        ),
      );
      return { expiresAt, token };
    },

    async disable(userId, currentSessionId, proof) {
      const current = now();
      await withTotpTransaction(pool, async (connection) => {
        await verifyCurrentFactor(connection, userId, proof, current);
        await disableTotpMethod(connection, userId, currentSessionId, current);
      });
    },

    async isEnabled(userId) {
      return withTotpTransaction(pool, (connection) => hasTotpMethod(connection, userId));
    },

    async replaceRecoveryCodes(userId, currentSessionId, proof) {
      const current = now();
      const key = requireEncryptionKey(encryptionKey);
      const recoveryCodes = createRecoveryCodes();
      await withTotpTransaction(pool, async (connection) => {
        await verifyCurrentFactor(connection, userId, proof, current);
        await replaceTotpRecoveryCodes(connection, {
          recoveryCodeHashes: recoveryCodes.map((recoveryCode) =>
            hashRecoveryCode(recoveryCode, key, userId),
          ),
          userId,
        });
        await revokeSessionsForUser(connection, userId, current, currentSessionId);
      });
      return recoveryCodes;
    },
  };
}
