import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CreditService } from '../src/services/credits/credit-service.js';
import { InMemoryCreditRepository } from './helpers/in-memory-credit-repository.js';
import { InMemoryDailyReflectionRepository } from './helpers/in-memory-daily-reflection-repository.js';
import { InMemoryComparisonRepository } from './helpers/in-memory-comparison-repository.js';
import { DailyReflectionService } from '../src/services/daily-reflections/daily-reflection-service.js';
import { ComparisonService } from '../src/services/daily-reflections/comparison-service.js';
import { DictionaryService } from '../src/services/dictionary/service.js';
import type {
  DictionaryRepository,
  SavedVocabularyRow,
} from '../src/services/dictionary/repository.js';
import type { DictionaryEntry } from '../src/services/dictionary/types.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';

const SESSION_SECRET = 'test-study-day-progress-session-secret-at-least-32-chars';
const FIXED_NOW = new Date('2026-08-18T03:00:00.000Z');
const STUDY_DATE = '2026-08-17';

const VALID_REFLECTION =
  'This reflection is deliberately written to be well over fifty non-blank characters long so it passes validation.';

function sessionCookie(name: string) {
  const token = signSession({ name }, SESSION_SECRET, 2592000);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    article: { id: 'article-1', title: 'The Quiet Revolution', sourceUrl: null, summary: null },
    reflection: VALID_REFLECTION,
    ...overrides,
  };
}

/** Per-participant, multi-row fake — unlike dictionary.test.ts's MemoryRepository (which
 * ignores participantKey and keeps only one row total), this actually scopes listVocabulary
 * so mine/partner word lists in the progress response can be asserted independently. */
class InMemoryMultiParticipantDictionaryRepository implements DictionaryRepository {
  rows: SavedVocabularyRow[] = [];
  async getOrRefresh(): Promise<never> {
    throw new Error('not used by these tests');
  }
  async findEntry(): Promise<DictionaryEntry | null> {
    return null;
  }
  async findArticle() {
    return null;
  }
  async findSaved(participantKey: string, normalizedWord: string) {
    return (
      this.rows.find(
        (row) =>
          row.item.participantKey === participantKey && row.item.normalizedWord === normalizedWord,
      ) ?? null
    );
  }
  async saveVocabulary(): Promise<never> {
    throw new Error('not used by these tests');
  }
  async listVocabulary(participantKey: string) {
    return this.rows.filter((row) => row.item.participantKey === participantKey);
  }
  async deleteVocabulary() {
    return false;
  }
  addWord(participantKey: string, word: string): void {
    this.rows.push({
      item: {
        id: `${participantKey}-${word}`,
        participantKey,
        word,
        normalizedWord: word,
        senseId: 'a'.repeat(64),
        pronunciation: null,
        audioUrl: null,
        partOfSpeech: 'noun',
        definition: `Definition of ${word}`,
        example: null,
        koreanTranslations: [],
        sourceUrl: 'https://en.wiktionary.org/wiki/' + word,
        attribution: {
          provider: 'FreeDictionaryAPI.com',
          name: 'Wiktionary',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        },
        articleId: null,
        contextSentence: null,
        savedAt: FIXED_NOW,
      },
      articleTitle: null,
    });
  }
}

function buildTestApp() {
  const creditService = new CreditService(new InMemoryCreditRepository(), 5000);
  const dailyReflectionRepository = new InMemoryDailyReflectionRepository();
  const dailyReflectionService = new DailyReflectionService(dailyReflectionRepository);
  const comparisonService = new ComparisonService(
    new InMemoryComparisonRepository(dailyReflectionRepository),
  );
  const dictionaryRepository = new InMemoryMultiParticipantDictionaryRepository();
  const dictionaryService = new DictionaryService(dictionaryRepository);
  const app = buildApp({
    checkDatabaseConnection: async () => true,
    studyDaysRoutesOptions: {
      sessionSecret: SESSION_SECRET,
      maxFutureDays: 1,
      now: () => FIXED_NOW,
    },
    creditService,
    dailyReflectionService,
    comparisonService,
    dictionaryService,
  });
  return { app, dictionaryRepository };
}

async function submit(
  app: ReturnType<typeof buildApp>,
  name: string,
  body: Record<string, unknown> = validBody(),
) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
    headers: { cookie: sessionCookie(name) },
    payload: body,
  });
}

