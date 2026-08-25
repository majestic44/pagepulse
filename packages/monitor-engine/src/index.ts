import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';

import { load } from 'cheerio';

import {
  SafeHttpError,
  safeHttpFetch,
  type HostResolver as SafeHostResolver,
  type SafeHttpTransport,
} from './safe-http.js';

export {
  defaultHostResolver,
  defaultSafeHttpTransport,
  isPublicIpAddress as isSafeHttpPublicIpAddress,
  pagePulseUserAgent as safeHttpUserAgent,
  safeHttpFetch,
  SafeHttpError,
  validatePublicHttpDestination,
} from './safe-http.js';
export type {
  HostResolver as SafeHttpHostResolver,
  ResolvedAddress as SafeHttpResolvedAddress,
  SafeHttpFetchOptions,
  SafeHttpResponse,
  SafeHttpTransport,
} from './safe-http.js';
export {
  fetchMonitorSource,
  parseHtmlSource,
  parseJsonSource,
  parseRssAtomSource,
  SourceAdapterError,
} from './source-adapters.js';
export {
  canonicalMonitorSourceJson,
  MonitorNormalizationError,
  normalizeMonitorSource,
  normalizeMonitorText,
  normalizeMonitorUrl,
} from './normalization.js';
export type {
  CanonicalHtmlSource,
  CanonicalJsonSource,
  CanonicalMonitorSource,
  CanonicalRssAtomSource,
  NormalizeMonitorSourceOptions,
  NormalizedMonitorContent,
} from './normalization.js';
export type {
  FetchMonitorSourceOptions,
  FeedSourceItem,
  HtmlSource,
  JsonSource,
  JsonSourceValue,
  MonitorSourceType,
  ParsedMonitorSource,
  RssAtomSource,
} from './source-adapters.js';

const MAXIMUM_SELECTOR_LENGTH = 512;
const MAXIMUM_REPEATED_LIST_CANDIDATES = 6;
const MAXIMUM_REPEATED_LIST_PARENT_ELEMENTS = 128;
const MAXIMUM_REPEATED_LIST_IGNORE_SELECTORS = 10;
const MAXIMUM_REPEATED_LIST_PREVIEW_ITEMS = 5;
const MAXIMUM_REPEATED_LIST_SAMPLE_CHARACTERS = 1_000;
const MAXIMUM_KEYWORD_RULE_PHRASES = 25;
const MAXIMUM_KEYWORD_RULE_PHRASE_LENGTH = 160;
const DEFAULT_PREVIEW_MAX_BYTES = 512 * 1_024;
const DEFAULT_PREVIEW_MAX_CHARACTERS = 20_000;
const DEFAULT_PREVIEW_MAX_REDIRECTS = 3;
const DEFAULT_PREVIEW_TIMEOUT_MS = 15_000;

export type MonitorTargetType = 'css_selector' | 'whole_page';

export type MonitorKeywordTransition = 'appears' | 'disappears';

export type MonitorKeywordRuleConfiguration = Readonly<{
  phrases: ReadonlyArray<string>;
  transition: MonitorKeywordTransition;
}>;

export type MonitorRuleConfiguration = Readonly<{
  keyword?: MonitorKeywordRuleConfiguration | undefined;
  newItem?: boolean | undefined;
  textChange?: boolean | undefined;
}>;

export type NormalizedMonitorRuleConfiguration = Readonly<{
  keyword: MonitorKeywordRuleConfiguration | null;
  newItem: boolean;
  textChange: boolean;
}>;

export type MonitorRepeatedListConfiguration = Readonly<{
  identitySelector: string;
  ignoreSelectors?: ReadonlyArray<string> | undefined;
  itemSelector: string;
}>;

export type MonitorTargetConfiguration = Readonly<{
  repeatedList?: MonitorRepeatedListConfiguration | undefined;
  selector?: string | undefined;
  targetType: MonitorTargetType;
}>;

