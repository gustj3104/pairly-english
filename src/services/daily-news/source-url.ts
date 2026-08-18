import { isIP } from 'node:net';

const EXACT_HOSTS = new Set([
  'reuters.com',
  'www.reuters.com',
  'apnews.com',
  'www.apnews.com',
  'bbc.com',
  'www.bbc.com',
  'bbc.co.uk',
  'www.bbc.co.uk',
  'npr.org',
  'www.npr.org',
  'theguardian.com',
  'www.theguardian.com',
  'nasa.gov',
  'www.nasa.gov',
  'who.int',
  'www.who.int',
  'un.org',
  'www.un.org',
  'news.un.org',
]);
const OFFICIAL_SUFFIXES = ['.gov', '.gov.uk', '.edu', '.ac.uk'];

export function validateSourceUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || isIP(host) !== 0) return null;
  const allowed =
    EXACT_HOSTS.has(host) || OFFICIAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
  return allowed ? url : null;
}

export const DAILY_NEWS_SOURCE_ALLOWLIST = Object.freeze([...EXACT_HOSTS, ...OFFICIAL_SUFFIXES]);
