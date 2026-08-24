import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createSessionGate } from '../plugins/session-gate.js';
import { normalizeParticipantKey } from '../services/daily-reflections/participant-key.js';
import { DictionaryError, VocabularyError } from '../services/dictionary/service.js';
import { normalizeLookupWord } from '../services/dictionary/validation.js';

const saveSchema = z
  .object({
    senseId: z.string().regex(/^[a-f0-9]{64}$/),
    articleId: z.string().uuid().optional(),
    contextSentence: z.string().optional(),
  })
  .strict();

function error(reply: FastifyReply, request: FastifyRequest, status: number, code: string) {
  reply.code(status);
  return { error: { message: code, code, requestId: request.id } };
}

/**
 * Every DictionaryError code that means "the FreeDictionaryAPI provider itself failed"
 * (rate limited, timed out, unreachable, or returned something we couldn't validate) —
 * collapsed to one stable public code so the client never has to special-case internal
 * detail, and never given the raw provider URL or response body. WORD_NOT_FOUND is a real
 * answer ("no such word"), not a provider failure, so it keeps its own distinct code/status.
 */
const DICTIONARY_PROVIDER_FAILURE_CODES = new Set([
  'DICTIONARY_RATE_LIMITED',
  'DICTIONARY_TIMEOUT',
  'DICTIONARY_UPSTREAM_ERROR',
  'DICTIONARY_INVALID_RESPONSE',
]);

function participant(request: FastifyRequest): string {
  return normalizeParticipantKey(request.session!.name);
}

export async function dictionaryRoutes(
  app: FastifyInstance,
  options: { sessionSecret: string },
): Promise<void> {
  const sessionGate = createSessionGate(options.sessionSecret);

  app.get(
    '/dictionary/lookup',
    {
      preHandler: sessionGate,
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const query = request.query as { word?: unknown; retryTranslation?: unknown };
      const word = normalizeLookupWord(query.word);
      if (!word) return error(reply, request, 400, 'VALIDATION_ERROR');
      // User-initiated only: set by the dictionary panel's "다시 시도" (Retry) action after
      // koreanTranslationStatus === 'unavailable', never sent automatically by a plain lookup.
      const forceTranslationRetry = query.retryTranslation === 'true';
      try {
        return await app.dictionaryService.lookup(word, { forceTranslationRetry });
      } catch (caught) {
        if (!(caught instanceof DictionaryError)) throw caught;
        if (caught.retryAfter) reply.header('retry-after', caught.retryAfter);
        // Safe fields only: no provider URL, no response body, no query word. The internal
        // DictionaryError code is enough to tell failure stages apart in logs without it.
        request.log.warn(
          {
            feature: 'dictionary_lookup',
            failureStage: 'english_provider',
            provider: caught.provider,
            internalErrorCode: caught.code,
            httpStatus: caught.statusCode,
          },
          'dictionary lookup failed',
        );
        const publicCode = DICTIONARY_PROVIDER_FAILURE_CODES.has(caught.code)
          ? 'DICTIONARY_PROVIDER_ERROR'
          : caught.code;
        return error(reply, request, caught.statusCode, publicCode);
      }
    },
  );

  app.get('/vocabulary', { preHandler: sessionGate }, async (request) => {
    return app.dictionaryService.list(participant(request));
  });

  app.put('/vocabulary/:normalizedWord', { preHandler: sessionGate }, async (request, reply) => {
    const word = normalizeLookupWord(
      (request.params as { normalizedWord?: unknown }).normalizedWord,
    );
    const body = saveSchema.safeParse(request.body);
    if (!word || !body.success) return error(reply, request, 400, 'VALIDATION_ERROR');
    try {
      return await app.dictionaryService.save(participant(request), word, body.data);
    } catch (caught) {
      if (!(caught instanceof VocabularyError)) throw caught;
      return error(reply, request, caught.statusCode, caught.code);
    }
  });

  app.delete('/vocabulary/:normalizedWord', { preHandler: sessionGate }, async (request, reply) => {
    const word = normalizeLookupWord(
      (request.params as { normalizedWord?: unknown }).normalizedWord,
    );
    if (!word) return error(reply, request, 400, 'VALIDATION_ERROR');
    await app.dictionaryService.delete(participant(request), word);
    reply.code(204).send();
  });
}
