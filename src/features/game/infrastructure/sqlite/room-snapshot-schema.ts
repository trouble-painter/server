import { z } from 'zod';
import { Locale } from '../../../../shared/domain/locale.js';
import { toRoomCode } from '../../../../shared/domain/room-code.js';
import { toUserId } from '../../../../shared/domain/user-id.js';
import { defaultRule } from '../../domain/game-rule.js';
import { toNickname } from '../../domain/nickname.js';
import { PhaseType } from '../../domain/phase.js';
import { PlayerColor } from '../../domain/player-color.js';
import { Role } from '../../domain/role.js';
import { ROOM_SNAPSHOT_VERSION, type RoomSnapshot } from '../../domain/room-snapshot.js';

/** Runs a value through a domain constructor that returns null for invalid input. */
function branded<I, O>(base: z.ZodType<I>, to: (value: I) => O | null) {
  return base.transform((value, ctx) => {
    const result = to(value);
    if (result === null) {
      ctx.addIssue({ code: 'custom', message: 'invalid value' });
      return z.NEVER;
    }
    return result;
  });
}

const time = z.number().int();
const userId = branded(z.number(), toUserId);

const game = z.object({
  mafiaId: userId,
  category: z.string(),
  keyword: z.object({ word: z.string(), synonyms: z.array(z.string()) }),
  turnOrder: z.array(userId),
});

const canvas = z.object({ w: z.number(), h: z.number() });
const stroke = z.object({ x: z.array(z.number()), y: z.array(z.number()), t: z.array(z.number()) });
const sketch = z.object({ userId, canvas, strokes: z.array(stroke) });

const turn = z.object({
  round: z.number().int(),
  turn: z.number().int(),
  drawerId: userId,
  startedAt: time,
  drawFrom: time,
  deadline: time,
});

const result = z.object({
  mafiaId: userId,
  accusedId: userId.nullable(),
  mafiaGuess: z.string().nullable(),
  winner: z.enum(Role),
});

const phase = z.discriminatedUnion('type', [
  z.object({ type: z.literal(PhaseType.Wait) }),
  z.object({ type: z.literal(PhaseType.Ready), game, deadline: time }),
  z.object({ type: z.literal(PhaseType.Drawing), game, turn, sketches: z.array(sketch), current: sketch.nullable() }),
  z.object({
    type: z.literal(PhaseType.Vote),
    game,
    sketches: z.array(sketch),
    votes: z.array(z.tuple([userId, userId])),
    deadline: time,
  }),
  z.object({ type: z.literal(PhaseType.Answer), game, sketches: z.array(sketch), typing: z.string(), deadline: time }),
  z.object({ type: z.literal(PhaseType.End), game, sketches: z.array(sketch), result }),
]);

const count = z.number().int().min(0);

const option = {
  minPlayers: count,
  maxPlayers: count,
  readyMs: count,
  introAnimationMs: count,
  roundAnimationMs: count,
  rounds: count,
  turnMs: count,
  voteMs: count,
  answerMs: count,
};

const rest = {
  id: branded(z.string(), toRoomCode),
  locale: z.enum(Locale),
  isQuickStart: z.boolean(),
  hostId: userId,
  players: z.array(
    z.object({
      userId,
      nickname: branded(z.string(), toNickname),
      color: z.enum(PlayerColor),
      isConnected: z.boolean(),
      isReady: z.boolean(),
    }),
  ),
  phase,
  emptySince: time.nullable(),
  version: count,
};

const RoomSnapshotV3Schema = z.object({
  v: z.literal(ROOM_SNAPSHOT_VERSION),
  option: z.object({ ...option, defaultStrokesPerTurn: count }),
  rule: z.object({ strokesPerTurn: count.nullable(), categoryIds: z.array(z.string()), keywordLocale: z.enum(Locale) }),
  ...rest,
});

/** Saved before the rule had a keyword locale: the keywords were in the room's locale. */
const RoomSnapshotV2Schema = z
  .object({
    v: z.literal(2),
    option: z.object({ ...option, defaultStrokesPerTurn: count }),
    rule: z.object({ strokesPerTurn: count.nullable(), categoryIds: z.array(z.string()) }),
    ...rest,
  })
  .transform(({ rule, ...snapshot }) => ({
    ...snapshot,
    v: ROOM_SNAPSHOT_VERSION as typeof ROOM_SNAPSHOT_VERSION,
    rule: { ...rule, keywordLocale: snapshot.locale },
  }));

/** Saved before rooms had a rule: every room played the configured stroke count over all categories. */
const RoomSnapshotV1Schema = z
  .object({ v: z.literal(1), option: z.object({ ...option, strokesPerTurn: count }), ...rest })
  .transform(({ option: { strokesPerTurn, ...option }, ...snapshot }) => ({
    ...snapshot,
    v: ROOM_SNAPSHOT_VERSION as typeof ROOM_SNAPSHOT_VERSION,
    option: { ...option, defaultStrokesPerTurn: strokesPerTurn },
    rule: defaultRule(strokesPerTurn, snapshot.locale),
  }));

/** Checks a saved room before it is trusted; the annotation keeps it in step with {@link RoomSnapshot}. */
export const RoomSnapshotSchema: z.ZodType<RoomSnapshot> = z.union([RoomSnapshotV3Schema, RoomSnapshotV2Schema, RoomSnapshotV1Schema]);
