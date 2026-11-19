import { describe, expect, it } from 'vitest';
import { GameError, GameErrorCode } from '../../../../src/features/game/domain/game-error.js';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import { PhaseType, type Game, type Stroke } from '../../../../src/features/game/domain/phase.js';
import { Reaction } from '../../../../src/features/game/domain/reaction.js';
import { RoomEventType } from '../../../../src/features/game/domain/room-event.js';
import { Room } from '../../../../src/features/game/domain/room.js';
import { Role } from '../../../../src/features/game/domain/role.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { RoomCode } from '../../../../src/shared/domain/room-code.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { TEST_OPTION } from '../../../support/game.js';

const NICK = 'nick' as Nickname;
const uid = (n: number) => n as UserId;
const [A, B, C] = [uid(1), uid(2), uid(3)];
const GAME: Game = { mafiaId: C, category: '장소', keyword: { word: '도시', synonyms: ['시내'] }, turnOrder: [B, A, C] };
const STROKE: Stroke = { x: [1, 2], y: [3, 4], t: [0, 10] };
const CANVAS = { w: 300, h: 400 };
const T0 = 1_000;

function roomOf(count: number): Room {
  const room = Room.create({
    id: 'K7Q2ZP' as RoomCode,
    locale: Locale.Ko,
    isQuickStart: false,
    option: TEST_OPTION,
    hostId: A,
    hostNickname: NICK,
  });
  for (let i = 2; i <= count; i++) {
    room.addPlayer(uid(i), NICK);
  }
  return room;
}

function codeOf(run: () => unknown): GameErrorCode | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof GameError) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

function phase<T extends PhaseType>(room: Room, type: T) {
  expect(room.phase.type).toBe(type);
  return room.phase as Extract<Room['phase'], { type: T }>;
}

/** Started, and past READY into the first turn at T0 + readyMs. */
function drawingRoom(): { room: Room; now: number } {
  const room = roomOf(3);
  room.start(A, GAME, T0);
  const now = T0 + TEST_OPTION.readyMs;
  room.expire(room.version, now);
  return { room, now };
}

/** Plays every turn out by deadline, leaving the room in VOTE. */
function votingRoom(): { room: Room; now: number } {
  const { room } = drawingRoom();
  let now = 0;
  while (room.phase.type === PhaseType.Drawing) {
    now = room.deadline!;
    room.expire(room.version, now);
  }
  return { room, now };
}

