import { describe, expect, it } from 'vitest';

import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  deviceLabel,
  readSessionCookie,
  serializeSessionCookie,
} from './session.js';

const token = 'A'.repeat(43);

describe('session cookies', () => {
  it('serializes a host-only HTTP-only strict cookie', () => {
    const value = serializeSessionCookie(
      token,
      new Date('2026-09-22T00:00:00.000Z'),
      new Date('2026-08-23T00:00:00.000Z'),
      true,
    );

    expect(value).toContain(`${SESSION_COOKIE_NAME}=${token}`);
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Strict');
    expect(value).toContain('Secure');
    expect(value).not.toContain('Domain=');
  });

  it('rejects malformed and duplicate session cookies', () => {
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=${token}`)).toBe(token);
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=not-a-token`)).toBeUndefined();
    expect(
      readSessionCookie(`${SESSION_COOKIE_NAME}=${token}; ${SESSION_COOKIE_NAME}=${token}`),
    ).toBeUndefined();
  });

  it('clears a cookie using the same security attributes', () => {
    const value = clearSessionCookie(true);

    expect(value).toContain('Max-Age=0');
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Strict');
    expect(value).toContain('Secure');
  });
});

describe('device labels', () => {
  it('stores a bounded derived label rather than the raw user agent', () => {
    const label = deviceLabel(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0 secret-value',
    );

    expect(label).toBe('Chrome on Windows');
    expect(label).not.toContain('secret-value');
  });
});
