import { createHash } from 'node:crypto';

import type { CheerioAPI } from 'cheerio';

import type { MonitorTargetConfiguration, NormalizedMonitorRuleConfiguration } from './index.js';
import { normalizeMonitorText, normalizeMonitorUrl } from './normalization.js';
import type { CanonicalMonitorSource, NormalizedMonitorContent } from './normalization.js';
import type { HtmlSource } from './source-adapters.js';

export type ListingIdentityKind = 'fingerprint' | 'url' | 'website_id';

export type ListingItem = Readonly<{
  contentHash: string;
  identity: string;
  identityKind: ListingIdentityKind;
}>;

export type RuleMatch =
  | Readonly<{ kind: 'keyword'; phrase: string; transition: 'appears' | 'disappears' }>
  | Readonly<{ identity: string; kind: 'new_item' }>
  | Readonly<{ kind: 'text_change' }>;

export type MonitorRuleEvaluation = Readonly<{
  baseline: boolean;
  changed: boolean;
  matches: ReadonlyArray<RuleMatch>;
}>;

export type EvaluateMonitorRulesInput = Readonly<{
  current: NormalizedMonitorContent;
  currentListings?: ReadonlyArray<ListingItem> | undefined;
  previous?: NormalizedMonitorContent | undefined;
  previousListings?: ReadonlyArray<ListingItem> | undefined;
  rules: NormalizedMonitorRuleConfiguration;
}>;

export type ExtractListingItemsOptions = Readonly<{
  baseUrl?: string | undefined;
  target: MonitorTargetConfiguration;
}>;

