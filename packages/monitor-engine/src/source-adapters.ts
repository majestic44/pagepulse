import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';

import {
  SafeHttpError,
  safeHttpFetch,
  type HostResolver,
  type SafeHttpFetchOptions,
  type SafeHttpTransport,
} from './safe-http.js';

const MAXIMUM_FEED_ITEMS = 1_000;
const MAXIMUM_FEED_FIELD_CHARACTERS = 16_384;
const MAXIMUM_JSON_DEPTH = 64;
const MAXIMUM_JSON_NODES = 100_000;

export type MonitorSourceType = 'html' | 'json' | 'rss_atom';

export type JsonSourceValue =
  | boolean
  | null
  | number
  | string
  | ReadonlyArray<JsonSourceValue>
  | Readonly<{ [key: string]: JsonSourceValue }>;

export type HtmlSource = Readonly<{
  document: CheerioAPI;
  sourceType: 'html';
}>;

export type JsonSource = Readonly<{
  sourceType: 'json';
  value: JsonSourceValue;
}>;

export type FeedSourceItem = Readonly<{
  content: string | null;
  id: string | null;
  link: string | null;
  publishedAt: string | null;
  title: string | null;
}>;

export type RssAtomSource = Readonly<{
  items: ReadonlyArray<FeedSourceItem>;
  sourceType: 'rss_atom';
}>;

export type ParsedMonitorSource = HtmlSource | JsonSource | RssAtomSource;

export type FetchMonitorSourceOptions = Readonly<{
  maxBytes?: number | undefined;
  maxRedirects?: number | undefined;
  request?: SafeHttpTransport | undefined;
  resolver?: HostResolver | undefined;
  sourceType: MonitorSourceType;
  timeoutMs?: number | undefined;
}>;

export class SourceAdapterError extends Error {
  constructor(
    readonly code:
      'fetch_failed' | 'invalid_source' | 'source_too_complex' | 'unsupported_response',
  ) {
    super(`Monitor source could not be processed: ${code}`);
    this.name = 'SourceAdapterError';
  }
}

function headerValue(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
) {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function mediaType(value: string | undefined) {
  return value?.split(';', 1)[0]?.trim().toLowerCase();
}

function hasMediaType(value: string | undefined, allowed: ReadonlyArray<string>) {
  const type = mediaType(value);
  return (
    type !== undefined &&
    allowed.some((candidate) => type === candidate || type.endsWith(candidate))
  );
}

function boundedText(value: string | undefined) {
  const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
  return normalized.length === 0 ? null : normalized.slice(0, MAXIMUM_FEED_FIELD_CHARACTERS);
}

function selectAtomLink(document: CheerioAPI, element: Parameters<CheerioAPI>[0]) {
  const links = document(element).find('link').toArray();
  const preferred = links.find((link) => {
    const relation = document(link).attr('rel');
    return relation === undefined || relation.toLowerCase() === 'alternate';
  });
  return document(preferred ?? links[0]).attr('href');
}

function feedItem(
  document: CheerioAPI,
  element: Parameters<CheerioAPI>[0],
  source: 'atom' | 'rss',
) {
  const item = document(element);
  const firstText = (...tagNames: ReadonlyArray<string>) => {
    const children = item.children().toArray();
    for (const tagName of tagNames) {
      const child = children.find(
        (candidate) => candidate.tagName?.toLowerCase() === tagName.toLowerCase(),
      );
      const value = boundedText(child === undefined ? undefined : document(child).text());
      if (value !== null) {
        return value;
      }
    }
    return null;
  };
  return {
    content: firstText('content', 'content:encoded', 'description', 'summary'),
    id: firstText('id', 'guid'),
    link:
      source === 'atom'
        ? boundedText(selectAtomLink(document, element))
        : boundedText(item.children('link').first().text()),
    publishedAt: firstText('published', 'updated', 'pubDate', 'dc:date'),
    title: firstText('title'),
  } satisfies FeedSourceItem;
}

function isJsonValue(value: unknown): value is JsonSourceValue {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null)
  );
}

