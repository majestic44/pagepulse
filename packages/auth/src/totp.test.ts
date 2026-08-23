import { describe, expect, it } from 'vitest';

import {
  createRecoveryCodes,
  createTotpCode,
  createTotpProvisioningUri,
  decryptTotpSecret,
  encryptTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotpCode,
} from './totp.js';

const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const now = new Date('1970-01-01T00:00:59.000Z');

describe('TOTP primitives', () => {
  it('implements the RFC 6238 SHA-1 test vector with a 30-second period', () => {
    expect(createTotpCode(secret, 1)).toBe('287082');
    expect(verifyTotpCode(secret, '287082', now)).toBe(1);
  });

  it('allows only one previous time step and rejects reuse outside that window', () => {
    expect(verifyTotpCode(secret, createTotpCode(secret, 0), now)).toBe(0);
    expect(verifyTotpCode(secret, createTotpCode(secret, 2), now)).toBeUndefined();
    expect(verifyTotpCode(secret, 'not-a-code', now)).toBeUndefined();
  });

  it('binds AES-GCM ciphertext to the owning user', () => {
    const ciphertext = encryptTotpSecret(secret, 'test TOTP encryption key', 'user-a');
    expect(decryptTotpSecret(ciphertext, 'test TOTP encryption key', 'user-a')).toBe(secret);
    expect(() => decryptTotpSecret(ciphertext, 'test TOTP encryption key', 'user-b')).toThrow(
      'could not decrypt',
    );
  });

  it('creates interoperable provisioning URLs and one-way recovery-code hashes', () => {
    const uri = createTotpProvisioningUri('PagePulse', 'owner@example.test', secret);
    expect(uri).toContain('otpauth://totp/PagePulse%3Aowner%40example.test?');
    expect(uri).toContain('issuer=PagePulse');

    const [recoveryCode] = createRecoveryCodes(1);
    expect(recoveryCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u);
    expect(normalizeRecoveryCode(recoveryCode!)).toHaveLength(12);
    expect(hashRecoveryCode(recoveryCode!, 'test TOTP encryption key', 'user-a')).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });
});
