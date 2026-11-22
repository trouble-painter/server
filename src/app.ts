import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './features/auth/adapters/http/auth-routes.js';
import { ReissueToken, SignInAnonymous, TokenType } from './features/auth/application/index.js';
import { JoseTokenService } from './features/auth/infrastructure/jose-token-service.js';
import { registerPlayingRoomRoute } from './features/game/adapters/http/playing-room-route.js';
import { registerGameHandlers } from './features/game/adapters/ws/game-handlers.js';
import { connectionHandlers, registerRoomHandlers } from './features/game/adapters/ws/room-handlers.js';
import { mapGameError } from './features/game/adapters/ws/wire.js';
import { WsKickedNotifier } from './features/game/adapters/ws/ws-kicked-notifier.js';
import { WsRoomEventPublisher } from './features/game/adapters/ws/ws-room-event-publisher.js';
import { GameRecorder } from './features/game/application/game-recorder.js';
import { GameStartPush } from './features/game/application/game-start-push.js';
import { Membership } from './features/game/application/membership.js';
import { GameVacancy } from './features/game/application/game-vacancy.js';
import { PhaseTimer } from './features/game/application/phase-timer.js';
import type { GameStartPushSender } from './features/game/application/ports/game-start-push-sender.js';
import { RecordingRoomEventPublisher } from './features/game/application/recording-room-event-publisher.js';
import { CleanupRooms } from './features/game/application/usecases/cleanup-rooms.js';
import { ConnectUser } from './features/game/application/usecases/connect-user.js';
import { ClearSketch } from './features/game/application/usecases/clear-sketch.js';
import { CreateRoom } from './features/game/application/usecases/create-room.js';
import { DisconnectUser } from './features/game/application/usecases/disconnect-user.js';
import { DrawStroke } from './features/game/application/usecases/draw-stroke.js';
import { EndTurn } from './features/game/application/usecases/end-turn.js';
import { GetPlayingRoom } from './features/game/application/usecases/get-playing-room.js';
import { JoinRoom } from './features/game/application/usecases/join-room.js';
import { KickPlayer } from './features/game/application/usecases/kick-player.js';
import { LeaveRoom } from './features/game/application/usecases/leave-room.js';
import { React } from './features/game/application/usecases/react.js';
import { RestoreRooms } from './features/game/application/usecases/restore-rooms.js';
import { SetReady } from './features/game/application/usecases/set-ready.js';
import { StartGame } from './features/game/application/usecases/start-game.js';
import { UpdateRule } from './features/game/application/usecases/update-rule.js';
import { StartQuickStartGame } from './features/game/application/usecases/start-quick-start-game.js';
import { SubmitAnswer } from './features/game/application/usecases/submit-answer.js';
import { TypeAnswer } from './features/game/application/usecases/type-answer.js';
import { UndoStroke } from './features/game/application/usecases/undo-stroke.js';
import { Vote } from './features/game/application/usecases/vote.js';
import { PLAYER_COUNT, type GameOption } from './features/game/domain/game-option.js';
import { PhaseType } from './features/game/domain/phase.js';
import { MAX_STROKES_PER_TURN } from './features/game/domain/game-rule.js';
import type { Limits } from './features/game/domain/limits.js';
import { JsonKeywordRepository } from './features/game/infrastructure/keywords/json-keyword-repository.js';
import { SqliteGameHistoryRepository } from './features/game/infrastructure/sqlite/sqlite-game-history-repository.js';
import { SqliteRoomRepository } from './features/game/infrastructure/sqlite/sqlite-room-repository.js';
import { registerMatchingHandlers } from './features/matching/adapters/ws/matching-handlers.js';
import { WsMatchingPublisher } from './features/matching/adapters/ws/ws-matching-publisher.js';
import { Matchmaking } from './features/matching/application/matchmaking.js';
import type { PushNotifier } from './features/matching/application/ports/push-notifier.js';
import { createMatchRule } from './features/matching/domain/match-queue.js';
import { FcmPushNotifier, type PushText } from './features/matching/infrastructure/fcm-push-notifier.js';
import { LogPushNotifier } from './features/matching/infrastructure/log-push-notifier.js';
import { parseBearer } from './shared/adapters/http/bearer.js';
import { registerConfigRoute } from './shared/adapters/http/config-route.js';
import { registerDeveloperRoute } from './shared/adapters/http/developer-route.js';
import { WS_PATH } from './shared/adapters/ws/protocol.js';
import { WsRouter } from './shared/adapters/ws/router.js';
import { Locale } from './shared/domain/locale.js';
import { pushTextOf, PushTextPrefix, type Env } from './shared/infrastructure/config/env.js';
import { FileDeveloperRegistry } from './shared/infrastructure/developer/file-developer-registry.js';
import { RandomIdGenerator } from './shared/infrastructure/id/random-id-generator.js';
import { CryptoRandom } from './shared/infrastructure/random/crypto-random.js';
import { SystemClock } from './shared/infrastructure/time/system-clock.js';
import { TimeoutScheduler } from './shared/infrastructure/time/timeout-scheduler.js';
import type { PrometheusMetrics } from './shared/infrastructure/metrics/prometheus-metrics.js';
import { WsServer } from './shared/infrastructure/ws/ws-server.js';

