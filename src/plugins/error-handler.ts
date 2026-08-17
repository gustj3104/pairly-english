import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Uniform error envelope. Never leaks stack traces or internal file
 * paths to the client — those go to the (redacted) server log only.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500;
    request.log.error({ err: error, requestId: request.id }, 'request failed');

    reply.code(statusCode).send({
      error: {
        message: statusCode >= 500 ? 'Internal Server Error' : error.message,
        code: error.code ?? 'INTERNAL_ERROR',
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send({
      error: {
        message: 'Not Found',
        code: 'NOT_FOUND',
        requestId: request.id,
      },
    });
  });
}
