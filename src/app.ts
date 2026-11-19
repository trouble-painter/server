import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './features/auth/adapters/http/auth-routes.js';
import { ReissueToken, SignInAnonymous, TokenType } from './features/auth/application/index.js';
import { JoseTokenService } from './features/auth/infrastructure/jose-token-service.js';
import { registerPlayingRoomRoute } from './features/game/adapters/http/playing-room-route.js';
import { connectionHandlers, registerRoomHandlers } from './features/game/adapters/ws/room-handlers.js';
import { mapGameError } from './features/game/adapters/ws/wire.js';
import { WsRoomEventPublisher } from './features/game/adapters/ws/ws-room-event-publisher.js';
import { Membership } from './features/game/application/membership.js';
import { CleanupRooms } from './features/game/application/usecases/cleanup-rooms.js';
import { ConnectUser } from './features/game/application/usecases/connect-user.js';
import { CreateRoom } from './features/game/application/usecases/create-room.js';
import { DisconnectUser } from './features/game/application/usecases/disconnect-user.js';
import { GetPlayingRoom } from './features/game/application/usecases/get-playing-room.js';
import { JoinRoom } from './features/game/application/usecases/join-room.js';
import { LeaveRoom } from './features/game/application/usecases/leave-room.js';
import { MemoryRoomRepository } from './features/game/infrastructure/memory/memory-room-repository.js';
import { parseBearer } from './shared/adapters/http/bearer.js';
import { WS_PATH } from './shared/adapters/ws/protocol.js';
import { WsRouter } from './shared/adapters/ws/router.js';
import type { Env } from './shared/infrastructure/config/env.js';
import { RandomIdGenerator } from './shared/infrastructure/id/random-id-generator.js';
import { SystemClock } from './shared/infrastructure/time/system-clock.js';
import { TimeoutScheduler } from './shared/infrastructure/time/timeout-scheduler.js';
import { WsServer } from './shared/infrastructure/ws/ws-server.js';

/** Composition root: wires ports to implementations. */
export function buildApp(env: Env, logger: FastifyBaseLogger): FastifyInstance {
  const http = Fastify({ loggerInstance: logger });
  const ids = new RandomIdGenerator();
  const clock = new SystemClock();
  const scheduler = new TimeoutScheduler();

  const tokens = new JoseTokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SEC);
  registerAuthRoutes(http, {
    signInAnonymous: new SignInAnonymous(tokens, ids),
    reissueToken: new ReissueToken(tokens),
  });

  const rooms = new MemoryRoomRepository();
  registerPlayingRoomRoute(http, { tokens, getPlayingRoom: new GetPlayingRoom(rooms) });

  const ws = new WsServer(
    {
      path: WS_PATH,
      pingIntervalMs: env.WS_PING_INTERVAL_MS,
      maxMessageBytes: env.WS_MAX_MESSAGE_BYTES,
      ratePerSec: env.WS_RATE_PER_SEC,
      rateBurst: env.WS_RATE_BURST,
    },
    logger,
  );
  const publisher = new WsRoomEventPublisher(ws);
  const membership = new Membership(rooms, publisher, scheduler, clock);

  const router = new WsRouter(logger, mapGameError);
  registerRoomHandlers(router, {
    createRoom: new CreateRoom(rooms, membership, ids),
    joinRoom: new JoinRoom(rooms, membership, publisher),
    leaveRoom: new LeaveRoom(rooms, membership),
  });
  ws.listen(http.server, {
    authenticate: async (authorization) => {
      const token = parseBearer(authorization);
      return token === null ? null : tokens.verify(token, TokenType.Access);
    },
    onMessage: (userId, text) => router.handle(userId, text),
    ...connectionHandlers({
      connectUser: new ConnectUser(rooms, publisher, scheduler, clock),
      disconnectUser: new DisconnectUser(
        rooms,
        membership,
        publisher,
        scheduler,
        clock,
        env.WAIT_DISCONNECT_GRACE_MS,
      ),
      clock,
    }),
  });

  const cleanupRooms = new CleanupRooms(rooms, scheduler, clock, env.EMPTY_ROOM_TTL_MS);
  const cleanupTimer = setInterval(() => cleanupRooms.execute(), env.ROOM_CLEANUP_INTERVAL_MS);

  http.addHook('preClose', async () => {
    clearInterval(cleanupTimer);
    ws.close();
    scheduler.cancelAll();
  });

  return http;
}
