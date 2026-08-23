import type { Connection } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import {
  OWNER_BOOTSTRAP_LOCK_NAME,
  OWNER_BOOTSTRAP_LOCK_TIMEOUT_SECONDS,
  OwnerBootstrapAlreadyConfiguredError,
  OwnerBootstrapInputError,
  OwnerBootstrapPendingOwnerMismatchError,
  createOwnerBootstrap,
  createOwnerSetupToken,
  createOwnerSetupUrl,
  hashOwnerSetupToken,
  normalizeOwnerEmail,
  withOwnerBootstrapLock,
} from './owner-bootstrap.js';

function createConnection(
  existingOwner: { email: string; id: string; status: string } | undefined = undefined,
) {
  const query = vi.fn((sql: string, _parameters?: unknown[]) => {
    void _parameters;
    if (sql.startsWith('SELECT GET_LOCK')) {
      return Promise.resolve([[{ acquired: 1 }], []]);
    }
    if (sql.startsWith("SELECT id, email, status FROM users WHERE role = 'owner'")) {
      return Promise.resolve([existingOwner ? [existingOwner] : [], []]);
    }
    return Promise.resolve([[], []]);
  });
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const end = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const connection = {
    beginTransaction,
    commit,
    end,
    query,
    rollback,
  } as unknown as Connection;
  return { beginTransaction, commit, connection, end, query, rollback };
}

describe('owner bootstrap', () => {
  it('creates a pending owner and stores only the token hash', async () => {
    const { beginTransaction, commit, connection, query, rollback } = createConnection();
    const now = new Date('2026-08-23T12:00:00.000Z');

    const result = await withOwnerBootstrapLock(connection, () =>
      createOwnerBootstrap(connection, {
        email: ' Owner@Example.Test ',
        now,
        tokenTtlMinutes: 30,
      }),
    );

    expect(result.expiresAt).toEqual(new Date('2026-08-23T12:30:00.000Z'));
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT GET_LOCK(?, ?) AS acquired', [
      OWNER_BOOTSTRAP_LOCK_NAME,
      OWNER_BOOTSTRAP_LOCK_TIMEOUT_SECONDS,
    ]);
    expect(query).toHaveBeenCalledWith(
      "INSERT INTO users (id, email, role, status) VALUES (?, ?, 'owner', 'invited')",
      [result.ownerId, 'owner@example.test'],
    );

    const tokenInsert = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT INTO owner_setup_tokens'),
    );
    expect(tokenInsert).toBeDefined();
    if (!tokenInsert) {
      throw new Error('Expected the owner setup token to be inserted');
    }
    const tokenParameters = tokenInsert[1] ?? [];
    expect(tokenParameters).toContain(hashOwnerSetupToken(result.token));
    expect(tokenParameters).not.toContain(result.token);
    expect(query).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?) AS released', [
      OWNER_BOOTSTRAP_LOCK_NAME,
    ]);
  });

  it('rolls back when an active owner has already been configured', async () => {
    const { commit, connection, query, rollback } = createConnection({
      email: 'owner@example.test',
      id: 'existing-owner',
      status: 'active',
    });

    await expect(
      withOwnerBootstrapLock(connection, () =>
        createOwnerBootstrap(connection, { email: 'owner@example.test', tokenTtlMinutes: 30 }),
      ),
    ).rejects.toBeInstanceOf(OwnerBootstrapAlreadyConfiguredError);

    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
    expect(query).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?) AS released', [
      OWNER_BOOTSTRAP_LOCK_NAME,
    ]);
  });

  it('rotates an unredeemed setup token for the same pending owner', async () => {
    const { connection, query } = createConnection({
      email: 'owner@example.test',
      id: 'pending-owner',
      status: 'invited',
    });
    const now = new Date('2026-08-23T12:00:00.000Z');

    const result = await withOwnerBootstrapLock(connection, () =>
      createOwnerBootstrap(connection, { email: 'owner@example.test', now, tokenTtlMinutes: 30 }),
    );

    expect(result.ownerId).toBe('pending-owner');
    expect(query).toHaveBeenCalledWith(
      'UPDATE owner_setup_tokens SET revoked_at = ? WHERE owner_id = ? AND used_at IS NULL AND revoked_at IS NULL',
      [now, 'pending-owner'],
    );
    expect(query).not.toHaveBeenCalledWith(
      "INSERT INTO users (id, email, role, status) VALUES (?, ?, 'owner', 'invited')",
      expect.anything(),
    );
  });

  it('rejects rotating a pending owner with a different email', async () => {
    const { connection, rollback } = createConnection({
      email: 'owner@example.test',
      id: 'pending-owner',
      status: 'invited',
    });

    await expect(
      withOwnerBootstrapLock(connection, () =>
        createOwnerBootstrap(connection, { email: 'other@example.test', tokenTtlMinutes: 30 }),
      ),
    ).rejects.toBeInstanceOf(OwnerBootstrapPendingOwnerMismatchError);

    expect(rollback).toHaveBeenCalledOnce();
  });

  it('rejects malformed owner email addresses and unsafe token lifetimes', async () => {
    expect(() => normalizeOwnerEmail('owner')).toThrow(OwnerBootstrapInputError);
    expect(normalizeOwnerEmail(' OWNER@EXAMPLE.TEST ')).toBe('owner@example.test');

    const { beginTransaction, connection } = createConnection();
    await expect(
      createOwnerBootstrap(connection, { email: 'owner@example.test', tokenTtlMinutes: 4 }),
    ).rejects.toThrow(OwnerBootstrapInputError);
    expect(beginTransaction).not.toHaveBeenCalled();
  });

  it('generates high-entropy tokens and canonical setup URLs', () => {
    const token = createOwnerSetupToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(hashOwnerSetupToken('known-token')).toBe(
      '49e2e40e591e61357758299c8cee170fb9fa7da160ec8acf110a4a409d905aaf',
    );
    expect(createOwnerSetupUrl('https://pagepulse.example.test/pagepulse/', 'known-token')).toBe(
      'https://pagepulse.example.test/pagepulse/setup/owner?token=known-token',
    );
  });
});
