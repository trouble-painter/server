import type { FastifyInstance } from 'fastify';
import { TokenType, type TokenService } from '../../../auth/application/index.js';
import type { GetPlayingRoom } from '../../application/usecases/get-playing-room.js';

/** The app sends a lowercase `bearer`, so the scheme is matched case-insensitively. */
const BEARER = /^bearer\s+(\S+)$/i;

export function registerPlayingRoomRoute(
  http: FastifyInstance,
  deps: { tokens: TokenService; getPlayingRoom: GetPlayingRoom },
): void {
  http.get('/api/v1/playing-room', async (request, reply) => {
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    const userId = token ? await deps.tokens.verify(token, TokenType.Access) : null;
    if (userId === null) {
      return reply.code(401).send();
    }
    return { roomId: deps.getPlayingRoom.execute(userId) };
  });
}