export type NormalizedMonitorRepeatedListConfiguration = Readonly<{
  identitySelector: string;
  ignoreSelectors: ReadonlyArray<string>;
  itemSelector: string;
}>;

export type NormalizedMonitorTargetConfiguration = Readonly<{
  repeatedList: NormalizedMonitorRepeatedListConfiguration | null;
  selector: string | null;
  targetType: MonitorTargetType;
}>;

export type RepeatedListCandidate = Readonly<{
  identitySelectorSuggestions: ReadonlyArray<string>;
  itemCount: number;
  itemSelector: string;
  sampleTexts: ReadonlyArray<string>;
}>;

export type RepeatedListItemPreview = Readonly<{
  identity: string;
  text: string;
}>;

export type RepeatedListPreview = Readonly<{
  itemCount: number;
  items: ReadonlyArray<RepeatedListItemPreview>;
  truncated: boolean;
}>;

export type HtmlExtractionPreview = Readonly<{
  matchCount: number;
  repeatedList: RepeatedListPreview | null;
  repeatedListCandidates: ReadonlyArray<RepeatedListCandidate>;
  text: string;
  truncated: boolean;
}>;

export type ResolvedAddress = Readonly<{
  address: string;
  family: 4 | 6;
}>;

export type HostResolver = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;

export type PreviewHttpResponse = Readonly<{
  body: Buffer;
  headers: IncomingHttpHeaders;
  statusCode: number;
}>;

export type PreviewHttpTransport = (
  url: URL,
  options: Readonly<{
    maxBytes: number;
    resolver: HostResolver;
    timeoutMs: number;
  }>,
) => Promise<PreviewHttpResponse>;

export type HtmlPreviewOptions = Readonly<{
  maxBytes?: number;
  maxCharacters?: number;
  maxRedirects?: number;
  request?: PreviewHttpTransport;
  resolver?: HostResolver;
  timeoutMs?: number;
}>;

export class MonitorTargetValidationError extends Error {
  constructor(message: string) {
    super(`Monitor target is invalid: ${message}`);
    this.name = 'MonitorTargetValidationError';
  }
}

export class MonitorRuleValidationError extends Error {
  constructor(message: string) {
    super(`Monitor rule is invalid: ${message}`);
    this.name = 'MonitorRuleValidationError';
  }
}

export class MonitorPreviewError extends Error {
  constructor(
    readonly code:
      | 'destination_not_allowed'
      | 'fetch_failed'
      | 'response_too_large'
      | 'selector_no_match'
      | 'unsupported_response',
  ) {
    super(`Monitor preview failed: ${code}`);
    this.name = 'MonitorPreviewError';
  }
}

export function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function normalizeMonitorRuleConfiguration(
  configuration: MonitorRuleConfiguration,
): NormalizedMonitorRuleConfiguration {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new MonitorRuleValidationError('configuration is invalid');
  }
  const textChange = configuration.textChange === true;
  const newItem = configuration.newItem === true;
  if (configuration.textChange !== undefined && typeof configuration.textChange !== 'boolean') {
    throw new MonitorRuleValidationError('textChange is invalid');
  }
  if (configuration.newItem !== undefined && typeof configuration.newItem !== 'boolean') {
    throw new MonitorRuleValidationError('newItem is invalid');
  }
  let keyword: MonitorKeywordRuleConfiguration | null = null;
  if (configuration.keyword !== undefined) {
    const candidate = configuration.keyword;
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new MonitorRuleValidationError('keyword is invalid');
    }
    if (candidate.transition !== 'appears' && candidate.transition !== 'disappears') {
      throw new MonitorRuleValidationError('keyword transition is invalid');
    }
    if (
      !Array.isArray(candidate.phrases) ||
      candidate.phrases.length === 0 ||
      candidate.phrases.length > MAXIMUM_KEYWORD_RULE_PHRASES
    ) {
      throw new MonitorRuleValidationError('keyword phrases are invalid');
    }
    const phrases = candidate.phrases.map((phrase) => {
      if (typeof phrase !== 'string') {
        throw new MonitorRuleValidationError('keyword phrase is invalid');
      }
      const normalized = normalizeText(phrase);
      if (
        normalized.length === 0 ||
        normalized.length > MAXIMUM_KEYWORD_RULE_PHRASE_LENGTH ||
        containsControlCharacter(normalized)
      ) {
        throw new MonitorRuleValidationError('keyword phrase is invalid');
      }
      return normalized;
    });
    if (
      new Set(phrases.map((phrase) => phrase.toLocaleLowerCase('en-US'))).size !== phrases.length
    ) {
      throw new MonitorRuleValidationError('keyword phrases must be unique');
    }
    keyword = { phrases, transition: candidate.transition };
  }
  if (!textChange && !newItem && keyword === null) {
    throw new MonitorRuleValidationError('at least one rule must be enabled');
  }
  return { keyword, newItem, textChange };
}

