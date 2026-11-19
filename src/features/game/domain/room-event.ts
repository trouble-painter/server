import type { UserId } from '../../../shared/domain/user-id.js';
import type { Canvas, Sketch, Stroke, Turn } from './phase.js';
import type { Reaction } from './reaction.js';

export enum RoomEventType {
  PlayersChanged = 'playersChanged',
  PhaseChanged = 'phaseChanged',
  TurnChanged = 'turnChanged',
  StrokeUpdated = 'strokeUpdated',
  SketchCleared = 'sketchCleared',
  ReactionSent = 'reactionSent',
  VotesChanged = 'votesChanged',
  AnswerTyped = 'answerTyped',
  RoomClosed = 'roomClosed',
}

export type RoomEvent =
  | { readonly type: RoomEventType.PlayersChanged }
  | { readonly type: RoomEventType.PhaseChanged }
  /** `sketch` is the turn that just ended; null when its drawer drew nothing. */
  | { readonly type: RoomEventType.TurnChanged; readonly turn: Turn; readonly sketch: Sketch | null }
  | {
      readonly type: RoomEventType.StrokeUpdated;
      readonly drawerId: UserId;
      readonly index: number;
      readonly stroke: Stroke;
      readonly canvas: Canvas;
    }
  | { readonly type: RoomEventType.SketchCleared; readonly drawerId: UserId }
  | { readonly type: RoomEventType.ReactionSent; readonly userId: UserId; readonly reaction: Reaction }
  | { readonly type: RoomEventType.VotesChanged; readonly votes: ReadonlyMap<UserId, UserId> }
  | { readonly type: RoomEventType.AnswerTyped; readonly mafiaId: UserId; readonly answer: string }
  /** The room is over and the caller deletes it. */
  | { readonly type: RoomEventType.RoomClosed };
