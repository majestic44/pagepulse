import { describe, expect, it, vi } from 'vitest';

import {
  fetchMonitorSource,
  parseHtmlSource,
  parseJsonSource,
  parseRssAtomSource,
  SourceAdapterError,
} from './index.js';

const publicResolver = () => Promise.resolve([{ address: '8.8.8.8', family: 4 as const }]);

describe('monitor source adapters', () => {
  it('parses HTML into an in-memory document without executing page content', () => {
    const source = parseHtmlSource(
      '<html><body><script>throw new Error("must not execute")</script><main>Current status</main></body></html>',
    );

    expect(source.sourceType).toBe('html');
    expect(source.document('main').text()).toBe('Current status');
  });

  it('parses JSON and rejects invalid or excessively nested documents', () => {
    expect(parseJsonSource('{"items":[{"id":"one"}]}')).toEqual({
      sourceType: 'json',
      value: { items: [{ id: 'one' }] },
    });
    expect(() => parseJsonSource('{')).toThrow(SourceAdapterError);

    let nested = 'null';
    for (let index = 0; index < 65; index += 1) {
      nested = `[${nested}]`;
    }
    expect(() => parseJsonSource(nested)).toThrow(
      expect.objectContaining({ code: 'source_too_complex' }),
    );
  });

  it('parses bounded RSS and Atom entries into a common representation', () => {
    expect(
      parseRssAtomSource(`<?xml version="1.0"?><rss><channel><item>
        <guid>rss-id</guid><title>Release</title><link>https://example.test/release</link>
        <pubDate>2026-08-25</pubDate><description>Available now</description>
      </item></channel></rss>`),
    ).toEqual({
      items: [
        {
          content: 'Available now',
          id: 'rss-id',
          link: 'https://example.test/release',
          publishedAt: '2026-08-25',
          title: 'Release',
        },
      ],
      sourceType: 'rss_atom',
    });
    expect(
      parseRssAtomSource(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <id>atom-id</id><title>Atom release</title><link href="https://example.test/atom" rel="alternate" />
        <updated>2026-08-25T00:00:00Z</updated><summary>Atom content</summary>
      </entry></feed>`),
    ).toEqual({
      items: [
        {
          content: 'Atom content',
          id: 'atom-id',
          link: 'https://example.test/atom',
          publishedAt: '2026-08-25T00:00:00Z',
          title: 'Atom release',
        },
      ],
      sourceType: 'rss_atom',
    });
  });

  it('uses the shared safe transport with source-specific accept and content-type rules', async () => {
    const request = vi.fn().mockResolvedValue({
      body: Buffer.from('{"state":"ok"}'),
      headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
      statusCode: 200,
    });

    await expect(
      fetchMonitorSource('https://example.test/status', {
        request,
        resolver: publicResolver,
        sourceType: 'json',
      }),
    ).resolves.toEqual({ sourceType: 'json', value: { state: 'ok' } });

    expect(request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        accept: 'application/json,application/*+json;q=0.9,text/json;q=0.8',
      }),
    );

    await expect(
      fetchMonitorSource('https://example.test/status', {
        request: vi.fn().mockResolvedValue({
          body: Buffer.from('<html>not json</html>'),
          headers: { 'content-type': 'text/html' },
          statusCode: 200,
        }),
        resolver: publicResolver,
        sourceType: 'json',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_response' });
  });

  it('does not disclose target details when safe transport rejects a destination', async () => {
    await expect(
      fetchMonitorSource('https://private.example.test/internal', {
        resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 as const }]),
        sourceType: 'html',
      }),
    ).rejects.toMatchObject({ code: 'fetch_failed' });

    try {
      await fetchMonitorSource('https://private.example.test/internal', {
        resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 as const }]),
        sourceType: 'html',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SourceAdapterError);
      expect(String(error)).not.toContain('private.example.test');
    }
  });
});
