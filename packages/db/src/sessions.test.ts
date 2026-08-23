import { describe, expect, it, vi } from 'vitest';

import {
  createSession,
  findActiveSession,
  listActiveSessions,
  revokeSessionsForUser,
} from './sessions.js';

const now = new Date('2026-08-23T12:00:00.000Z');
const idleExpiresAt = new Date('2026-08-23T20:00:00.000Z');
const absoluteExpiresAt = new Date('2026-09-22T12:00:00.000Z');
type SessionConnection = Parameters<typeof createSession>[0];

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as SessionConnection;
}

function activeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    absoluteExpiresAt,
    createdAt: now,
    deviceLabel: 'Chrome on Windows',
    email: 'owner@example.test',
    emailVerifiedAt: now,
    id: 'session-id',
    idleExpiresAt,
    lastUsedAt: now,
    role: 'owner',
    status: 'active',
    userId: 'owner-id',
    ...overrides,
  };
}

describe('session persistence', () => {
  it('stores only the supplied session token digest', async () => {
    const query = vi.fn().mockResolvedValue([[], []]);

    const id = await createSession(
      connection(query),
      {
        absoluteExpiresAt,
        deviceLabel: 'Chrome on Windows',
        idleExpiresAt,
        tokenHash: 'c'.repeat(64),
        userId: 'owner-id',
      },
      now,
    );

    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sessions'), [
      id,
      'owner-id',
      'c'.repeat(64),
      'Chrome on Windows',
      now,
      idleExpiresAt,
      absoluteExpiresAt,
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain('session plaintext');
  });

  it('does not authenticate expired sessions', async () => {
    const query = vi.fn().mockResolvedValue([[], []]);

    await expect(
      findActiveSession(connection(query), 'token-digest', now),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
  });

  it('revokes a session if its user is no longer active and verified', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[activeSessionRow({ emailVerifiedAt: null, status: 'invited' })], []])
      .mockResolvedValueOnce([[], []]);

    await expect(
      findActiveSession(connection(query), 'token-digest', now),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenLastCalledWith(
      'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      [now, 'session-id'],
    );
  });

  it('returns only active sessions for the account', async () => {
    const query = vi.fn().mockResolvedValue([[activeSessionRow()], []]);

    await expect(listActiveSessions(connection(query), 'owner-id', now)).resolves.toEqual([
      expect.objectContaining({ id: 'session-id', userId: 'owner-id' }),
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE sessions.user_id = ?'), [
      'owner-id',
      now,
      now,
    ]);
  });

  it('revokes every other active session for the user', async () => {
    const query = vi.fn().mockResolvedValue([[], []]);

    await revokeSessionsForUser(connection(query), 'owner-id', now, 'current-session-id');

    expect(query).toHaveBeenCalledWith(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      [now, 'owner-id', 'current-session-id'],
    );
  });
});