export function contentHash(value: string): string {
  return createHash('sha256').update(normalizeText(value)).digest('hex');
}

export function hasTextChanged(previous: string, current: string): boolean {
  return contentHash(previous) !== contentHash(current);
}

function containsControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function validateCssSelector(selector: string, field: string) {
  try {
    load('<main></main>')(selector);
  } catch {
    throw new MonitorTargetValidationError(`${field} is not valid CSS`);
  }
  return selector;
}

function normalizeCssSelector(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new MonitorTargetValidationError(`${field} is required`);
  }
  const selector = value.trim();
  if (
    selector.length === 0 ||
    selector.length > MAXIMUM_SELECTOR_LENGTH ||
    containsControlCharacter(selector)
  ) {
    throw new MonitorTargetValidationError(`${field} is invalid`);
  }
  return validateCssSelector(selector, field);
}

function normalizeRepeatedListConfiguration(
  configuration: MonitorRepeatedListConfiguration | undefined,
): NormalizedMonitorRepeatedListConfiguration | null {
  if (configuration === undefined) {
    return null;
  }
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new MonitorTargetValidationError('repeatedList is invalid');
  }
  const itemSelector = normalizeCssSelector(
    configuration.itemSelector,
    'repeated list itemSelector',
  );
  const identitySelector = normalizeCssSelector(
    configuration.identitySelector,
    'repeated list identitySelector',
  );
  const values = configuration.ignoreSelectors ?? [];
  if (!Array.isArray(values) || values.length > MAXIMUM_REPEATED_LIST_IGNORE_SELECTORS) {
    throw new MonitorTargetValidationError('repeated list ignoreSelectors is invalid');
  }
  const ignoreSelectors = values.map((value) =>
    normalizeCssSelector(value, 'repeated list ignore selector'),
  );
  if (new Set(ignoreSelectors).size !== ignoreSelectors.length) {
    throw new MonitorTargetValidationError('repeated list ignore selectors must be unique');
  }
  if (ignoreSelectors.includes(identitySelector)) {
    throw new MonitorTargetValidationError('repeated list identity selector cannot be ignored');
  }
  return { identitySelector, ignoreSelectors, itemSelector };
}

export function normalizeMonitorTargetConfiguration(
  configuration: MonitorTargetConfiguration,
): NormalizedMonitorTargetConfiguration {
  const repeatedList = normalizeRepeatedListConfiguration(configuration.repeatedList);
  if (configuration.targetType === 'whole_page') {
    if (configuration.selector !== undefined) {
      throw new MonitorTargetValidationError('whole-page targets cannot include a selector');
    }
    return { repeatedList, selector: null, targetType: 'whole_page' };
  }
  if (configuration.targetType !== 'css_selector') {
    throw new MonitorTargetValidationError('targetType must be whole_page or css_selector');
  }
  const selector = normalizeCssSelector(configuration.selector, 'selector');
  return { repeatedList, selector, targetType: 'css_selector' };
}

