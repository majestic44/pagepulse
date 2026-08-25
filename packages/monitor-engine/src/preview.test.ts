import { describe, expect, it, vi } from 'vitest';

import {
  extractHtmlTarget,
  isPublicIpAddress,
  MonitorPreviewError,
  MonitorTargetValidationError,
  normalizeMonitorTargetConfiguration,
  previewHtmlTarget,
  validatePreviewDestination,
} from './index.js';

describe('monitor target configuration', () => {
  it('normalizes valid whole-page and CSS selector targets', () => {
    expect(normalizeMonitorTargetConfiguration({ targetType: 'whole_page' })).toEqual({
      selector: null,
      targetType: 'whole_page',
    });
    expect(
      normalizeMonitorTargetConfiguration({
        selector: ' main > article ',
        targetType: 'css_selector',
      }),
    ).toEqual({
      selector: 'main > article',
      targetType: 'css_selector',
    });
  });

  it('rejects selector omissions, malformed CSS, and selector values for whole-page targets', () => {
    expect(() => normalizeMonitorTargetConfiguration({ targetType: 'css_selector' })).toThrow(
      MonitorTargetValidationError,
    );
    expect(() =>
      normalizeMonitorTargetConfiguration({ selector: 'main[', targetType: 'css_selector' }),
    ).toThrow(MonitorTargetValidationError);
    expect(() =>
      normalizeMonitorTargetConfiguration({ selector: 'main', targetType: 'whole_page' }),
    ).toThrow(MonitorTargetValidationError);
  });
});

describe('HTML target extraction', () => {
  const html = `
    <html><body>
      <script>privateScriptValue()</script>
      <main><article class="job">First role</article><article class="job">Second role</article></main>
    </body></html>
  `;

  it('extracts normalized whole-page and selector text without executable regions', () => {
    expect(extractHtmlTarget(html, { targetType: 'whole_page' })).toEqual({
      matchCount: 1,
      text: 'First role Second role',
      truncated: false,
    });
    expect(
      extractHtmlTarget(html, { selector: 'article.job', targetType: 'css_selector' }),
    ).toEqual({
      matchCount: 2,
      text: 'First role Second role',
      truncated: false,
    });
  });

  it('reports a selector that does not match instead of returning an empty preview', () => {
    expect(() =>
      extractHtmlTarget(html, { selector: '#missing', targetType: 'css_selector' }),
    ).toThrow(MonitorPreviewError);
    try {
      extractHtmlTarget(html, { selector: '#missing', targetType: 'css_selector' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'selector_no_match' });
    }
  });
});

describe('public destination policy', () => {
  it('allows public addresses while rejecting loopback, private, reserved, multicast, and mapped loopback addresses', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('2001:4860:4860::8888')).toBe(true);
    expect(isPublicIpAddress('127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('10.0.0.1')).toBe(false);
    expect(isPublicIpAddress('203.0.113.1')).toBe(false);
    expect(isPublicIpAddress('224.0.0.1')).toBe(false);
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('::ffff:7f00:1')).toBe(false);
    expect(isPublicIpAddress('fc00::1')).toBe(false);
  });

  it('rejects a hostname when any resolved address is unsafe', async () => {
    await expect(
      validatePreviewDestination(new URL('https://example.test'), () =>
        Promise.resolve([
          { address: '8.8.8.8', family: 4 as const },
          { address: '127.0.0.1', family: 4 as const },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'destination_not_allowed' });
  });

  it('validates every redirect destination before it can be requested', async () => {
    const resolver = vi.fn((hostname: string) =>
      Promise.resolve(
        hostname === 'redirected.example.test'
          ? [{ address: '169.254.169.254', family: 4 as const }]
          : [{ address: '8.8.8.8', family: 4 as const }],
      ),
    );
    const request = vi.fn().mockResolvedValue({
      body: Buffer.alloc(0),
      headers: { location: 'http://redirected.example.test/metadata' },
      statusCode: 302,
    });

    await expect(
      previewHtmlTarget(
        { target: { targetType: 'whole_page' }, url: 'https://example.test/' },
        { request, resolver },
      ),
    ).rejects.toBeInstanceOf(MonitorPreviewError);
    expect(request).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith('example.test');
    expect(resolver).toHaveBeenCalledWith('redirected.example.test');
  });
});
