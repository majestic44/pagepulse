import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticationStateError,
  AuthenticationTokenError,
  findAuthenticationUser,
  redeemInvitation,
  resetPassword,
  withAuthenticationTransaction,
} from './auth.js';

const now = new Date('2026-08-23T12:00:00.000Z');
const future = new Date('2026-08-23T13:00:00.000Z');
type AuthenticationConnection = Parameters<typeof redeemInvitation>[0];

function createConnection(query: ReturnType<typeof vi.fn>) {
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  const rollback = vi.fn().mockResolvedValue(undefined);
  return {
    beginTransaction,
    commit,
    connection: { beginTransaction, commit, query, release, rollback } as AuthenticationConnection,
    release,
    rollback,
  };
}

describe('authentication persistence', () => {
  it('redeems an invitation once and stores only supplied digests', async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes('FROM invitations')) {
        return Promise.resolve([
          [
            {
              email: ' Member@Example.Test ',
              expiresAt: future,
              invitationId: 'invitation-id',
              revokedAt: null,
              usedAt: null,
            },
          ],
          [],
        ]);
      }
      if (sql.startsWith('SELECT id FROM users')) {
        return Promise.resolve([[], []]);
      }
      return Promise.resolve([[], []]);
    });
    const { connection } = createConnection(query);

    const result = await redeemInvitation(
      connection,
      {
        invitationTokenHash: 'invitation-token-digest',
        passwordHash: 'argon2id$password-digest',
        verificationToken: {
          expiresAt: future,
          tokenHash: 'verification-token-digest',
          type: 'email_verification',
        },
      },
      now,
    );
    expect(typeof result.userId).toBe('string');

    expect(query).toHaveBeenCalledWith(
      "INSERT INTO users (id, email, password_hash, password_changed_at, role, status) VALUES (?, ?, ?, ?, 'member', 'invited')",
      [expect.any(String), 'member@example.test', 'argon2id$password-digest', now],
    );
    expect(query).toHaveBeenCalledWith(
      'INSERT INTO account_tokens (id, user_id, type, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
      [
        expect.any(String),
        expect.any(String),
        'email_verification',
        'verification-token-digest',
        future,
      ],
    );
    expect(JSON.stringify(query.mock.calls)).not.toContain('invitation plaintext');
  });

  it('rejects expired invitation tokens without creating an account', async () => {
    const query = vi.fn(() =>
      Promise.resolve([
        [
          {
            email: 'member@example.test',
            expiresAt: now,
            invitationId: 'invitation-id',
            revokedAt: null,
            usedAt: null,
          },
        ],
        [],
      ]),
    );
    const { connection } = createConnection(query);

    await expect(
      redeemInvitation(
        connection,
        {
          invitationTokenHash: 'digest',
          passwordHash: 'password-digest',
          verificationToken: {
            expiresAt: future,
            tokenHash: 'verification-digest',
            type: 'email_verification',
          },
        },
        now,
      ),
    ).rejects.toBeInstanceOf(AuthenticationTokenError);
    expect(query).toHaveBeenCalledOnce();
  });

  it('does not reset an unverified account password', async () => {
    const query = vi.fn(() =>
      Promise.resolve([
        [
          {
            emailVerifiedAt: null,
            expiresAt: future,
            revokedAt: null,
            status: 'active',
            tokenId: 'reset-token-id',
            usedAt: null,
            userId: 'member-id',
          },
        ],
        [],
      ]),
    );
    const { connection } = createConnection(query);

    await expect(
      resetPassword(
        connection,
        { passwordHash: 'new-digest', resetTokenHash: 'reset-digest' },
        now,
      ),
    ).rejects.toBeInstanceOf(AuthenticationStateError);
    expect(query).toHaveBeenCalledOnce();
  });

  it('validates user roles returned from the database', async () => {
    const query = vi.fn().mockResolvedValue([
      [
        {
          email: 'member@example.test',
          emailVerifiedAt: now,
          id: 'member-id',
          passwordHash: 'password-digest',
          role: 'operator',
          status: 'active',
        },
      ],
      [],
    ]);
    const { connection } = createConnection(query);

    await expect(findAuthenticationUser(connection, 'member@example.test')).rejects.toThrow(
      'user role or status is invalid',
    );
  });

  it('rolls back and releases a connection when an authentication operation fails', async () => {
    const { beginTransaction, commit, connection, release, rollback } = createConnection(vi.fn());
    const pool = {
      getConnection: vi.fn().mockResolvedValue(connection),
    } as Parameters<typeof withAuthenticationTransaction>[0];

    await expect(
      withAuthenticationTransaction(pool, () => Promise.reject(new AuthenticationTokenError())),
    ).rejects.toBeInstanceOf(AuthenticationTokenError);

    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