/** Composition root: wires ports to implementations. */
export function buildApp(env: Env, logger: FastifyBaseLogger, metrics: PrometheusMetrics, serverVersion: string): FastifyInstance {
  const http = Fastify({ loggerInstance: logger });
  const ids = new RandomIdGenerator();
  const clock = new SystemClock();
  const scheduler = new TimeoutScheduler();
  const random = new CryptoRandom();
  const keywords = JsonKeywordRepository.load(env.KEYWORDS_DIR);
  if (env.GAME_STROKES_PER_TURN > MAX_STROKES_PER_TURN) {
    throw new Error(`GAME_STROKES_PER_TURN must be at most ${MAX_STROKES_PER_TURN}`);
  }
  const option: GameOption = {
    ...PLAYER_COUNT,
    readyMs: env.GAME_READY_MS,
    introAnimationMs: env.GAME_INTRO_ANIMATION_MS,
    roundAnimationMs: env.GAME_ROUND_ANIMATION_MS,
    rounds: env.GAME_ROUNDS,
    turnMs: env.GAME_TURN_MS,
    defaultStrokesPerTurn: env.GAME_STROKES_PER_TURN,
    voteMs: env.GAME_VOTE_MS,
    answerMs: env.GAME_ANSWER_MS,
  };
  const limits: Limits = {
    drawThrottleMs: env.DRAW_THROTTLE_MS,
    reactionThrottleMs: env.REACTION_THROTTLE_MS,
    maxStrokePoints: env.MAX_STROKE_POINTS,
    maxAnswerLength: env.MAX_ANSWER_LENGTH,
    maxStrokesPerTurn: MAX_STROKES_PER_TURN,
  };

  registerConfigRoute(http, serverVersion);
  registerDeveloperRoute(http, new FileDeveloperRegistry(env.DEV_UUIDS_PATH));

  const tokens = new JoseTokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SEC);
  registerAuthRoutes(http, {
    signInAnonymous: new SignInAnonymous(tokens, ids),
    reissueToken: new ReissueToken(tokens),
  });

  const rooms = SqliteRoomRepository.open(env.SQLITE_PATH, clock, logger, env.EMPTY_ROOM_TTL_MS);
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
  const gameHistory = SqliteGameHistoryRepository.open(env.SQLITE_PATH, logger);
  const recorder = new GameRecorder(gameHistory, clock, metrics);
  const publisher = new RecordingRoomEventPublisher(new WsRoomEventPublisher(ws, keywords), recorder, logger);
  const membership = new Membership(rooms, publisher, scheduler, clock);
  const timer = new PhaseTimer(rooms, publisher, scheduler, clock);
  const vacancy = new GameVacancy(rooms, scheduler, recorder, timer, clock, env.GAME_DISCONNECT_GRACE_MS);

  const notifier = createPushNotifier(env, logger);
  const gameStartPush = new GameStartPush(notifier);
  const startQuickStartGame = new StartQuickStartGame(
    rooms,
    publisher,
    timer,
    ids,
    option,
    keywords,
    random,
    clock,
    gameStartPush,
  );
  const matchmaking = new Matchmaking(
    createMatchRule({ min: env.MATCH_MIN, target: env.MATCH_TARGET, waitMs: env.MATCH_WAIT_MS, acceptMs: env.MATCH_ACCEPT_MS }, PLAYER_COUNT),
    { waitMs: env.PUSH_WAIT_MS, cooldownMs: env.PUSH_COOLDOWN_MS },
    env.MATCH_DISCONNECT_GRACE_MS,
    membership,
    { start: (locale, players) => startQuickStartGame.execute(locale, players) },
    new WsMatchingPublisher(ws),
    notifier,
    gameStartPush,
    scheduler,
    clock,
    metrics,
  );
  metrics.addGauge('rooms_playing', 'Rooms in a game.', () => rooms.all().filter((room) => room.phase.type !== PhaseType.Wait).length);
  metrics.addGauge('ws_connections', 'Open WebSocket connections.', () => ws.connectionCount);
  metrics.addGauge('matching_queued_players', 'Players waiting in a quick-start queue.', () => matchmaking.queuedCount);

  const router = new WsRouter(logger, mapGameError);
  registerRoomHandlers(router, {
    createRoom: new CreateRoom(rooms, membership, matchmaking, ids, option),
    joinRoom: new JoinRoom(rooms, membership, matchmaking, publisher),
    leaveRoom: new LeaveRoom(rooms, membership, publisher, vacancy, clock),
    keywords,
  });
  registerGameHandlers(router, limits, {
    updateRule: new UpdateRule(rooms, publisher, keywords),
    setReady: new SetReady(rooms, publisher),
    kickPlayer: new KickPlayer(rooms, membership, new WsKickedNotifier(ws)),
    startGame: new StartGame(rooms, publisher, timer, keywords, random, clock, gameStartPush),
    drawStroke: new DrawStroke(rooms, publisher, clock, limits.maxStrokePoints),
    clearSketch: new ClearSketch(rooms, publisher, clock),
    undoStroke: new UndoStroke(rooms, publisher, clock),
    endTurn: new EndTurn(rooms, publisher, timer, clock),
    react: new React(rooms, publisher, clock, env.REACTION_THROTTLE_MS),
    vote: new Vote(rooms, publisher),
    typeAnswer: new TypeAnswer(rooms, publisher),
    submitAnswer: new SubmitAnswer(rooms, publisher, timer, clock),
    gameStartPush,
  });
  registerMatchingHandlers(router, { matchmaking });
  ws.listen(http.server, {
    authenticate: async (authorization) => {
      const token = parseBearer(authorization);
      return token === null ? null : tokens.verify(token, TokenType.Access);
    },
    onMessage: (userId, text) => router.handle(userId, text),
    ...connectionHandlers({
      connectUser: new ConnectUser(rooms, publisher, scheduler, vacancy, clock),
      disconnectUser: new DisconnectUser(
        rooms,
        membership,
        publisher,
        vacancy,
        clock,
        env.WAIT_DISCONNECT_GRACE_MS,
      ),
      queue: matchmaking,
      clock,
      limits,
      keywords,
      serverVersion,
    }),
  });

  new RestoreRooms(rooms, membership, vacancy, clock, env.RESTORE_GRACE_MS, env.WAIT_DISCONNECT_GRACE_MS).execute();

  const cleanupRooms = new CleanupRooms(rooms, scheduler, recorder, clock, env.EMPTY_ROOM_TTL_MS);
  const cleanupTimer = setInterval(() => cleanupRooms.execute(), env.ROOM_CLEANUP_INTERVAL_MS);

  http.addHook('preClose', async () => {
    clearInterval(cleanupTimer);
    ws.close();
    scheduler.cancelAll();
    rooms.close();
    gameHistory.close();
    if (notifier instanceof FcmPushNotifier) {
      await notifier.close();
    }
  });

  return http;
}

function createPushNotifier(env: Env, logger: FastifyBaseLogger): PushNotifier & GameStartPushSender {
  if (!env.PUSH_ENABLED) {
    return new LogPushNotifier(logger);
  }
  const textsOf = (prefix: PushTextPrefix) =>
    Object.fromEntries(Object.values(Locale).map((locale) => [locale, pushTextOf(env, prefix, locale)])) as Record<
      Locale,
      PushText
    >;
  return FcmPushNotifier.create(
    env.FCM_CREDENTIALS_PATH,
    {
      quickStart: textsOf(PushTextPrefix.QuickStart),
      gameStart: textsOf(PushTextPrefix.GameStart),
      matchFound: textsOf(PushTextPrefix.MatchFound),
    },
    logger,
  );
}
