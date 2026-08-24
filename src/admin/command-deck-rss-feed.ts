import { createHash } from 'node:crypto';

export function commandDeckRssFeedId(url: string): string {
  return `rss_${createHash('sha256').update(url).digest('hex').slice(0, 32)}`;
}
