import type { UserId } from '../../../shared/domain/user-id.js';
import type { Canvas, Sketch, Stroke, Turn } from './phase.js';
import type { Reaction } from './reaction.js';

export enum RoomEventType {
  PlayersChanged = 'playersChanged',
  PhaseChanged = 'phaseChanged',
  RuleChanged = 'ruleChanged',
  TurnChanged = 'turnChanged',
  StrokeUpdated = 'strokeUpdated',
  SketchCleared = 'sketchCleared',
  StrokeUndone = 'strokeUndone',
  ReactionSent = 'reactionSent',
  VotesChanged = 'votesChanged',
  AnswerTyped = 'answerTyped',
}

export type RoomEvent =
  | { readonly type: RoomEventType.PlayersChanged }
  | { readonly type: RoomEventType.PhaseChanged }
  | { readonly type: RoomEventType.RuleChanged }
  /** `sketch` is the turn that just ended; null when its drawer drew nothing. */
  | { readonly type: RoomEventType.TurnChanged; readonly turn: Turn; readonly sketch: Sketch | null }
  | {
      readonly type: RoomEventType.StrokeUpdated;
      readonly drawerId: UserId;
      readonly index: number;
      /** The points of `stroke` from here on are new. */
      readonly from: number;
      /** The whole stroke so far */
      readonly stroke: Stroke;
      readonly canvas: Canvas;
    }
  | { readonly type: RoomEventType.SketchCleared; readonly drawerId: UserId }
  | { readonly type: RoomEventType.StrokeUndone; readonly drawerId: UserId }
  | { readonly type: RoomEventType.ReactionSent; readonly userId: UserId; readonly reaction: Reaction }
  | { readonly type: RoomEventType.VotesChanged; readonly votes: ReadonlyMap<UserId, UserId> }
  | { readonly type: RoomEventType.AnswerTyped; readonly mafiaId: UserId; readonly answer: string };