function getProgress(app: ReturnType<typeof buildApp>, name: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/study-days/${STUDY_DATE}/progress`,
    headers: { cookie: sessionCookie(name) },
  });
}

describe('GET /api/v1/study-days/:date/progress — auth', () => {
  it('returns 401 without a session cookie', async () => {
    const { app } = buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/progress`,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /api/v1/study-days/:date/progress', () => {
  it('returns empty/not-submitted state for both sides before anyone submits', async () => {
    const { app } = buildTestApp();
    const response = await getProgress(app, 'hyunji');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      studyDate: STUDY_DATE,
      mine: { displayName: null, reflection: { submitted: false, content: null }, vocabulary: [] },
      partner: {
        displayName: null,
        reflection: { submitted: false, content: null },
        vocabulary: [],
      },
      readyToCompare: false,
      discussion: { completed: false, completedAt: null },
    });
    await app.close();
  });

  it('exposes the real reflection content and correctly-scoped vocabulary for both mine and partner, symmetric from either side', async () => {
    const { app, dictionaryRepository } = buildTestApp();
    dictionaryRepository.addWord('hyunji', 'serendipity');
    dictionaryRepository.addWord('hyeonseo', 'ubiquitous');
    dictionaryRepository.addWord('hyeonseo', 'ephemeral');

    expect((await submit(app, 'hyunji')).statusCode).toBe(200);
    expect(
      (
        await submit(
          app,
          'hyeonseo',
          validBody({ reflection: `${VALID_REFLECTION} Partner's own take.` }),
        )
      ).statusCode,
    ).toBe(200);

    const fromHyunji = (await getProgress(app, 'hyunji')).json();
    expect(fromHyunji.mine).toEqual({
      displayName: 'hyunji',
      reflection: { submitted: true, content: VALID_REFLECTION },
      vocabulary: [expect.objectContaining({ word: 'serendipity' })],
    });
    expect(fromHyunji.partner).toEqual({
      displayName: 'hyeonseo',
      reflection: { submitted: true, content: `${VALID_REFLECTION} Partner's own take.` },
      vocabulary: [
        expect.objectContaining({ word: 'ubiquitous' }),
        expect.objectContaining({ word: 'ephemeral' }),
      ],
    });
    expect(fromHyunji.readyToCompare).toBe(true);

    // Symmetric from the other participant's session — mine/partner swap, data never mixes.
    const fromHyeonseo = (await getProgress(app, 'hyeonseo')).json();
    expect(fromHyeonseo.mine.displayName).toBe('hyeonseo');
    expect(fromHyeonseo.mine.vocabulary).toHaveLength(2);
    expect(fromHyeonseo.partner.displayName).toBe('hyunji');
    expect(fromHyeonseo.partner.vocabulary).toEqual([
      expect.objectContaining({ word: 'serendipity' }),
    ]);

    await app.close();
  });

  it("exposes the partner's reflection content even before the caller has submitted their own (product decision: always visible, not gated on mutual submission)", async () => {
    const { app } = buildTestApp();
    expect((await submit(app, 'hyeonseo')).statusCode).toBe(200);

    const response = await getProgress(app, 'hyunji');
    const body = response.json();
    expect(body.mine).toEqual({
      displayName: null,
      reflection: { submitted: false, content: null },
      vocabulary: [],
    });
    expect(body.partner.reflection).toEqual({ submitted: true, content: VALID_REFLECTION });
    await app.close();
  });

  it('never lets the caller fetch a third identity’s data — mine/partner are always resolved from the two fixed allowed participants only', async () => {
    const { app } = buildTestApp();
    expect((await submit(app, 'hyunji')).statusCode).toBe(200);
    expect((await submit(app, 'hyeonseo')).statusCode).toBe(200);

    const response = await getProgress(app, 'hyunji');
    const body = response.json();
    expect([body.mine.displayName, body.partner.displayName].sort()).toEqual([
      'hyeonseo',
      'hyunji',
    ]);
    await app.close();
  });
});

function putDiscussion(app: ReturnType<typeof buildApp>, name: string) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/study-days/${STUDY_DATE}/discussion`,
    headers: { cookie: sessionCookie(name) },
  });
}

describe('PUT /api/v1/study-days/:date/discussion — auth', () => {
  it('returns 401 without a session cookie', async () => {
    const { app } = buildTestApp();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/discussion`,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('PUT /api/v1/study-days/:date/discussion', () => {
  it('returns 409 STUDY_DAY_NOT_FOUND when no reflection has been submitted for this date yet', async () => {
    const { app } = buildTestApp();
    const response = await putDiscussion(app, 'hyunji');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('STUDY_DAY_NOT_FOUND');
    await app.close();
  });

  it('marks the shared discussion complete, and GET /progress reflects it identically for both participants', async () => {
    const { app } = buildTestApp();
    expect((await submit(app, 'hyunji')).statusCode).toBe(200);

    const putResponse = await putDiscussion(app, 'hyunji');
    expect(putResponse.statusCode).toBe(200);
    const putBody = putResponse.json();
    expect(putBody).toEqual({
      studyDate: STUDY_DATE,
      discussionCompleted: true,
      completedAt: expect.any(String),
    });

    const fromHyunji = (await getProgress(app, 'hyunji')).json();
    const fromHyeonseo = (await getProgress(app, 'hyeonseo')).json();
    expect(fromHyunji.discussion).toEqual({ completed: true, completedAt: putBody.completedAt });
    expect(fromHyeonseo.discussion).toEqual({ completed: true, completedAt: putBody.completedAt });

    await app.close();
  });

  it('is idempotent — the second participant to call it never overwrites the first completedAt', async () => {
    const { app } = buildTestApp();
    expect((await submit(app, 'hyunji')).statusCode).toBe(200);

    const first = await putDiscussion(app, 'hyunji');
    const firstCompletedAt = first.json().completedAt;

    const second = await putDiscussion(app, 'hyeonseo');
    expect(second.statusCode).toBe(200);
    expect(second.json().completedAt).toBe(firstCompletedAt);

    await app.close();
  });
});
