import { createHash } from 'node:crypto';

import type { MonitorTargetConfiguration } from './index.js';
import type {
  FeedSourceItem,
  JsonSourceValue,
  ParsedMonitorSource,
  RssAtomSource,
} from './source-adapters.js';

const trackingParameterNames = new Set([
  'dclid',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'ttclid',
]);

const noiseAttributeFragments = ['advert', 'cookie', 'consent', 'promoted', 'sponsor'] as const;
const MAXIMUM_IGNORE_PATTERNS = 25;
const MAXIMUM_IGNORE_PATTERN_CHARACTERS = 160;

export type CanonicalHtmlSource = Readonly<{
  sourceType: 'html';
  text: string;
}>;

export type CanonicalJsonSource = Readonly<{
  sourceType: 'json';
  value: JsonSourceValue;
}>;

export type CanonicalRssAtomSource = Readonly<{
  items: ReadonlyArray<FeedSourceItem>;
  sourceType: 'rss_atom';
}>;

export type CanonicalMonitorSource =
  CanonicalHtmlSource | CanonicalJsonSource | CanonicalRssAtomSource;

export type NormalizedMonitorContent = Readonly<{
  canonical: CanonicalMonitorSource;
  hash: string;
}>;

export type NormalizeMonitorSourceOptions = Readonly<{
  ignorePatterns?: ReadonlyArray<string> | undefined;
  ignoreSelectors?: ReadonlyArray<string> | undefined;
  target?: MonitorTargetConfiguration | undefined;
}>;

export class MonitorNormalizationError extends Error {
  constructor(
    readonly code: 'invalid_ignore_pattern' | 'invalid_ignore_selector' | 'target_missing',
  ) {
    super(`Monitor content could not be normalized: ${code}`);
    this.name = 'MonitorNormalizationError';
  }
}

function normalizeIgnorePatterns(patterns: ReadonlyArray<string> | undefined) {
  if (patterns === undefined) {
    return [];
  }
  if (patterns.length > MAXIMUM_IGNORE_PATTERNS) {
    throw new MonitorNormalizationError('invalid_ignore_pattern');
  }
  const normalized = patterns.map((pattern) => {
    const value = normalizeMonitorText(pattern);
    if (value.length === 0 || value.length > MAXIMUM_IGNORE_PATTERN_CHARACTERS) {
      throw new MonitorNormalizationError('invalid_ignore_pattern');
    }
    return value;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new MonitorNormalizationError('invalid_ignore_pattern');
  }
  return normalized;
}

function removeIgnoredPatterns(value: string, patterns: ReadonlyArray<string>) {
  let normalized = normalizeMonitorText(value);
  for (const pattern of patterns) {
    normalized = normalized.split(pattern).join('');
  }
  return normalizeMonitorText(normalized);
}

export function normalizeMonitorText(value: string) {
  return value
    .normalize('NFKC')
    .replace(
      /(?:\b(?:just now|moments ago)\b|\b(?:today|yesterday)(?:\s+at\s+\d{1,2}:\d{2}(?:\s*[ap]m)?)?\b|\b\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b)/giu,
      '<relative-time>',
    )
    .replace(/\s+/gu, ' ')
    .trim();
}

export function normalizeMonitorUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return normalizeMonitorText(value);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return normalizeMonitorText(value);
  }
  for (const [name] of url.searchParams) {
    if (name.toLowerCase().startsWith('utm_') || trackingParameterNames.has(name.toLowerCase())) {
      url.searchParams.delete(name);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

function looksLikeHttpUrl(value: string) {
  return /^https?:\/\//iu.test(value);
}

function isJsonArray(value: JsonSourceValue): value is ReadonlyArray<JsonSourceValue> {
  return Array.isArray(value);
}

function isJsonObject(value: JsonSourceValue): value is Readonly<Record<string, JsonSourceValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJsonValue(
  value: JsonSourceValue,
  ignorePatterns: ReadonlyArray<string>,
): JsonSourceValue {
  if (typeof value === 'string') {
    return looksLikeHttpUrl(value)
      ? normalizeMonitorUrl(value)
      : removeIgnoredPatterns(value, ignorePatterns);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (isJsonArray(value)) {
    return value.map((child) => normalizeJsonValue(child, ignorePatterns));
  }
  if (!isJsonObject(value)) {
    throw new Error('JSON source value is invalid');
  }
  const normalized: Record<string, JsonSourceValue> = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right, 'en-US'))) {
    normalized[key.normalize('NFKC')] = normalizeJsonValue(value[key]!, ignorePatterns);
  }
  return normalized;
}

