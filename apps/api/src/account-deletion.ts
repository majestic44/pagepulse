import { createOpaqueToken, hashOpaqueToken } from '@pagepulse/auth';
import {
  purgeExpiredAccountDeletions,
  recoverAccountDeletion,
  scheduleAccountDeletion,
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
  recover: (token: string) => Promise<void>;
  request: (userId: string) => Promise<AccountDeletionRecovery>;
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

    async recover(token) {
      const current = now();
      await withAccountDeletionTransaction(pool, (connection) =>
        recoverAccountDeletion(connection, hashOpaqueToken(token), current),
      );
    },

    async request(userId) {
      const current = now();
      const token = createOpaqueToken();
      const deadline = deletionDeadline(current);
      await withAccountDeletionTransaction(pool, (connection) =>
        scheduleAccountDeletion(connection, userId, {
          deadline,
          recoveryTokenHash: hashOpaqueToken(token),
          requestedAt: current,
        }),
      );
      return { deadline, token };
    },
  };
}
