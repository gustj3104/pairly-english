import { describe, expect, it } from 'vitest';
import { validateSourceUrl } from './source-url.js';

describe('validateSourceUrl', () => {
  it.each([
    'https://www.reuters.com/world/story',
    'https://news.un.org/en/story',
    'https://climate.nasa.gov/news',
  ])('allows approved source %s', (url) => expect(validateSourceUrl(url)).not.toBeNull());
  it.each([
    'https://reuters.com.evil.test/x',
    'http://reuters.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://user:pass@reuters.com/x',
    'https://reuters.com:8443/x',
    'https://reuters.com/x#fragment',
  ])('rejects unsafe source %s', (url) => expect(validateSourceUrl(url)).toBeNull());
});
