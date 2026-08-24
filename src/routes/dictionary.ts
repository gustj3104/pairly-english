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
 * Every DictionaryError code that means "the Mindlogic AI lookup itself failed" (upstream
 * error, invalid/unparsable structured JSON, or an automatic-retry cooldown still in effect) —
 * collapsed to one stable public code so the client never has to special-case internal detail.
 * DICTIONARY_CREDIT_LIMIT is deliberately excluded: its own 402 status already gets a distinct
 * "credit limit exceeded" message on the client (see client.ts's status===402 branch).
 */
const DICTIONARY_PROVIDER_FAILURE_CODES = new Set([
  'DICTIONARY_AI_UNAVAILABLE',
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
      const query = request.query as { word?: unknown; retry?: unknown };
      const word = normalizeLookupWord(query.word);
      if (!word) return error(reply, request, 400, 'VALIDATION_ERROR');
      // User-initiated only: set by the dictionary panel's "다시 시도" (Retry) action after a
      // failed lookup, never sent automatically by a plain lookup.
      const forceRetry = query.retry === 'true';
      try {
        return await app.dictionaryService.lookup(word, { forceRetry });
      } catch (caught) {
        if (!(caught instanceof DictionaryError)) throw caught;
        // Safe fields only: no request/response body, no query word. The internal
        // DictionaryError code is enough to tell failure stages apart in logs without it.
        request.log.warn(
          {
            feature: 'dictionary_lookup',
            failureStage: 'ai_lookup',
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
    const senseId = (request.query as { senseId?: unknown }).senseId;
    if (
      !word ||
      (senseId !== undefined && (typeof senseId !== 'string' || !/^[a-f0-9]{64}$/.test(senseId)))
    ) {
      return error(reply, request, 400, 'VALIDATION_ERROR');
    }
    await app.dictionaryService.delete(participant(request), word, senseId);
    reply.code(204).send();
  });
}
