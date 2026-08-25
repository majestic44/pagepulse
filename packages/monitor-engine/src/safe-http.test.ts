import { describe, expect, it, vi } from 'vitest';

import {
  SafeHttpError,
  isSafeHttpPublicIpAddress,
  safeHttpFetch,
  validatePublicHttpDestination,
} from './index.js';

describe('safe HTTP fetch policy', () => {
  it('rejects private, reserved, multicast, and future-reserved IPv4 addresses', () => {
    expect(isSafeHttpPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isSafeHttpPublicIpAddress('127.0.0.1')).toBe(false);
    expect(isSafeHttpPublicIpAddress('169.254.169.254')).toBe(false);
    expect(isSafeHttpPublicIpAddress('203.0.113.10')).toBe(false);
    expect(isSafeHttpPublicIpAddress('224.0.0.1')).toBe(false);
    expect(isSafeHttpPublicIpAddress('240.0.0.1')).toBe(false);
    expect(isSafeHttpPublicIpAddress('::ffff:7f00:1')).toBe(false);
  });

  it('rejects credentials, unsupported schemes, and mixed public/private DNS answers', async () => {
    const resolver = () =>
      Promise.resolve([
        { address: '8.8.8.8', family: 4 as const },
        { address: '127.0.0.1', family: 4 as const },
      ]);

    await expect(
      validatePublicHttpDestination(new URL('https://example.test'), resolver),
    ).rejects.toMatchObject({
      code: 'destination_not_allowed',
    });
    await expect(safeHttpFetch('ftp://example.test', { resolver })).rejects.toBeInstanceOf(
      SafeHttpError,
    );
    await expect(
      safeHttpFetch('https://user:password@example.test', { resolver }),
    ).rejects.toBeInstanceOf(SafeHttpError);
  });

  it('validates each redirect destination and provides bounded identity compression headers', async () => {
    const resolver = vi.fn((hostname: string) =>
      Promise.resolve(
        hostname === 'blocked.example.test'
          ? [{ address: '10.0.0.5', family: 4 as const }]
          : [{ address: '8.8.8.8', family: 4 as const }],
      ),
    );
    const request = vi.fn().mockResolvedValue({
      body: Buffer.alloc(0),
      headers: { location: 'https://blocked.example.test/internal' },
      statusCode: 302,
    });

    await expect(
      safeHttpFetch('https://example.test/', {
        maxBytes: 1024,
        request,
        resolver,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'destination_not_allowed' });

    expect(resolver).toHaveBeenCalledWith('example.test');
    expect(resolver).toHaveBeenCalledWith('blocked.example.test');
    expect(request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        accept: '*/*',
        maxBytes: 1024,
        timeoutMs: 1000,
        userAgent: 'PagePulse/1.0 (+https://pagepulse.local)',
      }),
    );
  });

  it('returns the terminal URL and rejects an unbounded redirect chain', async () => {
    const resolver = () => Promise.resolve([{ address: '8.8.8.8', family: 4 as const }]);
    const terminal = await safeHttpFetch('https://example.test/start', {
      maxRedirects: 1,
      request: vi
        .fn()
        .mockResolvedValueOnce({
          body: Buffer.alloc(0),
          headers: { location: '/next' },
          statusCode: 302,
        })
        .mockResolvedValueOnce({ body: Buffer.from('ok'), headers: {}, statusCode: 200 }),
      resolver,
    });
    expect(terminal.url.toString()).toBe('https://example.test/next');

    await expect(
      safeHttpFetch('https://example.test/', {
        maxRedirects: 0,
        request: vi.fn().mockResolvedValue({
          body: Buffer.alloc(0),
          headers: { location: '/next' },
          statusCode: 302,
        }),
        resolver,
      }),
    ).rejects.toMatchObject({ code: 'too_many_redirects' });
  });
});