function ipv4AsNumber(address: string) {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return undefined;
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isIpv4Within(address: number, network: string, prefixLength: number) {
  const networkAddress = ipv4AsNumber(network);
  if (networkAddress === undefined) {
    throw new Error('IP network configuration is invalid');
  }
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (address & mask) === (networkAddress & mask);
}

const blockedIpv4Ranges: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv6AsBigInt(address: string) {
  if (address.includes('%')) {
    return undefined;
  }
  const doubleColonIndex = address.indexOf('::');
  if (doubleColonIndex !== -1 && address.indexOf('::', doubleColonIndex + 1) !== -1) {
    return undefined;
  }
  const left = doubleColonIndex === -1 ? address : address.slice(0, doubleColonIndex);
  const right = doubleColonIndex === -1 ? '' : address.slice(doubleColonIndex + 2);
  const groups = [
    ...(left.length === 0 ? [] : left.split(':')),
    ...(right.length === 0 ? [] : right.split(':')),
  ];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group))) {
    return undefined;
  }
  const missingGroups = 8 - groups.length;
  if ((doubleColonIndex === -1 && missingGroups !== 0) || missingGroups < 0) {
    return undefined;
  }
  const fullGroups = [
    ...(left.length === 0 ? [] : left.split(':')),
    ...Array.from({ length: missingGroups }, () => '0'),
    ...(right.length === 0 ? [] : right.split(':')),
  ];
  return BigInt(`0x${fullGroups.map((group) => group.padStart(4, '0')).join('')}`);
}

function isIpv6Within(address: bigint, network: string, prefixLength: number) {
  const networkAddress = ipv6AsBigInt(network);
  if (networkAddress === undefined) {
    throw new Error('IP network configuration is invalid');
  }
  const mask = prefixLength === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - prefixLength);
  return (address & mask) === (networkAddress & mask);
}

const blockedIpv6Ranges: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['2001:db8::', 32],
  ['2001:10::', 28],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

function mappedIpv4(address: string) {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address);
  return match?.[1];
}

function ipv4FromNumericAddress(address: bigint) {
  const value = Number(address & 0xffffffffn);
  return [
    String((value >>> 24) & 0xff),
    String((value >>> 16) & 0xff),
    String((value >>> 8) & 0xff),
    String(value & 0xff),
  ].join('.');
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const numericAddress = ipv4AsNumber(address);
    if (numericAddress === undefined) {
      return false;
    }
    return !blockedIpv4Ranges.some(([network, prefixLength]) =>
      isIpv4Within(numericAddress, network, prefixLength),
    );
  }
  if (family !== 6) {
    return false;
  }
  const mapped = mappedIpv4(address);
  if (mapped) {
    return isPublicIpAddress(mapped);
  }
  const numericAddress = ipv6AsBigInt(address);
  if (numericAddress === undefined) {
    return false;
  }
  if (isIpv6Within(numericAddress, '::ffff:0:0', 96)) {
    return isPublicIpAddress(ipv4FromNumericAddress(numericAddress));
  }
  if (isIpv6Within(numericAddress, '::', 96)) {
    return false;
  }
  return !blockedIpv6Ranges.some(([network, prefixLength]) =>
    isIpv6Within(numericAddress, network, prefixLength),
  );
}

async function resolvePublicAddress(hostname: string, resolver: HostResolver) {
  const addresses = await resolver(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new MonitorPreviewError('destination_not_allowed');
  }
  return addresses[0]!;
}

const defaultResolver: HostResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );

export async function validatePreviewDestination(
  url: URL,
  resolver: HostResolver = defaultResolver,
) {
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new MonitorPreviewError('destination_not_allowed');
  }
  await resolvePublicAddress(url.hostname, resolver);
}

function headerValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isHtmlContentType(contentType: string | undefined) {
  return (
    contentType?.toLowerCase().split(';', 1)[0] === 'text/html' ||
    contentType?.toLowerCase().split(';', 1)[0] === 'application/xhtml+xml'
  );
}

