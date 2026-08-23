import { describe, expect, it } from 'vitest';

import { EmailValidationError, normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('normalizes valid addresses without preserving surrounding whitespace', () => {
    expect(normalizeEmail(' Owner@Example.Test ')).toBe('owner@example.test');
  });

  it('rejects malformed addresses', () => {
    expect(() => normalizeEmail('not-an-email')).toThrow(EmailValidationError);
  });
});
