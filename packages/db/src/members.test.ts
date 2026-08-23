import { describe, expect, it, vi } from 'vitest';

import {
  listManagedMembers,
  MemberLifecycleStateError,
  MemberNotFoundError,
  reactivateMember,
  removeMember,
  suspendMember,
} from './members.js';

const now = new Date('2026-08-23T12:00:00.000Z');
type MemberConnection = Parameters<typeof suspendMember>[0];

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as MemberConnection;
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: now,
    email: 'member@example.test',
    emailVerifiedAt: now,
    id: 'member-id',
    monitorLimit: 50,
    status: 'active',
    ...overrides,
  };
}

describe('member lifecycle persistence', () => {
  it('lists only member records with safe administration details', async () => {
    const query = vi.fn().mockResolvedValue([[memberRow()], []]);

    await expect(listManagedMembers(connection(query))).resolves.toEqual([
      {
        createdAt: now,
        email: 'member@example.test',
        emailVerified: true,
        id: 'member-id',
        monitorLimit: 50,
        status: 'active',
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE role = 'member'"));
  });

  it('suspends only an active member and revokes every session', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[memberRow({ id: 'member-id', status: 'active' })], []])
      .mockResolvedValue([[], []]);

    await suspendMember(connection(query), 'member-id', now);

    expect(query).toHaveBeenCalledWith("UPDATE users SET status = 'suspended' WHERE id = ?", [
      'member-id',
    ]);
    expect(query).toHaveBeenCalledWith(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      [now, 'member-id'],
    );
  });

  it('reactivates only suspended members', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[memberRow({ id: 'member-id', status: 'suspended' })], []])
      .mockResolvedValueOnce([[], []]);

    await reactivateMember(connection(query), 'member-id');

    expect(query).toHaveBeenLastCalledWith("UPDATE users SET status = 'active' WHERE id = ?", [
      'member-id',
    ]);
  });

  it('rejects invalid lifecycle transitions and owner targets', async () => {
    const activeQuery = vi.fn().mockResolvedValue([[memberRow({ status: 'active' })], []]);
    const ownerQuery = vi.fn().mockResolvedValue([[], []]);

    await expect(reactivateMember(connection(activeQuery), 'member-id')).rejects.toBeInstanceOf(
      MemberLifecycleStateError,
    );
    await expect(suspendMember(connection(ownerQuery), 'owner-id', now)).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
  });

  it('revokes sessions before permanently removing a member', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[memberRow({ id: 'member-id', status: 'suspended' })], []])
      .mockResolvedValue([[], []]);

    await removeMember(connection(query), 'member-id', now);

    expect(query).toHaveBeenNthCalledWith(
      2,
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      [now, 'member-id'],
    );
    expect(query).toHaveBeenLastCalledWith("DELETE FROM users WHERE id = ? AND role = 'member'", [
      'member-id',
    ]);
  });
});