export function extractHtmlTarget(
  html: string,
  configuration: MonitorTargetConfiguration,
  maxCharacters = DEFAULT_PREVIEW_MAX_CHARACTERS,
): HtmlExtractionPreview {
  const target = normalizeMonitorTargetConfiguration(configuration);
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error('Preview text limit is invalid');
  }
  const document = load(html);
  document('script, style, noscript, template').remove();
  document(
    'a, article, blockquote, br, div, h1, h2, h3, h4, h5, h6, li, p, section, span, td, th',
  ).append(' ');
  const matches =
    target.targetType === 'whole_page'
      ? document('body').toArray()
      : document(target.selector!).toArray();
  if (matches.length === 0) {
    throw new MonitorPreviewError('selector_no_match');
  }
  const targetElements = new Set(matches);
  const findWithinTarget = (selector: string) =>
    document(selector)
      .toArray()
      .filter(
        (element) =>
          targetElements.has(element) ||
          document(element)
            .parents()
            .toArray()
            .some((parent) => targetElements.has(parent)),
      );
  const elementSignature = (element: (typeof matches)[number]) => {
    const tagName = document(element).prop('tagName');
    if (typeof tagName !== 'string' || tagName.length === 0) {
      return undefined;
    }
    const stableClasses = (document(element).attr('class') ?? '')
      .split(/\s+/u)
      .filter((className) => /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(className))
      .slice(0, 2);
    return `${tagName.toLowerCase()}${stableClasses.map((className) => `.${className}`).join('')}`;
  };
  const identityValue = (item: (typeof matches)[number], selector: string) => {
    const identityRegion = document(item).find(selector).first();
    if (identityRegion.length === 0) {
      return undefined;
    }
    const text = normalizeText(identityRegion.text());
    if (text.length > 0) {
      return text;
    }
    return ['data-id', 'data-key', 'id', 'href', 'value', 'content']
      .map((attribute) => identityRegion.attr(attribute))
      .map((value) => (value === undefined ? '' : normalizeText(value)))
      .find((value) => value.length > 0);
  };
  const visibleItemText = (item: (typeof matches)[number]) => {
    const copy = document(item).clone();
    target.repeatedList?.ignoreSelectors.forEach((selector) => copy.find(selector).remove());
    return normalizeText(copy.text());
  };
  const repeatedListCandidates = (() => {
    const candidates = new Map<string, RepeatedListCandidate>();
    const parents = [
      ...matches,
      ...findWithinTarget('*').filter((element) => document(element).children().length > 0),
    ];
    for (const parent of [...new Set(parents)].slice(0, MAXIMUM_REPEATED_LIST_PARENT_ELEMENTS)) {
      const groups = new Map<string, Array<(typeof matches)[number]>>();
      document(parent)
        .children()
        .each((_index, child) => {
          const signature = elementSignature(child);
          if (!signature) {
            return;
          }
          const group = groups.get(signature) ?? [];
          group.push(child);
          groups.set(signature, group);
        });
      const parentSignature = elementSignature(parent);
      for (const [itemSignature, groupedItems] of groups) {
        if (groupedItems.length < 2) {
          continue;
        }
        const itemSelector = parentSignature
          ? `${parentSignature} > ${itemSignature}`
          : itemSignature;
        if (!candidates.has(itemSelector) && candidates.size >= MAXIMUM_REPEATED_LIST_CANDIDATES) {
          continue;
        }
        const items = findWithinTarget(itemSelector);
        if (items.length < 2) {
          continue;
        }
        const identitySelectorSuggestions = [
          'a[href]',
          '[itemprop="name"]',
          '.title',
          'h1, h2, h3, h4, h5, h6',
          '[data-id]',
        ].filter((selector) => items.every((item) => identityValue(item, selector) !== undefined));
        const candidate = {
          identitySelectorSuggestions,
          itemCount: items.length,
          itemSelector,
          sampleTexts: items
            .slice(0, 3)
            .map((item) =>
              normalizeText(document(item).text()).slice(
                0,
                MAXIMUM_REPEATED_LIST_SAMPLE_CHARACTERS,
              ),
            )
            .filter((text) => text.length > 0),
        } satisfies RepeatedListCandidate;
        const existing = candidates.get(itemSelector);
        if (!existing || candidate.itemCount > existing.itemCount) {
          candidates.set(itemSelector, candidate);
        }
      }
    }
    return [...candidates.values()]
      .sort(
        (left, right) =>
          right.itemCount - left.itemCount || left.itemSelector.localeCompare(right.itemSelector),
      )
      .slice(0, MAXIMUM_REPEATED_LIST_CANDIDATES);
  })();
  const repeatedList = (() => {
    if (!target.repeatedList) {
      return null;
    }
    const items = findWithinTarget(target.repeatedList.itemSelector);
    if (
      items.length === 0 ||
      items.some((item) => identityValue(item, target.repeatedList!.identitySelector) === undefined)
    ) {
      throw new MonitorPreviewError('selector_no_match');
    }
    let truncated = items.length > MAXIMUM_REPEATED_LIST_PREVIEW_ITEMS;
    const previews = items.slice(0, MAXIMUM_REPEATED_LIST_PREVIEW_ITEMS).map((item) => {
      const identity = identityValue(item, target.repeatedList!.identitySelector)!;
      const text = visibleItemText(item);
      if (
        identity.length > MAXIMUM_REPEATED_LIST_SAMPLE_CHARACTERS ||
        text.length > MAXIMUM_REPEATED_LIST_SAMPLE_CHARACTERS
      ) {
        truncated = true;
      }
      return {
        identity: identity.slice(0, MAXIMUM_REPEATED_LIST_SAMPLE_CHARACTERS),
        text: text.slice(0, MAXIMUM_REPEATED_LIST_SAMPLE_CHARACTERS),
      } satisfies RepeatedListItemPreview;
    });
    return { itemCount: items.length, items: previews, truncated } satisfies RepeatedListPreview;
  })();
  const text = normalizeText(matches.map((element) => document(element).text()).join(' '));
  return {
    matchCount: matches.length,
    repeatedList,
    repeatedListCandidates,
    text: text.slice(0, maxCharacters),
    truncated: text.length > maxCharacters,
  };
}

