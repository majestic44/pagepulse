import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

const DEFAULT_MAX_BYTES = 2 * 1_024 * 1_024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
export const pagePulseUserAgent = 'PagePulse/1.0 (+https://pagepulse.local)';

export type ResolvedAddress = Readonly<{
  address: string;
  family: 4 | 6;
}>;

export type HostResolver = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;

export type SafeHttpResponse = Readonly<{
  body: Buffer;
  headers: IncomingHttpHeaders;
  statusCode: number;
  url: URL;
}>;

export type SafeHttpTransport = (
  url: URL,
  options: Readonly<{
    accept: string;
    maxBytes: number;
    resolver: HostResolver;
    timeoutMs: number;
    userAgent: string;
  }>,
) => Promise<Omit<SafeHttpResponse, 'url'>>;

export type SafeHttpFetchOptions = Readonly<{
  accept?: string | undefined;
  maxBytes?: number | undefined;
  maxRedirects?: number | undefined;
  request?: SafeHttpTransport | undefined;
  resolver?: HostResolver | undefined;
  timeoutMs?: number | undefined;
  userAgent?: string | undefined;
}>;

export class SafeHttpError extends Error {
  constructor(
    readonly code:
      | 'destination_not_allowed'
      | 'fetch_failed'
      | 'response_compressed'
      | 'response_too_large'
      | 'too_many_redirects',
  ) {
    super(`Safe HTTP fetch failed: ${code}`);
    this.name = 'SafeHttpError';
  }
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
    return (
      numericAddress !== undefined &&
      !blockedIpv4Ranges.some(([network, prefixLength]) =>
        isIpv4Within(numericAddress, network, prefixLength),
      )
    );
  }
  if (family !== 6) {
    return false;
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
    throw new SafeHttpError('destination_not_allowed');
  }
  return addresses[0]!;
}

export const defaultHostResolver: HostResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );

export async function validatePublicHttpDestination(
  url: URL,
  resolver: HostResolver = defaultHostResolver,
) {
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new SafeHttpError('destination_not_allowed');
  }
  await resolvePublicAddress(url.hostname, resolver);
}

function createSafeLookup(resolver: HostResolver): LookupFunction {
  return (hostname, _options, callback) => {
    void resolvePublicAddress(hostname, resolver).then(
      ({ address, family }) => callback(null, address, family),
      () => callback(new Error('Destination is not allowed'), ''),
    );
  };
}

function headerValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function readResponseBody(response: import('node:http').IncomingMessage, maxBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    response.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxBytes) {
        response.destroy(new SafeHttpError('response_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    response.once('end', () => resolve(Buffer.concat(chunks)));
    response.once('error', reject);
    response.once('aborted', () => reject(new SafeHttpError('fetch_failed')));
  });
}

export const defaultSafeHttpTransport: SafeHttpTransport = async (url, options) =>
  new Promise((resolve, reject) => {
    const requestOptions: RequestOptions = {
      agent: false,
      headers: {
        Accept: options.accept,
        'Accept-Encoding': 'identity',
        'User-Agent': options.userAgent,
      },
      lookup: createSafeLookup(options.resolver),
      method: 'GET',
      timeout: options.timeoutMs,
    };
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      requestOptions,
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode >= 300 && statusCode < 400) {
          response.resume();
          resolve({ body: Buffer.alloc(0), headers: response.headers, statusCode });
          return;
        }
        const contentLength = Number(headerValue(response.headers, 'content-length'));
        if (Number.isSafeInteger(contentLength) && contentLength > options.maxBytes) {
          response.resume();
          reject(new SafeHttpError('response_too_large'));
          return;
        }
        const contentEncoding = headerValue(response.headers, 'content-encoding');
        if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
          response.resume();
          reject(new SafeHttpError('response_compressed'));
          return;
        }
        void readResponseBody(response, options.maxBytes).then(
          (body) => resolve({ body, headers: response.headers, statusCode }),
          reject,
        );
      },
    );
    request.once('timeout', () => request.destroy(new SafeHttpError('fetch_failed')));
    request.once('error', (error) =>
      reject(error instanceof SafeHttpError ? error : new SafeHttpError('fetch_failed')),
    );
    request.end();
  });

function isValidLimit(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

export async function safeHttpFetch(urlValue: string | URL, options: SafeHttpFetchOptions = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !isValidLimit(maxBytes) ||
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    !isValidLimit(timeoutMs)
  ) {
    throw new Error('Safe HTTP fetch limits are invalid');
  }
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new SafeHttpError('destination_not_allowed');
  }
  const resolver = options.resolver ?? defaultHostResolver;
  const request = options.request ?? defaultSafeHttpTransport;
  const accept = options.accept ?? '*/*';
  const userAgent = options.userAgent ?? pagePulseUserAgent;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await validatePublicHttpDestination(url, resolver);
    const response = await request(url, { accept, maxBytes, resolver, timeoutMs, userAgent });
    if (response.statusCode < 300 || response.statusCode >= 400) {
      return { ...response, url };
    }
    const location = headerValue(response.headers, 'location');
    if (!location) {
      throw new SafeHttpError('fetch_failed');
    }
    if (redirectCount === maxRedirects) {
      throw new SafeHttpError('too_many_redirects');
    }
    try {
      url = new URL(location, url);
    } catch {
      throw new SafeHttpError('fetch_failed');
    }
  }
  throw new SafeHttpError('too_many_redirects');
}
