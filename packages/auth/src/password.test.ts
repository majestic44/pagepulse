import { describe, expect, it } from 'vitest';

import {
  PasswordValidationError,
  hashPassword,
  passwordHashNeedsRehash,
  verifyPassword,
} from './password.js';

const testParameters = { memoryKiB: 8, parallelism: 1, passes: 1 };

describe('password hashing', () => {
  it('creates distinct Argon2id hashes that verify the original password', async () => {
    const password = 'correct horse battery staple';
    const firstHash = await hashPassword(password, testParameters);
    const secondHash = await hashPassword(password, testParameters);

    expect(firstHash).toMatch(/^argon2id\$v=19\$m=8,t=1,p=1\$/u);
    expect(firstHash).not.toBe(secondHash);
    await expect(verifyPassword(password, firstHash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', firstHash)).resolves.toBe(false);
  });

  it('rejects invalid passwords and treats malformed hashes as non-matches', async () => {
    await expect(hashPassword('short', testParameters)).rejects.toBeInstanceOf(
      PasswordValidationError,
    );
    await expect(
      verifyPassword('correct horse battery staple', 'not-a-password-hash'),
    ).resolves.toBe(false);
  });

  it('identifies hashes that need stronger parameters', async () => {
    const passwordHash = await hashPassword('correct horse battery staple', testParameters);

    expect(passwordHashNeedsRehash(passwordHash, testParameters)).toBe(false);
    expect(
      passwordHashNeedsRehash(passwordHash, { memoryKiB: 16, parallelism: 1, passes: 1 }),
    ).toBe(true);
  });
});
