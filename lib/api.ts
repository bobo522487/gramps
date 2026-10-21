import 'server-only';

import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { runWithRequestContext } from '@/lib/server/request-context';

type RouteHandler = (request: Request) => Promise<Response> | Response;
type RouteHandlerWithContext<C> = (
  request: Request,
  context: C
) => Promise<Response> | Response;

/**
 * Wraps a Route Handler with a request log scope, an `x-request-id` response
 * header, duration logging and a JSON 500 instead of leaking an HTML error.
 */
export function withApiLogging(
  name: string,
  handler: RouteHandler
): RouteHandler;
export function withApiLogging<C>(
  name: string,
  handler: RouteHandlerWithContext<C>
): RouteHandlerWithContext<C>;
export function withApiLogging(
  name: string,
  handler: (request: Request, context?: unknown) => Promise<Response> | Response
) {
  return async (request: Request, context?: unknown) => {
    const requestId = request.headers.get('x-request-id') ?? randomUUID();
    const startedAt = Date.now();
    const { pathname } = new URL(request.url);

    return runWithRequestContext(
      {
        request_id: requestId,
        method: request.method,
        path: pathname,
      },
      async () => {
        try {
          const response = await handler(request, context);
          response.headers.set('x-request-id', requestId);
          logger.info('api request completed', {
            route: name,
            status: response.status,
            duration_ms: Date.now() - startedAt,
          });
          return response;
        } catch (error) {
          logger.error('api request failed', error, {
            route: name,
            duration_ms: Date.now() - startedAt,
          });
          return Response.json(
            { error: 'Internal Server Error' },
            {
              status: 500,
              headers: { 'x-request-id': requestId },
            }
          );
        }
      }
    );
  };
}
