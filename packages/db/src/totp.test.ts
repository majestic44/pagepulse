import { describe, expect, it, vi } from 'vitest';

import { AuthenticationTokenError } from './auth.js';
import {
  consumeTotpRecoveryCode,
  createTotpLoginChallenge,
  enableTotpMethod,
  findTotpLoginChallengeForUpdate,
  withTotpTransaction,
} from './totp.js';

const now = new Date('2026-08-23T12:00:00.000Z');
const future = new Date('2026-08-23T12:05:00.000Z');
type TotpConnection = Parameters<typeof createTotpLoginChallenge>[0];

function createConnection(query: ReturnType<typeof vi.fn>) {
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  const rollback = vi.fn().mockResolvedValue(undefined);
  return {
    beginTransaction,
    commit,
    connection: { beginTransaction, commit, query, release, rollback } as TotpConnection,
    release,
    rollback,
  };
}

describe('TOTP persistence', () => {
  it('stores only a supplied login-challenge digest and revokes prior challenges', async () => {
    const query = vi.fn().mockResolvedValue([[], []]);
    const { connection } = createConnection(query);

    await createTotpLoginChallenge(
      connection,
      { expiresAt: future, tokenHash: 'challenge-digest', userId: 'member-id' },
      now,
    );

    expect(query).toHaveBeenCalledWith(
      'INSERT INTO totp_login_challenges (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [expect.any(String), 'member-id', 'challenge-digest', future],
    );
    expect(JSON.stringify(query.mock.calls)).not.toContain('challenge plaintext');
  });

  it('rejects expired login challenges before a factor can be verified', async () => {
    const query = vi.fn().mockResolvedValue([
      [
        {
          challengeId: 'challenge-id',
          email: 'member@example.test',
          emailVerifiedAt: now,
          expiresAt: now,
          revokedAt: null,
          role: 'member',
          status: 'active',
          usedAt: null,
          userId: 'member-id',
        },
      ],
      [],
    ]);
    const { connection } = createConnection(query);

    await expect(
      findTotpLoginChallengeForUpdate(connection, 'challenge-digest', now),
    ).rejects.toBeInstanceOf(AuthenticationTokenError);
  });

  it('enables a factor with encrypted state, one-way recovery hashes, and revokes other sessions', async () => {
    const query = vi.fn().mockResolvedValue([[], []]);
    const { connection } = createConnection(query);

    await enableTotpMethod(
      connection,
      {
        encryptedSecret: 'v1.encrypted-secret',
        initialVerifiedTimeStep: 58_000_000,
        recoveryCodeHashes: ['recovery-digest-a', 'recovery-digest-b'],
        userId: 'member-id',
      },
      'current-session-id',
      now,
    );

    expect(query).toHaveBeenCalledWith(
      'INSERT INTO totp_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)',
      [expect.any(String), 'member-id', 'recovery-digest-a'],
    );
    expect(query).toHaveBeenCalledWith(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      [now, 'member-id', 'current-session-id'],
    );
  });

  it('makes a recovery-code digest single use', async () => {
    const query = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const { connection } = createConnection(query);

    await expect(
      consumeTotpRecoveryCode(connection, 'member-id', 'recovery-digest', now),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      'UPDATE totp_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
      [now, 'member-id', 'recovery-digest'],
    );
  });

  it('rolls back and releases a connection when a TOTP operation fails', async () => {
    const { beginTransaction, commit, connection, release, rollback } = createConnection(vi.fn());
    const pool = {
      getConnection: vi.fn().mockResolvedValue(connection),
    } as Parameters<typeof withTotpTransaction>[0];

    await expect(
      withTotpTransaction(pool, () => Promise.reject(new AuthenticationTokenError())),
    ).rejects.toBeInstanceOf(AuthenticationTokenError);

    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