function validateJsonValue(value: JsonSourceValue) {
  const pending: Array<Readonly<{ depth: number; value: JsonSourceValue }>> = [{ depth: 0, value }];
  let nodeCount = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > MAXIMUM_JSON_NODES || node.depth > MAXIMUM_JSON_DEPTH) {
      throw new SourceAdapterError('source_too_complex');
    }
    if (Array.isArray(node.value)) {
      for (const child of node.value) {
        if (!isJsonValue(child)) {
          throw new SourceAdapterError('invalid_source');
        }
        pending.push({ depth: node.depth + 1, value: child });
      }
      continue;
    }
    if (typeof node.value === 'object' && node.value !== null) {
      for (const child of Object.values(node.value)) {
        if (!isJsonValue(child)) {
          throw new SourceAdapterError('invalid_source');
        }
        pending.push({ depth: node.depth + 1, value: child });
      }
    }
  }
}

export function parseHtmlSource(body: string): HtmlSource {
  if (body.length === 0) {
    throw new SourceAdapterError('invalid_source');
  }
  return { document: load(body), sourceType: 'html' };
}

export function parseJsonSource(body: string): JsonSource {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new SourceAdapterError('invalid_source');
  }
  if (!isJsonValue(value)) {
    throw new SourceAdapterError('invalid_source');
  }
  validateJsonValue(value);
  return { sourceType: 'json', value };
}

export function parseRssAtomSource(body: string): RssAtomSource {
  if (body.trim().length === 0) {
    throw new SourceAdapterError('invalid_source');
  }
  const document = load(body, { xmlMode: true });
  const root = document.root().children().first();
  const rootName = root[0]?.tagName?.toLowerCase();
  if (rootName === 'rss') {
    return {
      items: document('channel > item')
        .toArray()
        .slice(0, MAXIMUM_FEED_ITEMS)
        .map((element) => feedItem(document, element, 'rss')),
      sourceType: 'rss_atom',
    };
  }
  if (rootName === 'feed') {
    return {
      items: document('feed > entry')
        .toArray()
        .slice(0, MAXIMUM_FEED_ITEMS)
        .map((element) => feedItem(document, element, 'atom')),
      sourceType: 'rss_atom',
    };
  }
  throw new SourceAdapterError('invalid_source');
}

function acceptHeader(sourceType: MonitorSourceType) {
  if (sourceType === 'html') {
    return 'text/html,application/xhtml+xml;q=0.9';
  }
  if (sourceType === 'json') {
    return 'application/json,application/*+json;q=0.9,text/json;q=0.8';
  }
  return 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9';
}

function hasExpectedContentType(sourceType: MonitorSourceType, contentType: string | undefined) {
  if (sourceType === 'html') {
    return hasMediaType(contentType, ['text/html', 'application/xhtml+xml']);
  }
  if (sourceType === 'json') {
    return hasMediaType(contentType, ['application/json', '+json', 'text/json']);
  }
  return hasMediaType(contentType, [
    'application/rss+xml',
    'application/atom+xml',
    'application/xml',
    'text/xml',
    '+xml',
  ]);
}

export async function fetchMonitorSource(url: string, options: FetchMonitorSourceOptions) {
  const fetchOptions: SafeHttpFetchOptions = {
    accept: acceptHeader(options.sourceType),
    maxBytes: options.maxBytes,
    maxRedirects: options.maxRedirects,
    request: options.request,
    resolver: options.resolver,
    timeoutMs: options.timeoutMs,
  };
  try {
    const response = await safeHttpFetch(url, fetchOptions);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new SourceAdapterError('fetch_failed');
    }
    if (
      !hasExpectedContentType(options.sourceType, headerValue(response.headers, 'content-type'))
    ) {
      throw new SourceAdapterError('unsupported_response');
    }
    const body = response.body.toString('utf8');
    if (options.sourceType === 'html') {
      return parseHtmlSource(body);
    }
    if (options.sourceType === 'json') {
      return parseJsonSource(body);
    }
    return parseRssAtomSource(body);
  } catch (error) {
    if (error instanceof SourceAdapterError) {
      throw error;
    }
    if (error instanceof SafeHttpError) {
      throw new SourceAdapterError('fetch_failed');
    }
    throw new SourceAdapterError('fetch_failed');
  }
}
