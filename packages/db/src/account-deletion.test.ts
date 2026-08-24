import { describe, expect, it, vi } from 'vitest';

import {
  AccountDeletionStateError,
  AccountDeletionTokenError,
  purgeExpiredAccountDeletions,
  recoverAccountDeletion,
  scheduleAccountDeletion,
} from './account-deletion.js';

const now = new Date('2026-08-24T12:00:00.000Z');
const deadline = new Date('2026-08-31T12:00:00.000Z');
type AccountDeletionConnection = Parameters<typeof scheduleAccountDeletion>[0];

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as AccountDeletionConnection;
}

function deletingTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    deletionDeadline: deadline,
    deletionRequestedAt: now,
    expiresAt: deadline,
    revokedAt: null,
    role: 'member',
    status: 'deleting',
    tokenId: 'recovery-token-id',
    usedAt: null,
    userId: 'member-id',
    ...overrides,
  };
}

describe('account deletion persistence', () => {
  it('schedules deletion only for an active member and revokes every session', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 'member-id', role: 'member', status: 'active' }], []])
      .mockResolvedValue([[], []]);

    await scheduleAccountDeletion(connection(query), 'member-id', {
      deadline,
      recoveryTokenHash: 'recovery-token-digest',
      requestedAt: now,
    });

    expect(query).toHaveBeenCalledWith(
      "UPDATE users SET status = 'deleting', deletion_requested_at = ?, deletion_deadline = ? WHERE id = ?",
      [now, deadline, 'member-id'],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      [now, 'member-id'],
    );
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("'account_deletion_recovery'"), [
      expect.any(String),
      'member-id',
      'recovery-token-digest',
      deadline,
    ]);
  });

  it('does not schedule owner, suspended, or already deleting accounts', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 'owner-id', role: 'owner', status: 'active' }], []])
      .mockResolvedValueOnce([[{ id: 'member-id', role: 'member', status: 'suspended' }], []])
      .mockResolvedValueOnce([[{ id: 'member-id', role: 'member', status: 'deleting' }], []]);
    const request = { deadline, recoveryTokenHash: 'digest', requestedAt: now };

    await expect(
      scheduleAccountDeletion(connection(query), 'owner-id', request),
    ).rejects.toBeInstanceOf(AccountDeletionStateError);
    await expect(
      scheduleAccountDeletion(connection(query), 'member-id', request),
    ).rejects.toBeInstanceOf(AccountDeletionStateError);
    await expect(
      scheduleAccountDeletion(connection(query), 'member-id', request),
    ).rejects.toBeInstanceOf(AccountDeletionStateError);
  });

  it('recovers an unexpired deleting member account exactly once', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[deletingTokenRow()], []])
      .mockResolvedValue([[], []]);

    await recoverAccountDeletion(connection(query), 'recovery-token-digest', now);

    expect(query).toHaveBeenNthCalledWith(2, 'UPDATE account_tokens SET used_at = ? WHERE id = ?', [
      now,
      'recovery-token-id',
    ]);
    expect(query).toHaveBeenLastCalledWith(
      "UPDATE users SET status = 'active', deletion_requested_at = NULL, deletion_deadline = NULL WHERE id = ?",
      ['member-id'],
    );
  });

  it('rejects expired, consumed, or non-member recovery tokens', async () => {
    const expired = vi.fn().mockResolvedValue([[deletingTokenRow({ expiresAt: now })], []]);
    const consumed = vi
      .fn()
      .mockResolvedValue([
        [deletingTokenRow({ usedAt: new Date('2026-08-24T11:00:00.000Z') })],
        [],
      ]);
    const owner = vi.fn().mockResolvedValue([[deletingTokenRow({ role: 'owner' })], []]);

    await expect(recoverAccountDeletion(connection(expired), 'digest', now)).rejects.toBeInstanceOf(
      AccountDeletionTokenError,
    );
    await expect(
      recoverAccountDeletion(connection(consumed), 'digest', now),
    ).rejects.toBeInstanceOf(AccountDeletionTokenError);
    await expect(recoverAccountDeletion(connection(owner), 'digest', now)).rejects.toBeInstanceOf(
      AccountDeletionTokenError,
    );
  });

  it('permanently removes only expired deleting member accounts after session revocation', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 'member-id' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(purgeExpiredAccountDeletions(connection(query), deadline)).resolves.toBe(1);

    expect(query).toHaveBeenNthCalledWith(
      2,
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      [deadline, 'member-id'],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      "DELETE FROM users WHERE id = ? AND role = 'member' AND status = 'deleting' AND deletion_deadline <= ?",
      ['member-id', deadline],
    );
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO audit_events'), [
      expect.any(String),
      null,
      'account.deletion.completed',
      'account',
      'member-id',
      null,
      null,
      new Date('2026-11-29T12:00:00.000Z'),
      deadline,
    ]);
  });
});
