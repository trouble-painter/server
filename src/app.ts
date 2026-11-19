import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './features/auth/adapters/http/auth-routes.js';
import { ReissueToken, SignInAnonymous } from './features/auth/application/index.js';
import { JoseTokenService } from './features/auth/infrastructure/jose-token-service.js';
import { registerPlayingRoomRoute } from './features/game/adapters/http/playing-room-route.js';
import type { PlayingRoomIndex } from './features/game/application/ports/playing-room-index.js';
import { GetPlayingRoom } from './features/game/application/usecases/get-playing-room.js';
import type { Env } from './shared/infrastructure/config/env.js';
import { RandomIdGenerator } from './shared/infrastructure/id/random-id-generator.js';

/** Composition root: wires ports to implementations. */
export function buildApp(env: Env, logger: FastifyBaseLogger): FastifyInstance {
  const http = Fastify({ loggerInstance: logger });

  const tokens = new JoseTokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SEC);
  registerAuthRoutes(http, {
    signInAnonymous: new SignInAnonymous(tokens, new RandomIdGenerator()),
    reissueToken: new ReissueToken(tokens),
  });

  // TODO(M2): replace with the index kept by the room repository.
  const noRooms: PlayingRoomIndex = { findRoomId: () => null };
  registerPlayingRoomRoute(http, { tokens, getPlayingRoom: new GetPlayingRoom(noRooms) });

  return http;
}