describe('Room game flow', () => {
  it('only the host starts, from WAIT, with enough connected players', () => {
    const room = roomOf(3);
    expect(codeOf(() => room.start(B, GAME, T0))).toBe(GameErrorCode.NotHost);
    room.setConnected(C, false, T0);
    expect(codeOf(() => room.start(A, GAME, T0))).toBe(GameErrorCode.NotEnoughPlayers);
    room.setConnected(C, true, T0);
    expect(room.start(A, GAME, T0)).toEqual([{ type: RoomEventType.PhaseChanged }]);
    expect(phase(room, PhaseType.Ready)).toEqual({ type: PhaseType.Ready, game: GAME, deadline: T0 + TEST_OPTION.readyMs });
    expect(room.isInGame).toBe(true);
    expect(codeOf(() => room.start(A, GAME, T0))).toBe(GameErrorCode.InvalidPhase);
  });

  it('opens the first turn after READY with the intro animation', () => {
    const { room, now } = drawingRoom();
    expect(phase(room, PhaseType.Drawing)).toMatchObject({
      turn: { round: 0, turn: 0, drawerId: B, startedAt: now, drawFrom: now + 5_000, deadline: now + 15_000 },
      sketches: [],
      current: null,
    });
  });

  it('ignores a deadline armed for an earlier version', () => {
    const room = roomOf(3);
    room.start(A, GAME, T0);
    const stale = room.version - 1;
    expect(room.expire(stale, T0 + TEST_OPTION.readyMs)).toEqual([]);
    expect(room.phase.type).toBe(PhaseType.Ready);
  });

  it('accepts strokes from the drawer once drawing opens, replacing the last or appending the next', () => {
    const { room, now } = drawingRoom();
    const open = phase(room, PhaseType.Drawing).turn.drawFrom;
    expect(codeOf(() => room.drawStroke(A, 0, STROKE, CANVAS, open))).toBe(GameErrorCode.NotYourTurn);
    expect(codeOf(() => room.drawStroke(B, 0, STROKE, CANVAS, now))).toBe(GameErrorCode.InvalidPhase);
    expect(codeOf(() => room.drawStroke(B, 1, STROKE, CANVAS, open))).toBe(GameErrorCode.InvalidRequest);

    expect(room.drawStroke(B, 0, STROKE, CANVAS, open)).toEqual([
      { type: RoomEventType.StrokeUpdated, drawerId: B, index: 0, stroke: STROKE, canvas: CANVAS },
    ]);
    const longer = { x: [1, 2, 3], y: [3, 4, 5], t: [0, 10, 10] };
    room.drawStroke(B, 0, longer, CANVAS, open);
    room.drawStroke(B, 1, STROKE, CANVAS, open);
    expect(phase(room, PhaseType.Drawing).current).toEqual({ userId: B, canvas: CANVAS, strokes: [longer, STROKE] });
    // strokesPerTurn is 2 in TEST_OPTION.
    expect(codeOf(() => room.drawStroke(B, 2, STROKE, CANVAS, open))).toBe(GameErrorCode.InvalidRequest);
  });

  it('ending a turn files the sketch and hands the turn to the next drawer', () => {
    const { room } = drawingRoom();
    const open = phase(room, PhaseType.Drawing).turn.drawFrom;
    room.drawStroke(B, 0, STROKE, CANVAS, open);
    expect(codeOf(() => room.endTurn(A, open))).toBe(GameErrorCode.NotYourTurn);
    const version = room.version;
    const events = room.endTurn(B, open + 1);
    const drawing = phase(room, PhaseType.Drawing);
    const sketch = { userId: B, canvas: CANVAS, strokes: [STROKE] };
    expect(events).toEqual([{ type: RoomEventType.TurnChanged, turn: drawing.turn, sketch }]);
    expect(drawing.turn).toMatchObject({ round: 0, turn: 1, drawerId: A, drawFrom: open + 1 });
    expect(drawing.sketches).toEqual([sketch]);
    expect(room.version).toBe(version + 1);
  });

  it('a turn with nothing drawn files no sketch; the last turn of the last round opens the vote', () => {
    const { room } = drawingRoom();
    let events = room.expire(room.version, 0);
    expect(events).toMatchObject([{ type: RoomEventType.TurnChanged, sketch: null }]);
    expect(phase(room, PhaseType.Drawing).sketches).toEqual([]);
    for (let i = 0; i < 2; i++) {
      room.expire(room.version, 0);
    }
    expect(phase(room, PhaseType.Drawing).turn).toMatchObject({ round: 1, turn: 0, drawerId: B, drawFrom: 2_000 });
    for (let i = 0; i < 2; i++) {
      room.expire(room.version, 0);
    }
    events = room.expire(room.version, 50);
    expect(events).toEqual([{ type: RoomEventType.PhaseChanged }]);
    expect(phase(room, PhaseType.Vote)).toMatchObject({ votes: new Map(), deadline: 50 + TEST_OPTION.voteMs });
  });

  it('reactions only while drawing', () => {
    const room = roomOf(3);
    expect(codeOf(() => room.react(A, Reaction.Heart))).toBe(GameErrorCode.InvalidPhase);
    const { room: drawing } = drawingRoom();
    expect(drawing.react(A, Reaction.Heart)).toEqual([{ type: RoomEventType.ReactionSent, userId: A, reaction: Reaction.Heart }]);
  });

  it('refuses a vote for oneself or a non-player, and lets a voter change their vote', () => {
    const { room, now } = votingRoom();
    expect(codeOf(() => room.vote(A, A, now))).toBe(GameErrorCode.InvalidRequest);
    expect(codeOf(() => room.vote(A, uid(99), now))).toBe(GameErrorCode.InvalidRequest);
    room.vote(A, B, now);
    const events = room.vote(A, C, now);
    expect(events).toEqual([{ type: RoomEventType.VotesChanged, votes: new Map([[A, C]]) }]);
    expect(phase(room, PhaseType.Vote).votes).toEqual(new Map([[A, C]]));
  });

  it('tallies once every connected player has voted; a caught mafia gets to guess', () => {
    const { room, now } = votingRoom();
    room.setConnected(B, false, now);
    room.vote(A, C, now);
    const events = room.vote(C, A, now);
    // A tie between C and A: nobody is accused.
    expect(events.map((e) => e.type)).toEqual([RoomEventType.VotesChanged, RoomEventType.PhaseChanged]);
    expect(phase(room, PhaseType.End).result).toEqual({ mafiaId: C, accusedId: null, mafiaGuess: null, winner: Role.Mafia });
  });

  it('the mafia wins when the vote accuses someone else', () => {
    const { room, now } = votingRoom();
    room.vote(A, B, now);
    room.vote(C, B, now);
    room.vote(B, A, now);
    expect(phase(room, PhaseType.End)).toMatchObject({
      result: { accusedId: B, winner: Role.Mafia },
      deadline: now + TEST_OPTION.endMs,
    });
  });

  it('an unfinished vote is tallied at the deadline', () => {
    const { room, now } = votingRoom();
    room.vote(A, C, now);
    room.expire(room.version, now + TEST_OPTION.voteMs);
    expect(phase(room, PhaseType.Answer)).toMatchObject({ typing: '', deadline: now + TEST_OPTION.voteMs + TEST_OPTION.answerMs });
  });

  function answeringRoom(): { room: Room; now: number } {
    const { room, now } = votingRoom();
    room.vote(A, C, now);
    room.vote(B, C, now);
    room.vote(C, A, now);
    phase(room, PhaseType.Answer);
    return { room, now };
  }

  it('only the mafia types and submits; a right guess wins for the mafia', () => {
    const { room, now } = answeringRoom();
    expect(codeOf(() => room.typeAnswer(A, '도시'))).toBe(GameErrorCode.NotYourTurn);
    expect(room.typeAnswer(C, '도')).toEqual([{ type: RoomEventType.AnswerTyped, mafiaId: C, answer: '도' }]);
    expect(phase(room, PhaseType.Answer).typing).toBe('도');
    room.submitAnswer(C, ' 도시 ', now);
    expect(phase(room, PhaseType.End).result).toEqual({ mafiaId: C, accusedId: C, mafiaGuess: ' 도시 ', winner: Role.Mafia });
  });

  it('a synonym of the keyword also wins for the mafia', () => {
    const { room, now } = answeringRoom();
    room.submitAnswer(C, '시내', now);
    expect(phase(room, PhaseType.End).result).toMatchObject({ mafiaGuess: '시내', winner: Role.Mafia });
  });

  it('at the answer deadline the last typed answer is judged', () => {
    const { room, now } = answeringRoom();
    room.typeAnswer(C, '바다');
    room.expire(room.version, now);
    expect(phase(room, PhaseType.End).result).toMatchObject({ mafiaGuess: '바다', winner: Role.Citizen });
  });

  it('back to WAIT removes players still away and hands over the host', () => {
    const { room, now } = answeringRoom();
    room.submitAnswer(C, '도시', now);
    room.setConnected(A, false, now);
    expect(room.playAgain(now)).toEqual([{ type: RoomEventType.PhaseChanged }]);
    expect(room.phase).toEqual({ type: PhaseType.Wait });
    expect(room.players.map((p) => p.userId)).toEqual([B, C]);
    expect(room.hostId).toBe(B);
    expect(room.deadline).toBeNull();
  });

  it('play again only from END', () => {
    const { room, now } = drawingRoom();
    expect(codeOf(() => room.playAgain(now))).toBe(GameErrorCode.InvalidPhase);
  });

  it('the END deadline empties a room nobody came back to', () => {
    const { room, now } = answeringRoom();
    room.submitAnswer(C, '도시', now);
    for (const id of [A, B, C]) {
      room.setConnected(id, false, now);
    }
    room.expire(room.version, room.deadline!);
    expect(room.isEmpty).toBe(true);
  });
});
