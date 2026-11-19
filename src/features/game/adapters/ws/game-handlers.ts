import { z } from 'zod';
import { ClientMessageType } from '../../../../shared/adapters/ws/protocol.js';
import type { WsRouter } from '../../../../shared/adapters/ws/router.js';
import { toUserId, type UserId } from '../../../../shared/domain/user-id.js';
import type { DrawStroke } from '../../application/usecases/draw-stroke.js';
import type { EndTurn } from '../../application/usecases/end-turn.js';
import type { PlayAgain } from '../../application/usecases/play-again.js';
import type { React } from '../../application/usecases/react.js';
import type { StartGame } from '../../application/usecases/start-game.js';
import type { SubmitAnswer } from '../../application/usecases/submit-answer.js';
import type { TypeAnswer } from '../../application/usecases/type-answer.js';
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
    startGame: StartGame;
    drawStroke: DrawStroke;
    endTurn: EndTurn;
    react: React;
    vote: Vote;
    typeAnswer: TypeAnswer;
    submitAnswer: SubmitAnswer;
    playAgain: PlayAgain;
  },
): void {
  const answer = z.object({ answer: z.string().max(limits.maxAnswerLength) });

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
  router.register(ClientMessageType.EndTurn, z.object({}), (userId) => {
    deps.endTurn.execute(userId);
    return null;
  });
  router.register(ClientMessageType.Reaction, z.object({ reaction: ReactionSchema }), (userId, { reaction }) => {
    deps.react.execute(userId, reaction);
    return null;
  });
  router.register(ClientMessageType.Vote, z.object({ targetId: UserIdSchema }), (userId, { targetId }) => {
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
  router.register(ClientMessageType.PlayAgain, z.object({}), (userId) => {
    deps.playAgain.execute(userId);
    return null;
  });
}
