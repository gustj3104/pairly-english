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
      const word = normalizeLookupWord((request.query as { word?: unknown }).word);
      if (!word) return error(reply, request, 400, 'VALIDATION_ERROR');
      try {
        return await app.dictionaryService.lookup(word);
      } catch (caught) {
        if (!(caught instanceof DictionaryError)) throw caught;
        if (caught.retryAfter) reply.header('retry-after', caught.retryAfter);
        return error(reply, request, caught.statusCode, caught.code);
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
