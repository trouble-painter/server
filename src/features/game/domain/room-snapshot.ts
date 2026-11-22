import type { Locale } from '../../../shared/domain/locale.js';
import type { RoomCode } from '../../../shared/domain/room-code.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import type { GameOption } from './game-option.js';
import type { GameRule } from './game-rule.js';
import type { Phase, PhaseType } from './phase.js';
import type { Player } from './room.js';

/** Bump when the shape changes so older saved rooms can be told apart. */
export const ROOM_SNAPSHOT_VERSION = 4;

type VotePhase = Extract<Phase, { type: PhaseType.Vote }>;

/** A phase as plain JSON: votes become `[voter, target]` pairs. */
export type PhaseSnapshot =
  | Exclude<Phase, VotePhase>
  | (Omit<VotePhase, 'votes'> & { readonly votes: readonly (readonly [UserId, UserId])[] });

/** Everything needed to rebuild a room after a restart. */
export interface RoomSnapshot {
  readonly v: typeof ROOM_SNAPSHOT_VERSION;
  readonly id: RoomCode;
  readonly locale: Locale;
  readonly isQuickStart: boolean;
  readonly option: GameOption;
  readonly rule: GameRule;
  readonly hostId: UserId;
  readonly players: readonly Readonly<Player>[];
  readonly phase: PhaseSnapshot;
  readonly emptySince: number | null;
  readonly version: number;
}