export async function previewHtmlTarget(
  input: Readonly<{ target: MonitorTargetConfiguration; url: string }>,
  options: HtmlPreviewOptions = {},
) {
  const maxBytes = options.maxBytes ?? DEFAULT_PREVIEW_MAX_BYTES;
  const maxCharacters = options.maxCharacters ?? DEFAULT_PREVIEW_MAX_CHARACTERS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_PREVIEW_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PREVIEW_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error('Preview request limits are invalid');
  }
  try {
    const response = await safeHttpFetch(input.url, {
      accept: 'text/html,application/xhtml+xml;q=0.9',
      maxBytes,
      maxRedirects,
      request: options.request as SafeHttpTransport | undefined,
      resolver: options.resolver as SafeHostResolver | undefined,
      timeoutMs,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new MonitorPreviewError('fetch_failed');
    }
    if (!isHtmlContentType(headerValue(response.headers, 'content-type'))) {
      throw new MonitorPreviewError('unsupported_response');
    }
    return extractHtmlTarget(response.body.toString('utf8'), input.target, maxCharacters);
  } catch (error) {
    if (error instanceof MonitorPreviewError) {
      throw error;
    }
    if (error instanceof SafeHttpError) {
      if (error.code === 'destination_not_allowed') {
        throw new MonitorPreviewError('destination_not_allowed');
      }
      if (error.code === 'response_too_large') {
        throw new MonitorPreviewError('response_too_large');
      }
      if (error.code === 'response_compressed') {
        throw new MonitorPreviewError('unsupported_response');
      }
    }
    throw new MonitorPreviewError('fetch_failed');
  }
}