function normalizeHtmlSource(
  source: Extract<ParsedMonitorSource, { sourceType: 'html' }>,
  options: NormalizeMonitorSourceOptions,
  ignorePatterns: ReadonlyArray<string>,
): CanonicalHtmlSource {
  const document = source.document;
  const target = options.target;
  let selected: ReturnType<typeof document>;
  try {
    selected = target?.targetType === 'css_selector' ? document(target.selector) : document('body');
  } catch {
    throw new MonitorNormalizationError('target_missing');
  }
  if (selected.length === 0) {
    throw new MonitorNormalizationError('target_missing');
  }
  const copy = selected.clone();
  copy.find('script,style,noscript,template').remove();
  copy
    .find('*')
    .filter((_index, element) => {
      const attributes =
        `${document(element).attr('id') ?? ''} ${document(element).attr('class') ?? ''}`.toLowerCase();
      return noiseAttributeFragments.some((fragment) => attributes.includes(fragment));
    })
    .remove();
  for (const selector of options.ignoreSelectors ?? []) {
    try {
      copy.find(selector).remove();
    } catch {
      throw new MonitorNormalizationError('invalid_ignore_selector');
    }
  }
  const text = removeIgnoredPatterns(copy.text(), ignorePatterns);
  if (text.length === 0) {
    throw new MonitorNormalizationError('target_missing');
  }
  return { sourceType: 'html', text };
}

function normalizeFeedItem(
  item: FeedSourceItem,
  ignorePatterns: ReadonlyArray<string>,
): FeedSourceItem {
  return {
    content: item.content === null ? null : removeIgnoredPatterns(item.content, ignorePatterns),
    id: item.id === null ? null : removeIgnoredPatterns(item.id, ignorePatterns),
    link: item.link === null ? null : normalizeMonitorUrl(item.link),
    publishedAt:
      item.publishedAt === null ? null : removeIgnoredPatterns(item.publishedAt, ignorePatterns),
    title: item.title === null ? null : removeIgnoredPatterns(item.title, ignorePatterns),
  };
}

function normalizeRssAtomSource(
  source: RssAtomSource,
  ignorePatterns: ReadonlyArray<string>,
): CanonicalRssAtomSource {
  return {
    items: source.items.map((item) => normalizeFeedItem(item, ignorePatterns)),
    sourceType: 'rss_atom',
  };
}

export function canonicalMonitorSourceJson(value: CanonicalMonitorSource) {
  return JSON.stringify(value);
}

export function normalizeMonitorSource(
  source: ParsedMonitorSource,
  options: NormalizeMonitorSourceOptions = {},
): NormalizedMonitorContent {
  const ignorePatterns = normalizeIgnorePatterns(options.ignorePatterns);
  let canonical: CanonicalMonitorSource;
  if (source.sourceType === 'html') {
    canonical = normalizeHtmlSource(source, options, ignorePatterns);
  } else if (source.sourceType === 'json') {
    canonical = { sourceType: 'json', value: normalizeJsonValue(source.value, ignorePatterns) };
  } else {
    canonical = normalizeRssAtomSource(source, ignorePatterns);
  }
  return {
    canonical,
    hash: createHash('sha256').update(canonicalMonitorSourceJson(canonical)).digest('hex'),
  };
}
