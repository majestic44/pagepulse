import { describe, expect, it } from 'vitest';

import { createEmailVerificationUrl } from './email-delivery.js';

describe('createEmailVerificationUrl', () => {
  it('preserves an application base path and replaces all existing URL state', () => {
    expect(
      createEmailVerificationUrl(
        'https://pagepulse.example.test/app/?unexpected=value#fragment',
        'A'.repeat(43),
      ),
    ).toBe(`https://pagepulse.example.test/app/verify-email?token=${'A'.repeat(43)}`);
  });
});
