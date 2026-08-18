import { createHash } from 'node:crypto';

export interface FingerprintReflectionInput {
  participantKey: string;
  content: string;
}

/**
 * Deterministic, irreversible (SHA-256) fingerprint of "the exact inputs
 * that would be sent to Mindlogic for this study day": the article id plus
 * both reflections' (participantKey, content) pairs. Sorting by
 * participantKey before hashing guarantees the same fingerprint regardless
 * of which reflection happened to be read/inserted first — DB read order
 * for two rows is not guaranteed, so this is not just cosmetic.
 *
 * Used by src/services/daily-reflections/comparison-repository.ts to
 * detect whether a cached study_day_comparisons result still corresponds
 * to the current inputs (it always should, since reflections are
 * immutable once submitted — see submitReflection's "content is never
 * overwritten" — but the check is defense in depth, not load-bearing).
 *
 * Deliberately a pure function with no I/O so the "order doesn't matter"
 * property is fast and independently unit-testable.
 */
export function computeInputFingerprint(
  articleId: string,
  reflections: FingerprintReflectionInput[],
): string {
  const sorted = [...reflections].sort((a, b) => {
    if (a.participantKey < b.participantKey) return -1;
    if (a.participantKey > b.participantKey) return 1;
    return 0;
  });

  const canonical = JSON.stringify({
    articleId,
    reflections: sorted.map((r) => ({ participantKey: r.participantKey, content: r.content })),
  });

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
