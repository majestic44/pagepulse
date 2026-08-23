import {
  type Argon2idParameters,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  type RateLimitStore,
  verifyPassword,
} from '@pagepulse/auth';
import {
  type AuthPool,
  type AuthenticationUser,
  AccountTokenTypes,
  findAuthenticationUser,
  issuePasswordReset,
  redeemInvitation,
  redeemOwnerSetup,
  resetPassword,
  hasTotpMethod,
  verifyEmailAddress,
  withAuthenticationTransaction,
} from '@pagepulse/db';

import type { SessionService } from './session.js';
import type { TotpService } from './totp.js';

export type AuthenticationTokenIssue = Readonly<{
  expiresAt: Date;
  token: string;
}>;

export type AuthenticationLogin = Readonly<{
  totpEnabled: boolean;
  user: AuthenticationUser;
}>;

export type AuthenticationService = Readonly<{
  completePasswordReset: (token: string, password: string) => Promise<void>;
  confirmEmailVerification: (token: string) => Promise<void>;
  login: (email: string, password: string) => Promise<AuthenticationLogin | undefined>;
  redeemInvitation: (token: string, password: string) => Promise<AuthenticationTokenIssue>;
  redeemOwnerSetup: (token: string, password: string) => Promise<AuthenticationTokenIssue>;
  requestPasswordReset: (email: string) => Promise<AuthenticationTokenIssue | undefined>;
}>;

export type AuthenticationServiceOptions = Readonly<{
  emailVerificationTokenTtlMinutes: number;
  passwordHashing: Argon2idParameters;
  passwordResetTokenTtlMinutes: number;
  pool: AuthPool;
}>;

function expiresAfterMinutes(minutes: number, now = new Date()) {
  return new Date(now.getTime() + minutes * 60_000);
}

function createVerificationToken(minutes: number) {
  const token = createOpaqueToken();
  return {
    expiresAt: expiresAfterMinutes(minutes),
    token,
    tokenHash: hashOpaqueToken(token),
    type: AccountTokenTypes.emailVerification,
  } as const;
}

function createPasswordResetToken(minutes: number) {
  const token = createOpaqueToken();
  return {
    expiresAt: expiresAfterMinutes(minutes),
    token,
    tokenHash: hashOpaqueToken(token),
    type: AccountTokenTypes.passwordReset,
  } as const;
}

function hasActiveVerifiedPassword(user: AuthenticationUser | undefined) {
  return Boolean(
    user && user.status === 'active' && user.emailVerified && user.passwordHash !== null,
  );
}

export async function createAuthenticationService({
  emailVerificationTokenTtlMinutes,
  passwordHashing,
  passwordResetTokenTtlMinutes,
  pool,
}: AuthenticationServiceOptions): Promise<AuthenticationService> {
  const dummyPasswordHash = await hashPassword('pagepulse-login-dummy-password', passwordHashing);

  return {
    async completePasswordReset(token, password) {
      const passwordHash = await hashPassword(password, passwordHashing);
      await withAuthenticationTransaction(pool, (connection) =>
        resetPassword(connection, { passwordHash, resetTokenHash: hashOpaqueToken(token) }),
      );
    },

    async confirmEmailVerification(token) {
      await withAuthenticationTransaction(pool, (connection) =>
        verifyEmailAddress(connection, hashOpaqueToken(token)),
      );
    },

    async login(email, password) {
      const user = await withAuthenticationTransaction(pool, (connection) =>
        findAuthenticationUser(connection, email),
      );
      const passwordMatches = await verifyPassword(
        password,
        user?.passwordHash ?? dummyPasswordHash,
      );
      if (!passwordMatches || !user || !hasActiveVerifiedPassword(user)) {
        return undefined;
      }
      const totpEnabled = await withAuthenticationTransaction(pool, (connection) =>
        hasTotpMethod(connection, user.id),
      );
      return { totpEnabled, user };
    },

    async redeemInvitation(token, password) {
      const passwordHash = await hashPassword(password, passwordHashing);
      const verification = createVerificationToken(emailVerificationTokenTtlMinutes);
      await withAuthenticationTransaction(pool, (connection) =>
        redeemInvitation(connection, {
          invitationTokenHash: hashOpaqueToken(token),
          passwordHash,
          verificationToken: verification,
        }),
      );
      return { expiresAt: verification.expiresAt, token: verification.token };
    },

    async redeemOwnerSetup(token, password) {
      const passwordHash = await hashPassword(password, passwordHashing);
      const verification = createVerificationToken(emailVerificationTokenTtlMinutes);
      await withAuthenticationTransaction(pool, (connection) =>
        redeemOwnerSetup(connection, {
          passwordHash,
          setupTokenHash: hashOpaqueToken(token),
          verificationToken: verification,
        }),
      );
      return { expiresAt: verification.expiresAt, token: verification.token };
    },

    async requestPasswordReset(email) {
      const reset = createPasswordResetToken(passwordResetTokenTtlMinutes);
      const issued = await withAuthenticationTransaction(pool, (connection) =>
        issuePasswordReset(connection, email, reset),
      );
      return issued ? { expiresAt: reset.expiresAt, token: reset.token } : undefined;
    },
  };
}

export type AuthenticationRateLimitPolicies = Readonly<{
  login: Readonly<{ limit: number; windowMs: number }>;
  redemption: Readonly<{ limit: number; windowMs: number }>;
  reset: Readonly<{ limit: number; windowMs: number }>;
  totp: Readonly<{ limit: number; windowMs: number }>;
}>;

export type AuthenticationDependencies = Readonly<{
  rateLimitPolicies: AuthenticationRateLimitPolicies;
  rateLimitStore: RateLimitStore;
  service: AuthenticationService;
  sessions: SessionService;
  totp: TotpService;
}>;