export class ListingIdentityError extends Error {
  constructor(readonly code: 'duplicate_identity' | 'listing_not_configured' | 'target_missing') {
    super(`Listing identity could not be derived: ${code}`);
    this.name = 'ListingIdentityError';
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function textValue(document: CheerioAPI, element: Parameters<CheerioAPI>[0]) {
  return normalizeMonitorText(document(element).text());
}

function candidatesFor(document: CheerioAPI, item: Parameters<CheerioAPI>[0], selector: string) {
  const selected = document(item).find(selector).toArray();
  return document(item).is(selector) ? [item, ...selected] : selected;
}

function websiteId(document: CheerioAPI, item: Parameters<CheerioAPI>[0]) {
  for (const element of candidatesFor(document, item, '[data-id], [data-key], [itemid]')) {
    for (const attribute of ['data-id', 'data-key', 'itemid']) {
      const value = normalizeMonitorText(document(element).attr(attribute) ?? '');
      if (value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function canonicalUrl(
  document: CheerioAPI,
  item: Parameters<CheerioAPI>[0],
  baseUrl: string | undefined,
) {
  for (const element of candidatesFor(document, item, 'a[href], [href]')) {
    const href = document(element).attr('href');
    if (!href) {
      continue;
    }
    try {
      const normalized = normalizeMonitorUrl(
        baseUrl === undefined ? href : new URL(href, baseUrl).toString(),
      );
      if (/^https?:\/\//iu.test(normalized)) {
        return normalized;
      }
    } catch {
      // Try the next link candidate; malformed links are not listing identities.
    }
  }
  return undefined;
}

function itemFingerprint(
  document: CheerioAPI,
  item: Parameters<CheerioAPI>[0],
  identitySelector: string,
  text: string,
) {
  const title = candidatesFor(document, item, identitySelector)
    .map((element) => textValue(document, element))
    .find((value) => value.length > 0);
  const location = candidatesFor(document, item, '[data-location], .location, [itemprop="address"]')
    .map((element) => textValue(document, element))
    .find((value) => value.length > 0);
  return hash(JSON.stringify({ content: text, location: location ?? '', title: title ?? '' }));
}

function listingItem(
  document: CheerioAPI,
  item: Parameters<CheerioAPI>[0],
  identitySelector: string,
  baseUrl: string | undefined,
): ListingItem {
  const copy = document(item).clone();
  copy.find('script,style,noscript,template').remove();
  const text = normalizeMonitorText(copy.text());
  const id = websiteId(document, item);
  if (id !== undefined) {
    return { contentHash: hash(text), identity: hash(id), identityKind: 'website_id' };
  }
  const url = canonicalUrl(document, item, baseUrl);
  if (url !== undefined) {
    return { contentHash: hash(text), identity: hash(url), identityKind: 'url' };
  }
  return {
    contentHash: hash(text),
    identity: itemFingerprint(document, item, identitySelector, text),
    identityKind: 'fingerprint',
  };
}

export function extractListingItems(
  source: HtmlSource,
  options: ExtractListingItemsOptions,
): ReadonlyArray<ListingItem> {
  const repeatedList = options.target.repeatedList;
  if (repeatedList === undefined) {
    throw new ListingIdentityError('listing_not_configured');
  }
  const document = source.document;
  const target =
    options.target.targetType === 'css_selector'
      ? document(options.target.selector)
      : document('body');
  if (target.length === 0) {
    throw new ListingIdentityError('target_missing');
  }
  const items = target.find(repeatedList.itemSelector).toArray();
  if (items.length === 0) {
    throw new ListingIdentityError('target_missing');
  }
  const listings = items.map((item) => {
    const copy = document(item).clone();
    for (const selector of repeatedList.ignoreSelectors ?? []) {
      copy.find(selector).remove();
    }
    const cloneDocument = source.document.load(`<body>${copy.toString()}</body>`);
    return listingItem(
      cloneDocument,
      cloneDocument('body').children().first()[0],
      repeatedList.identitySelector,
      options.baseUrl,
    );
  });
  const sorted = [...listings].sort((left, right) =>
    left.identity.localeCompare(right.identity, 'en-US'),
  );
  if (new Set(sorted.map((item) => item.identity)).size !== sorted.length) {
    throw new ListingIdentityError('duplicate_identity');
  }
  return sorted;
}

function sourceText(source: CanonicalMonitorSource): string {
  if (source.sourceType === 'html') {
    return source.text;
  }
  if (source.sourceType === 'rss_atom') {
    return source.items
      .flatMap((item) => [item.content, item.id, item.link, item.publishedAt, item.title])
      .filter((value): value is string => value !== null)
      .join(' ');
  }
  const strings: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      strings.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === 'object') {
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, 'en-US'))
        .forEach((key) => visit((value as Record<string, unknown>)[key]));
    }
  };
  visit(source.value);
  return strings.join(' ');
}

function containsPhrase(source: CanonicalMonitorSource, phrase: string) {
  return normalizeMonitorText(sourceText(source))
    .toLocaleLowerCase('en-US')
    .includes(normalizeMonitorText(phrase).toLocaleLowerCase('en-US'));
}

function newListingMatches(
  previous: ReadonlyArray<ListingItem>,
  current: ReadonlyArray<ListingItem>,
): ReadonlyArray<RuleMatch> {
  const previousIdentities = new Set(previous.map((item) => item.identity));
  return current
    .filter((item) => !previousIdentities.has(item.identity))
    .map((item) => ({ identity: item.identity, kind: 'new_item' }) as const);
}

export function evaluateMonitorRules(input: EvaluateMonitorRulesInput): MonitorRuleEvaluation {
  if (input.previous === undefined) {
    return { baseline: true, changed: false, matches: [] };
  }
  const matches: RuleMatch[] = [];
  if (input.rules.textChange && input.previous.hash !== input.current.hash) {
    matches.push({ kind: 'text_change' });
  }
  if (input.rules.newItem) {
    matches.push(...newListingMatches(input.previousListings ?? [], input.currentListings ?? []));
  }
  if (input.rules.keyword !== null) {
    for (const phrase of input.rules.keyword.phrases) {
      const wasPresent = containsPhrase(input.previous.canonical, phrase);
      const isPresent = containsPhrase(input.current.canonical, phrase);
      if (
        (input.rules.keyword.transition === 'appears' && !wasPresent && isPresent) ||
        (input.rules.keyword.transition === 'disappears' && wasPresent && !isPresent)
      ) {
        matches.push({ kind: 'keyword', phrase, transition: input.rules.keyword.transition });
      }
    }
  }
  return { baseline: false, changed: matches.length > 0, matches };
}
