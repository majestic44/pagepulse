import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@pagepulse/auth';

import { createAuthenticationService } from './auth.js';

const passwordHashing = { memoryKiB: 8, parallelism: 1, passes: 1 };

function createPool(totpEnabled: boolean, passwordHash: string) {
  const query = vi.fn((sql: string) => {
    if (sql.includes('FROM users')) {
      return Promise.resolve([
        [
          {
            email: 'owner@example.test',
            emailVerifiedAt: new Date('2026-08-23T00:00:00.000Z'),
            id: 'owner-id',
            passwordHash,
            role: 'owner',
            status: 'active',
          },
        ],
        [],
      ]);
    }
    if (sql.includes('FROM totp_methods')) {
      return Promise.resolve([totpEnabled ? [{ present: 1 }] : [], []]);
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    query,
    release: vi.fn(),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
  return { getConnection: vi.fn().mockResolvedValue(connection) };
}

describe('authentication service login', () => {
  it('indicates whether a verified account must complete TOTP before a session can be issued', async () => {
    const password = 'a secure password';
    const passwordHash = await hashPassword(password, passwordHashing);
    const service = await createAuthenticationService({
      emailVerificationTokenTtlMinutes: 60,
      passwordHashing,
      passwordResetTokenTtlMinutes: 60,
      pool: createPool(true, passwordHash),
    });

    await expect(service.login('owner@example.test', password)).resolves.toMatchObject({
      totpEnabled: true,
      user: { id: 'owner-id' },
    });
  });
});
