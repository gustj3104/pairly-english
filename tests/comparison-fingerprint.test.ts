import { describe, expect, it } from 'vitest';
import { computeInputFingerprint } from '../src/services/daily-reflections/comparison-fingerprint.js';

describe('computeInputFingerprint', () => {
  it('produces the identical fingerprint regardless of the reflections array order', () => {
    const article = 'article-1';
    const alex = { participantKey: 'alex', content: 'Alex thinks the article is compelling.' };
    const sam = { participantKey: 'sam', content: 'Sam has a different take entirely.' };

    const forward = computeInputFingerprint(article, [alex, sam]);
    const reversed = computeInputFingerprint(article, [sam, alex]);

    expect(forward).toBe(reversed);
  });

  it('is a 64-character lowercase hex SHA-256 digest', () => {
    const fingerprint = computeInputFingerprint('article-1', [
      { participantKey: 'alex', content: 'A reflection.' },
      { participantKey: 'sam', content: 'A different reflection.' },
    ]);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the article id changes, all else equal', () => {
    const reflections = [
      { participantKey: 'alex', content: 'A reflection.' },
      { participantKey: 'sam', content: 'A different reflection.' },
    ];
    const a = computeInputFingerprint('article-1', reflections);
    const b = computeInputFingerprint('article-2', reflections);
    expect(a).not.toBe(b);
  });

  it('changes when a reflection body changes, all else equal', () => {
    const a = computeInputFingerprint('article-1', [
      { participantKey: 'alex', content: 'A reflection.' },
      { participantKey: 'sam', content: 'A different reflection.' },
    ]);
    const b = computeInputFingerprint('article-1', [
      { participantKey: 'alex', content: 'A reflection, but edited.' },
      { participantKey: 'sam', content: 'A different reflection.' },
    ]);
    expect(a).not.toBe(b);
  });

  it('never contains the raw reflection content or participant key (irreversible by construction)', () => {
    const fingerprint = computeInputFingerprint('article-1', [
      { participantKey: 'unmistakable-participant-key', content: 'unmistakable reflection body' },
      { participantKey: 'sam', content: 'A different reflection.' },
    ]);
    expect(fingerprint).not.toContain('unmistakable-participant-key');
    expect(fingerprint).not.toContain('unmistakable reflection body');
  });
});
