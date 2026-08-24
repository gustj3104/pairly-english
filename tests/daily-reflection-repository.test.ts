import { describe, expect, it } from 'vitest';
import { InMemoryDailyReflectionRepository } from './helpers/in-memory-daily-reflection-repository.js';

const STUDY_DATE = '2026-08-17';
const ARTICLE = { id: 'article-1', title: 'The Quiet Revolution', sourceUrl: null, summary: null };

function submission(participantKey: string, displayName: string, content = 'x'.repeat(60)) {
  return {
    studyDate: STUDY_DATE,
    article: ARTICLE,
    participantKey,
    displayName,
    content,
    submittedAt: new Date('2026-08-17T00:00:00.000Z'),
  };
}

/**
 * The "at most 2 participants per study day" rule is a real data-layer
 * invariant (see MAX_PARTICIPANTS_PER_DAY in
 * src/services/daily-reflections/daily-reflection-repository.ts and its
 * in-memory test double) independent of who can authenticate over HTTP.
 * Previously exercised via a 3rd arbitrary HTTP session in
 * tests/study-days.test.ts — moved here since the production participant
 * allow-list (hyunji/hyeonseo only) now makes a real 3rd authenticated
 * caller unreachable over HTTP, but the repository must still enforce the
 * limit defensively regardless.
 */
describe('DailyReflectionRepository — participant limit', () => {
  it('rejects a 3rd distinct participant for the same study day with participant_limit_reached', async () => {
    const repository = new InMemoryDailyReflectionRepository();

    const first = await repository.submitReflection(submission('participant-a', 'A'));
    expect(first).toMatchObject({ ok: true, alreadySubmitted: false });

    const second = await repository.submitReflection(submission('participant-b', 'B'));
    expect(second).toMatchObject({ ok: true, alreadySubmitted: false });

    const third = await repository.submitReflection(submission('participant-c', 'C'));
    expect(third).toEqual({ ok: false, reason: 'participant_limit_reached' });
  });

  it('the same participant updates the existing row without consuming a new slot', async () => {
    const repository = new InMemoryDailyReflectionRepository();

    const first = await repository.submitReflection(submission('participant-a', 'A'));
    expect(first).toMatchObject({ ok: true, alreadySubmitted: false });

    const resubmit = await repository.submitReflection(
      submission('participant-a', 'A', 'a different follow-up thought'),
    );
    expect(resubmit).toMatchObject({ ok: true, alreadySubmitted: true, updated: true });
    if (first.ok && resubmit.ok) {
      expect(resubmit.reflection.id).toBe(first.reflection.id);
      expect(resubmit.reflection.submittedAt).toEqual(first.reflection.submittedAt);
      expect(resubmit.reflection.content).toBe('a different follow-up thought');
    }

    const second = await repository.submitReflection(submission('participant-b', 'B'));
    expect(second).toMatchObject({ ok: true, alreadySubmitted: false });
  });
});
