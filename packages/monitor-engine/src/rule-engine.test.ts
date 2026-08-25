import { describe, expect, it } from 'vitest';

import { evaluateMonitorRules, extractListingItems, parseHtmlSource } from './index.js';
import { ruleEngineFixtures } from './rule-engine.fixtures.js';

describe('deterministic rule-engine fixtures', () => {
  it.each(ruleEngineFixtures)('$name', ({ input, output }) => {
    expect(evaluateMonitorRules(input)).toEqual(output);
  });
});

describe('listing identity', () => {
  it('uses website IDs, then canonical URLs, then a title/location/content fingerprint', () => {
    const listings = extractListingItems(
      parseHtmlSource(`<main><article class="job" data-id="internal-42"><a href="/one?utm_source=mail">One</a></article>
        <article class="job"><a href="/two?b=2&utm_source=mail&a=1">Two</a></article>
        <article class="job"><h2 class="title">Three</h2><span class="location">Remote</span></article></main>`),
      {
        baseUrl: 'https://example.test/jobs',
        target: {
          repeatedList: { identitySelector: '.title', itemSelector: '.job' },
          targetType: 'whole_page',
        },
      },
    );

    expect(listings.map((listing) => listing.identityKind).sort()).toEqual([
      'fingerprint',
      'url',
      'website_id',
    ]);
    expect(listings).toHaveLength(3);
    expect(listings.every((listing) => /^[a-f0-9]{64}$/u.test(listing.identity))).toBe(true);
  });

  it('does not treat list reordering as a new item', () => {
    const options = {
      baseUrl: 'https://example.test/',
      target: {
        repeatedList: { identitySelector: 'a[href]', itemSelector: 'li' },
        targetType: 'whole_page' as const,
      },
    };
    const first = extractListingItems(
      parseHtmlSource('<ul><li><a href="/one">One</a></li><li><a href="/two">Two</a></li></ul>'),
      options,
    );
    const second = extractListingItems(
      parseHtmlSource('<ul><li><a href="/two">Two</a></li><li><a href="/one">One</a></li></ul>'),
      options,
    );

    expect(second).toEqual(first);
  });
});
