import { createOpaqueToken, hashOpaqueToken } from '@pagepulse/auth';
import {
  AuditActions,
  recordAuditEvent,
  purgeExpiredAccountDeletions,
  recoverAccountDeletion,
  scheduleAccountDeletion,
  type AuditContext,
  type AccountDeletionPool,
  withAccountDeletionTransaction,
} from '@pagepulse/db';

const deletionRecoveryDays = 7;

export type AccountDeletionRecovery = Readonly<{
  deadline: Date;
  token: string;
}>;

export type AccountDeletionService = Readonly<{
  purgeExpired: () => Promise<number>;
  recover: (token: string, audit?: AuditContext) => Promise<void>;
  request: (userId: string, audit?: AuditContext) => Promise<AccountDeletionRecovery>;
}>;

export type AccountDeletionServiceOptions = Readonly<{
  now?: () => Date;
  pool: AccountDeletionPool;
}>;

function deletionDeadline(now: Date) {
  return new Date(now.getTime() + deletionRecoveryDays * 24 * 60 * 60 * 1_000);
}

export function createAccountDeletionService({
  now = () => new Date(),
  pool,
}: AccountDeletionServiceOptions): AccountDeletionService {
  return {
    async purgeExpired() {
      const current = now();
      return withAccountDeletionTransaction(pool, (connection) =>
        purgeExpiredAccountDeletions(connection, current),
      );
    },

    async recover(token, audit) {
      const current = now();
      await withAccountDeletionTransaction(pool, async (connection) => {
        const userId = await recoverAccountDeletion(connection, hashOpaqueToken(token), current);
        await recordAuditEvent(connection, {
          ...audit,
          action: AuditActions.accountDeletionRecovered,
          createdAt: current,
          targetId: userId,
          targetType: 'account',
        });
      });
    },

    async request(userId, audit) {
      const current = now();
      const token = createOpaqueToken();
      const deadline = deletionDeadline(current);
      await withAccountDeletionTransaction(pool, async (connection) => {
        await scheduleAccountDeletion(connection, userId, {
          deadline,
          recoveryTokenHash: hashOpaqueToken(token),
          requestedAt: current,
        });
        await recordAuditEvent(connection, {
          ...audit,
          action: AuditActions.accountDeletionRequested,
          actorUserId: userId,
          createdAt: current,
          targetId: userId,
          targetType: 'account',
        });
      });
      return { deadline, token };
    },
  };
}
