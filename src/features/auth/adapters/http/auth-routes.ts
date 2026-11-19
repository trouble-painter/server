import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ReissueToken, SignInAnonymous } from '../../application/index.js';

const ReissueBody = z.object({ refreshToken: z.string().min(1) });

export function registerAuthRoutes(
  http: FastifyInstance,
  deps: { signInAnonymous: SignInAnonymous; reissueToken: ReissueToken },
): void {
  http.post('/api/v1/auth/anonymous-signin', async () => {
    return deps.signInAnonymous.execute();
  });

  /** The app signs in again on any 4xx, so a rejected token must be 4xx and server faults must not. */
  http.post('/api/v1/auth/reissue', async (request, reply) => {
    const body = ReissueBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send();
    }
    const tokens = await deps.reissueToken.execute(body.data.refreshToken);
    if (tokens === null) {
      return reply.code(401).send();
    }
    return tokens;
  });
}
