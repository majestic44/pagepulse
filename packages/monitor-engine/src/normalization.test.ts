import { describe, expect, it } from 'vitest';

import {
  MonitorNormalizationError,
  normalizeMonitorSource,
  normalizeMonitorText,
  normalizeMonitorUrl,
  parseHtmlSource,
  parseJsonSource,
  parseRssAtomSource,
} from './index.js';

describe('monitor content normalization', () => {
  it('removes executable and common cookie/ad regions before normalizing the selected HTML target', () => {
    const content = normalizeMonitorSource(
      parseHtmlSource(`<html><body><main>
        <script>secret()</script><style>.hidden { display: none }</style>
        <aside class="cookie-consent">We use cookies</aside>
        <div id="sponsored-content">Sponsored</div>
        <article>Role\u3000available <span class="timestamp">2 hours ago</span><span class="ignore">Do not compare</span></article>
      </main></body></html>`),
      {
        ignorePatterns: ['Role'],
        ignoreSelectors: ['.ignore'],
        target: { selector: 'main', targetType: 'css_selector' },
      },
    );

    expect(content.canonical).toEqual({
      sourceType: 'html',
      text: 'available <relative-time>',
    });
    expect(content.hash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('normalizes approved relative timestamps without rewriting ordinary text', () => {
    expect(normalizeMonitorText('Posted yesterday at 9:30 AM   ·  4 days ago')).toBe(
      'Posted <relative-time> · <relative-time>',
    );
    expect(normalizeMonitorText('Version 2 days ago is a product name')).toBe(
      'Version <relative-time> is a product name',
    );
  });

  it('canonicalizes JSON key order and known tracking parameters without stripping meaningful query values', () => {
    const first = normalizeMonitorSource(
      parseJsonSource(
        '{"z":"  Status ","link":"https://example.test/jobs?b=2&utm_source=newsletter&a=1","nested":{"title":"Today"}}',
      ),
    );
    const second = normalizeMonitorSource(
      parseJsonSource(
        '{"nested":{"title":"today"},"link":"https://example.test/jobs?a=1&b=2","z":"Status"}',
      ),
    );

    expect(first.canonical).toEqual({
      sourceType: 'json',
      value: {
        link: 'https://example.test/jobs?a=1&b=2',
        nested: { title: '<relative-time>' },
        z: 'Status',
      },
    });
    expect(first.hash).toBe(second.hash);
    expect(normalizeMonitorUrl('https://example.test/path?ref=internal&utm_campaign=weekly')).toBe(
      'https://example.test/path?ref=internal',
    );
  });

  it('normalizes feed text and links into deterministic typed entries', () => {
    const content = normalizeMonitorSource(
      parseRssAtomSource(`<rss><channel><item><guid>one</guid><title>New post</title>
        <link>https://example.test/post?utm_medium=email&id=42</link>
        <description>Published 3 minutes ago</description>
      </item></channel></rss>`),
    );

    expect(content.canonical).toEqual({
      items: [
        {
          content: 'Published <relative-time>',
          id: 'one',
          link: 'https://example.test/post?id=42',
          publishedAt: null,
          title: 'New post',
        },
      ],
      sourceType: 'rss_atom',
    });
  });

  it('rejects missing targets and invalid ignore selectors without returning raw source content', () => {
    expect(() =>
      normalizeMonitorSource(parseHtmlSource('<main>Safe text</main>'), {
        target: { selector: '.missing', targetType: 'css_selector' },
      }),
    ).toThrow(expect.objectContaining({ code: 'target_missing' }));
    expect(() =>
      normalizeMonitorSource(parseHtmlSource('<main>Safe text</main>'), {
        ignoreSelectors: ['main['],
      }),
    ).toThrow(MonitorNormalizationError);
    expect(() =>
      normalizeMonitorSource(parseJsonSource('{"title":"Status"}'), {
        ignorePatterns: ['Status', 'Status'],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_ignore_pattern' }));
  });
});
