import { z } from 'zod';
import { ClientMessageType } from '../../../../shared/adapters/ws/protocol.js';
import type { WsRouter } from '../../../../shared/adapters/ws/router.js';
import { toUserId, type UserId } from '../../../../shared/domain/user-id.js';
import type { GameStartPush } from '../../application/game-start-push.js';
import type { ClearSketch } from '../../application/usecases/clear-sketch.js';
import type { DrawStroke } from '../../application/usecases/draw-stroke.js';
import type { EndTurn } from '../../application/usecases/end-turn.js';
import type { React } from '../../application/usecases/react.js';
import type { SetReady } from '../../application/usecases/set-ready.js';
import type { StartGame } from '../../application/usecases/start-game.js';
import type { SubmitAnswer } from '../../application/usecases/submit-answer.js';
import type { TypeAnswer } from '../../application/usecases/type-answer.js';
import type { UndoStroke } from '../../application/usecases/undo-stroke.js';
import type { UpdateRule } from '../../application/usecases/update-rule.js';
import type { Vote } from '../../application/usecases/vote.js';
import type { Limits } from '../../domain/limits.js';
import { ReactionSchema } from './wire.js';

const UserIdSchema = z.number().transform((value, ctx): UserId => {
  const userId = toUserId(value);
  if (userId === null) {
    ctx.addIssue({ code: 'custom', message: 'invalid user id' });
    return z.NEVER;
  }
  return userId;
});

/** FCM tokens are about 160 characters; this only bounds what is kept in memory. */
const PUSH_TOKEN_MAX_LENGTH = 4096;

/** Generous bounds only; the room checks the ids against the keyword files. */
const CATEGORY_ID_MAX_LENGTH = 64;
const CATEGORY_IDS_MAX = 100;

const CanvasSchema = z.object({ w: z.number().positive(), h: z.number().positive() });

function strokeSchema(maxPoints: number) {
  const points = z.array(z.number()).min(1).max(maxPoints);
  return z
    .object({ x: points, y: points, t: points })
    .refine((s) => s.x.length === s.y.length && s.x.length === s.t.length, 'point arrays differ in length');
}

/** Everyone, the requester included, hears the outcome through the room's broadcast, so no handler replies. */
export function registerGameHandlers(
  router: WsRouter,
  limits: Limits,
  deps: {
    updateRule: UpdateRule;
    setReady: SetReady;
    startGame: StartGame;
    drawStroke: DrawStroke;
    clearSketch: ClearSketch;
    undoStroke: UndoStroke;
    endTurn: EndTurn;
    react: React;
    vote: Vote;
    typeAnswer: TypeAnswer;
    submitAnswer: SubmitAnswer;
    gameStartPush: GameStartPush;
  },
): void {
  const answer = z.object({ answer: z.string().max(limits.maxAnswerLength) });

  router.register(ClientMessageType.PushToken, z.object({ token: z.string().min(1).max(PUSH_TOKEN_MAX_LENGTH) }), (userId, { token }) => {
    deps.gameStartPush.register(userId, token);
    return null;
  });
  router.register(
    ClientMessageType.UpdateRule,
    z.object({
      strokesPerTurn: z.number().int().nullable(),
      categoryIds: z.array(z.string().max(CATEGORY_ID_MAX_LENGTH)).max(CATEGORY_IDS_MAX),
    }),
    (userId, rule) => {
      deps.updateRule.execute(userId, rule);
      return null;
    },
  );
  router.register(ClientMessageType.SetReady, z.object({ isReady: z.boolean() }), (userId, { isReady }) => {
    deps.setReady.execute(userId, isReady);
    return null;
  });
  router.register(ClientMessageType.StartGame, z.object({}), (userId) => {
    deps.startGame.execute(userId);
    return null;
  });
  router.register(
    ClientMessageType.DrawStroke,
    z.object({ index: z.number().int().min(0), stroke: strokeSchema(limits.maxStrokePoints), canvas: CanvasSchema }),
    (userId, { index, stroke, canvas }) => {
      deps.drawStroke.execute(userId, index, stroke, canvas);
      return null;
    },
  );
  router.register(ClientMessageType.ClearSketch, z.object({}), (userId) => {
    deps.clearSketch.execute(userId);
    return null;
  });
  router.register(ClientMessageType.UndoStroke, z.object({}), (userId) => {
    deps.undoStroke.execute(userId);
    return null;
  });
  router.register(ClientMessageType.EndTurn, z.object({}), (userId) => {
    deps.endTurn.execute(userId);
    return null;
  });
  router.register(ClientMessageType.Reaction, z.object({ reaction: ReactionSchema }), (userId, { reaction }) => {
    deps.react.execute(userId, reaction);
    return null;
  });
  router.register(ClientMessageType.Vote, z.object({ targetId: UserIdSchema.nullable() }), (userId, { targetId }) => {
    deps.vote.execute(userId, targetId);
    return null;
  });
  router.register(ClientMessageType.TypeAnswer, answer, (userId, data) => {
    deps.typeAnswer.execute(userId, data.answer);
    return null;
  });
  router.register(ClientMessageType.SubmitAnswer, answer, (userId, data) => {
    deps.submitAnswer.execute(userId, data.answer);
    return null;
  });
}
