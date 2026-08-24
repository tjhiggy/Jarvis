import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

export interface RssNotification {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
}

interface RssLookupAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

type RssResolver = (hostname: string) => Promise<RssLookupAddress[]>;

const blockedRssIpv4Addresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blockedRssIpv4Addresses.addSubnet(network, prefix, 'ipv4');
const blockedRssIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blockedRssIpv6Addresses.addSubnet(network, prefix, 'ipv6');

const isPublicRssAddress = (address: string, family: 4 | 6): boolean =>
  isIP(address) === family &&
  !(family === 4
    ? blockedRssIpv4Addresses.check(address, 'ipv4')
    : blockedRssIpv6Addresses.check(address, 'ipv6'));

export const createPublicRssLookup =
  (
    resolve: RssResolver = async (hostname) =>
      (await dnsLookup(hostname, {
        all: true,
        verbatim: true,
      })) as RssLookupAddress[],
  ): LookupFunction =>
  (hostname, options, callback) => {
    void resolve(hostname)
      .then((addresses) => {
        if (
          addresses.length === 0 ||
          addresses.some(
            ({ address, family }) => !isPublicRssAddress(address, family),
          )
        ) {
          callback(
            new Error('RSS host did not resolve to a public address.'),
            '',
          );
          return;
        }
        const matching =
          options.family === 4 || options.family === 6
            ? addresses.filter(({ family }) => family === options.family)
            : addresses;
        if (matching.length === 0) {
          callback(new Error('RSS host has no usable public address.'), '');
          return;
        }
        if (options.all) callback(null, matching);
        else callback(null, matching[0]!.address, matching[0]!.family);
      })
      .catch((error: unknown) =>
        callback(
          error instanceof Error ? error : new Error('RSS DNS lookup failed.'),
          '',
        ),
      );
  };

export const createSafeRssFetcher = (): typeof fetch => {
  const dispatcher = new Agent({
    connect: { lookup: createPublicRssLookup() },
  });
  return (async (input, init) =>
    (await undiciFetch(input as string | URL, {
      ...(init as object),
      dispatcher,
      redirect: 'error',
    })) as unknown as Response) as typeof fetch;
};

const privateHost = (hostname: string): boolean => {
  const value = hostname.toLowerCase();
  return (
    value === 'localhost' ||
    value === '::1' ||
    value === '0.0.0.0' ||
    value.startsWith('127.') ||
    value.startsWith('10.') ||
    value.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value)
  );
};

export const isAllowedRssUrl = (
  value: string,
  allowedHosts: readonly string[],
): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      !privateHost(url.hostname) &&
      allowedHosts.some(
        (host) => host.toLowerCase() === url.hostname.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
};

const decode = (value: string): string =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

const canonicalUrl = (value: string): string => {
  try {
    return new URL(decode(value)).toString();
  } catch {
    return '';
  }
};

export class RssNotificationClient {
  constructor(
    private readonly fetcher: typeof fetch = createSafeRssFetcher(),
    private readonly timeoutMs = 8_000,
    private readonly allowedHosts: readonly string[] = [],
  ) {}

  async fetch(
    feedUrl: string,
    maximumItems = 20,
  ): Promise<readonly RssNotification[]> {
    if (!isAllowedRssUrl(feedUrl, this.allowedHosts))
      throw new Error('RSS feed is not allowlisted.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(feedUrl, {
        headers: { accept: 'application/rss+xml, application/xml, text/xml' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('RSS feed unavailable.');
      const xml = (await response.text()).slice(0, 512_000);
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
        .slice(0, Math.min(Math.max(0, maximumItems), 20))
        .map((match) => {
          const item = match[1] ?? '';
          return {
            id: decode(
              item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ??
                item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ??
                '',
            ),
            title: decode(
              item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
                'RSS update',
            ),
            url: canonicalUrl(
              item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? '',
            ),
            publishedAt: decode(
              item.match(
                /<(?:pubDate|published)[^>]*>([\s\S]*?)<\/(?:pubDate|published)>/i,
              )?.[1] ?? '',
            ),
          };
        })
        .filter((item) => item.id !== '' && item.url !== '');
    } finally {
      clearTimeout(timer);
    }
  }
}
