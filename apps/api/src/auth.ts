import {
  type Argon2idParameters,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  type RateLimitStore,
  verifyPassword,
} from '@pagepulse/auth';
import {
  AuditActions,
  type AuthPool,
  type AuditContext,
  type AuthenticationUser,
  AccountTokenTypes,
  findAuthenticationUser,
  findAuthenticationUserById,
  issueEmailVerification,
  issuePasswordReset,
  redeemInvitation,
  redeemOwnerSetup,
  resetPassword,
  recordAuditEvent,
  hasTotpMethod,
  verifyEmailAddress,
  withAuthenticationTransaction,
} from '@pagepulse/db';

import type { SessionService } from './session.js';
import type { AccountDeletionService } from './account-deletion.js';
import type { AuditService } from './audit.js';
import type { MemberService } from './members.js';
import type { TotpService } from './totp.js';
import type { VerificationEmailDelivery } from './email-delivery.js';

export type AuthenticationTokenIssue = Readonly<{
  expiresAt: Date;
  token: string;
}>;

export type AuthenticationEmailVerificationIssue = AuthenticationTokenIssue &
  Readonly<{
    email: string;
  }>;

export type AuthenticationLogin = Readonly<{
  totpEnabled: boolean;
  user: AuthenticationUser;
}>;

export type AuthenticationService = Readonly<{
  completePasswordReset: (token: string, password: string, audit?: AuditContext) => Promise<void>;
  confirmEmailVerification: (token: string, audit?: AuditContext) => Promise<void>;
  login: (email: string, password: string) => Promise<AuthenticationLogin | undefined>;
  redeemInvitation: (
    token: string,
    password: string,
    audit?: AuditContext,
  ) => Promise<AuthenticationEmailVerificationIssue>;
  redeemOwnerSetup: (
    token: string,
    password: string,
    audit?: AuditContext,
  ) => Promise<AuthenticationEmailVerificationIssue>;
  requestEmailVerification: (
    email: string,
    audit?: AuditContext,
  ) => Promise<AuthenticationEmailVerificationIssue | undefined>;
  requestPasswordReset: (email: string) => Promise<AuthenticationTokenIssue | undefined>;
  verifyCurrentPassword: (userId: string, password: string) => Promise<boolean>;
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
    async completePasswordReset(token, password, audit) {
      const passwordHash = await hashPassword(password, passwordHashing);
      await withAuthenticationTransaction(pool, async (connection) => {
        const userId = await resetPassword(connection, {
          passwordHash,
          resetTokenHash: hashOpaqueToken(token),
        });
        await recordAuditEvent(connection, {
          ...audit,
          action: AuditActions.passwordResetCompleted,
          actorUserId: userId,
          targetId: userId,
          targetType: 'account',
        });
      });
    },

    async confirmEmailVerification(token, audit) {
      await withAuthenticationTransaction(pool, async (connection) => {
        const userId = await verifyEmailAddress(connection, hashOpaqueToken(token));
        await recordAuditEvent(connection, {
          ...audit,
          action: AuditActions.emailVerified,
          actorUserId: userId,
          targetId: userId,
          targetType: 'account',
        });
      });
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

    async redeemInvitation(token, password, audit) {
      const passwordHash = await hashPassword(password, passwordHashing);
      const verification = createVerificationToken(emailVerificationTokenTtlMinutes);
      const redeemed = await withAuthenticationTransaction(pool, async (connection) => {
        const result = await redeemInvitation(connection, {
          invitationTokenHash: hashOpaqueToken(token),
          passwordHash,
          verificationToken: verification,
        });
        await recordAuditEvent(connection, {
          ...audit,
          action: AuditActions.invitationRedeemed,
          actorUserId: result.userId,
          targetId: result.userId,
          targetType: 'account',
        });
        return result;
      });
      return {
        email: redeemed.email,
        expiresAt: verification.expiresAt,
        token: verification.token,
      };
    },

    async redeemOwnerSetup(token, password, audit) {
      const passwordHash = await hashPassword(password, passwordHashing);
      const verification = createVerificationToken(emailVerificationTokenTtlMinutes);
      const redeemed = await withAuthenticationTransaction(pool, async (connection) => {
        const result = await redeemOwnerSetup(connection, {
          passwordHash,
          setupTokenHash: hashOpaqueToken(token),
          verificationToken: verification,
        });
        await recordAuditEvent(connection, {
          ...audit,
          action: AuditActions.ownerSetupCompleted,
          actorUserId: result.userId,
          targetId: result.userId,
          targetType: 'account',
        });
        return result;
      });
      return {
        email: redeemed.email,
        expiresAt: verification.expiresAt,
        token: verification.token,
      };
    },

    async requestEmailVerification(email, audit) {
      const normalizedEmail = normalizeEmail(email);
      const verification = createVerificationToken(emailVerificationTokenTtlMinutes);
      const userId = await withAuthenticationTransaction(pool, async (connection) => {
        const issued = await issueEmailVerification(connection, normalizedEmail, {
          token: verification,
        });
        if (issued) {
          await recordAuditEvent(connection, {
            ...audit,
            action: AuditActions.emailVerificationResent,
            actorUserId: issued,
            targetId: issued,
            targetType: 'account',
          });
        }
        return issued;
      });
      return userId
        ? { email: normalizedEmail, expiresAt: verification.expiresAt, token: verification.token }
        : undefined;
    },

    async requestPasswordReset(email) {
      const reset = createPasswordResetToken(passwordResetTokenTtlMinutes);
      const issued = await withAuthenticationTransaction(pool, (connection) =>
        issuePasswordReset(connection, email, reset),
      );
      return issued ? { expiresAt: reset.expiresAt, token: reset.token } : undefined;
    },

    async verifyCurrentPassword(userId, password) {
      const user = await withAuthenticationTransaction(pool, (connection) =>
        findAuthenticationUserById(connection, userId),
      );
      if (!user || user.status !== 'active' || !user.emailVerified || user.passwordHash === null) {
        return false;
      }
      return verifyPassword(password, user.passwordHash);
    },
  };
}

export type AuthenticationRateLimitPolicies = Readonly<{
  deletion: Readonly<{ limit: number; windowMs: number }>;
  login: Readonly<{ limit: number; windowMs: number }>;
  redemption: Readonly<{ limit: number; windowMs: number }>;
  reset: Readonly<{ limit: number; windowMs: number }>;
  totp: Readonly<{ limit: number; windowMs: number }>;
}>;

export type AuthenticationDependencies = Readonly<{
  accountDeletion: AccountDeletionService;
  audit: AuditService;
  emailDelivery: VerificationEmailDelivery;
  members: MemberService;
  rateLimitPolicies: AuthenticationRateLimitPolicies;
  rateLimitStore: RateLimitStore;
  service: AuthenticationService;
  sessions: SessionService;
  totp: TotpService;
}>;
