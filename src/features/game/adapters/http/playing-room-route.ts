import type { FastifyInstance } from 'fastify';
import { parseBearer } from '../../../../shared/adapters/http/bearer.js';
import { TokenType, type TokenService } from '../../../auth/application/index.js';
import type { GetPlayingRoom } from '../../application/usecases/get-playing-room.js';

export function registerPlayingRoomRoute(
  http: FastifyInstance,
  deps: { tokens: TokenService; getPlayingRoom: GetPlayingRoom },
): void {
  http.get('/api/v1/playing-room', async (request, reply) => {
    const token = parseBearer(request.headers.authorization);
    const userId = token ? await deps.tokens.verify(token, TokenType.Access) : null;
    if (userId === null) {
      return reply.code(401).send();
    }
    return { roomId: deps.getPlayingRoom.execute(userId) };
  });
}
