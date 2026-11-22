import { describe, expect, it } from 'vitest';
import { GameError, GameErrorCode } from '../../../../src/features/game/domain/game-error.js';
import { MAX_STROKES_PER_TURN } from '../../../../src/features/game/domain/game-rule.js';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import { PhaseType, type Game, type Stroke } from '../../../../src/features/game/domain/phase.js';
import { Reaction } from '../../../../src/features/game/domain/reaction.js';
import { RoomEventType } from '../../../../src/features/game/domain/room-event.js';
import { Room } from '../../../../src/features/game/domain/room.js';
import { Role } from '../../../../src/features/game/domain/role.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { RoomCode } from '../../../../src/shared/domain/room-code.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { NO_POINT_LIMIT, TEST_LIMITS, TEST_OPTION, wholeStroke } from '../../../support/game.js';

const NICK = 'nick' as Nickname;
const uid = (n: number) => n as UserId;
const [A, B, C] = [uid(1), uid(2), uid(3)];
const GAME: Game = { mafiaId: C, category: '장소', keyword: { word: '도시', synonyms: ['시내'] }, turnOrder: [B, A, C] };
const STROKE: Stroke = { x: [1, 2], y: [3, 4], t: [0, 10] };
const CANVAS = { w: 300, h: 400 };
const T0 = 1_000;

function readyUp(room: Room): void {
  for (const player of room.players) {
    if (player.userId !== room.hostId) {
      room.setReady(player.userId, true);
    }
  }
}

function roomOf(count: number): Room {
  const room = Room.create({
    id: 'K7Q2' as RoomCode,
    locale: Locale.Ko,
    isQuickStart: false,
    option: TEST_OPTION,
    hostId: A,
    hostNickname: NICK,
  });
  for (let i = 2; i <= count; i++) {
    room.addPlayer(uid(i), NICK);
  }
  readyUp(room);
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
    expect(codeOf(() => room.drawStroke(A, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, open))).toBe(GameErrorCode.NotYourTurn);
    expect(codeOf(() => room.drawStroke(B, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, now))).toBe(GameErrorCode.InvalidPhase);
    expect(codeOf(() => room.drawStroke(B, wholeStroke(1, STROKE, CANVAS), NO_POINT_LIMIT, open))).toBe(GameErrorCode.InvalidRequest);

    expect(room.drawStroke(B, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, open)).toEqual([
      { type: RoomEventType.StrokeUpdated, drawerId: B, index: 0, from: 0, stroke: STROKE, canvas: CANVAS },
    ]);
    const longer = { x: [1, 2, 3], y: [3, 4, 5], t: [0, 10, 10] };
    room.drawStroke(B, wholeStroke(0, longer, CANVAS), NO_POINT_LIMIT, open);
    room.drawStroke(B, wholeStroke(1, STROKE, CANVAS), NO_POINT_LIMIT, open);
    expect(phase(room, PhaseType.Drawing).current).toEqual({ userId: B, canvas: CANVAS, strokes: [longer, STROKE] });
    // strokesPerTurn is 2 in TEST_OPTION.
    expect(codeOf(() => room.drawStroke(B, wholeStroke(2, STROKE, CANVAS), NO_POINT_LIMIT, open))).toBe(GameErrorCode.InvalidRequest);
  });

  it('writes a piece over the last stroke from its `from`, keeping the points before it', () => {
    const { room } = drawingRoom();
    const open = phase(room, PhaseType.Drawing).turn.drawFrom;
    const piece = (index: number, from: number, points: Stroke) => ({ index, from, points, canvas: null });
    room.drawStroke(B, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, open);

    // Appends after the last point.
    const appended = room.drawStroke(B, piece(0, 2, { x: [5], y: [6], t: [10] }), NO_POINT_LIMIT, open);
    const whole = { x: [1, 2, 5], y: [3, 4, 6], t: [0, 10, 10] };
    expect(appended).toEqual([{ type: RoomEventType.StrokeUpdated, drawerId: B, index: 0, from: 2, stroke: whole, canvas: CANVAS }]);

    // Rewrites the last point, which followed the pen.
    room.drawStroke(B, piece(0, 2, { x: [7, 8], y: [7, 8], t: [20, 5] }), NO_POINT_LIMIT, open);
    expect(phase(room, PhaseType.Drawing).current?.strokes).toEqual([{ x: [1, 2, 7, 8], y: [3, 4, 7, 8], t: [0, 10, 20, 5] }]);

    // A gap, a finished stroke, or a new stroke that does not start at 0 is refused.
    expect(codeOf(() => room.drawStroke(B, piece(0, 5, STROKE), NO_POINT_LIMIT, open))).toBe(GameErrorCode.InvalidRequest);
    room.drawStroke(B, wholeStroke(1, STROKE, CANVAS), NO_POINT_LIMIT, open);
    expect(codeOf(() => room.drawStroke(B, piece(0, 4, STROKE), NO_POINT_LIMIT, open))).toBe(GameErrorCode.InvalidRequest);
    room.undoStroke(B, open);
    expect(codeOf(() => room.drawStroke(B, piece(1, 1, STROKE), NO_POINT_LIMIT, open))).toBe(GameErrorCode.InvalidRequest);
  });

  it('bounds the whole stroke by the points limit, not only the piece', () => {
    const { room } = drawingRoom();
    const open = phase(room, PhaseType.Drawing).turn.drawFrom;
    const max = TEST_LIMITS.maxStrokePoints;
    room.drawStroke(B, wholeStroke(0, STROKE, CANVAS), max, open);
    const piece = (from: number, n: number) => ({
      index: 0,
      from,
      points: { x: Array(n).fill(1), y: Array(n).fill(1), t: Array(n).fill(1) },
      canvas: null,
    });
    room.drawStroke(B, piece(2, max - 2), max, open);
    expect(codeOf(() => room.drawStroke(B, piece(max, 1), max, open))).toBe(GameErrorCode.InvalidRequest);
    expect(phase(room, PhaseType.Drawing).current?.strokes[0]?.x).toHaveLength(max);
  });

  it('keeps the canvas of the sketch when a piece comes without one', () => {
    const { room } = drawingRoom();
    const open = phase(room, PhaseType.Drawing).turn.drawFrom;
    room.drawStroke(B, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, open);
    room.drawStroke(B, { index: 1, from: 0, points: STROKE, canvas: null }, NO_POINT_LIMIT, open);
    expect(phase(room, PhaseType.Drawing).current?.canvas).toEqual(CANVAS);
  });

  it('the drawer clears the sketch once drawing opens, and draws again from index 0', () => {
    const { room, now } = drawingRoom();
    const open = phase(room, PhaseType.Drawing).turn.drawFrom;
    room.drawStroke(B, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, open);
    room.drawStroke(B, wholeStroke(1, STROKE, CANVAS), NO_POINT_LIMIT, open);
    expect(codeOf(() => room.clearSketch(A, open))).toBe(GameErrorCode.NotYourTurn);
    expect(codeOf(() => room.clearSketch(B, now))).toBe(GameErrorCode.InvalidPhase);
    const version = room.version;

    expect(room.clearSketch(B, open)).toEqual([{ type: RoomEventType.SketchCleared, drawerId: B }]);
    expect(phase(room, PhaseType.Drawing).current).toBeNull();
    expect(room.version).toBe(version);
    expect(codeOf(() => room.drawStroke(B, wholeStroke(1, STROKE, CANVAS), NO_POINT_LIMIT, open))).toBe(GameErrorCode.InvalidRequest);
    room.drawStroke(B, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, open);
    expect(phase(room, PhaseType.Drawing).current).toEqual({ userId: B, canvas: CANVAS, strokes: [STROKE] });
    expect(codeOf(() => roomOf(3).clearSketch(A, open))).toBe(GameErrorCode.InvalidPhase);
  });

  it('the drawer undoes the last stroke once drawing opens, and the next stroke takes its index', () => {
    const { room, now } = drawingRoom();
    const open = phase(room, PhaseType.Drawing).turn.drawFrom;
    expect(codeOf(() => room.undoStroke(B, open))).toBe(GameErrorCode.InvalidRequest);
    const first = { x: [1, 2, 3], y: [3, 4, 5], t: [0, 10, 10] };
    room.drawStroke(B, wholeStroke(0, first, CANVAS), NO_POINT_LIMIT, open);
    room.drawStroke(B, wholeStroke(1, STROKE, CANVAS), NO_POINT_LIMIT, open);
    expect(codeOf(() => room.undoStroke(A, open))).toBe(GameErrorCode.NotYourTurn);
    expect(codeOf(() => room.undoStroke(B, now))).toBe(GameErrorCode.InvalidPhase);
    const version = room.version;

    expect(room.undoStroke(B, open)).toEqual([{ type: RoomEventType.StrokeUndone, drawerId: B }]);
    expect(phase(room, PhaseType.Drawing).current).toEqual({ userId: B, canvas: CANVAS, strokes: [first] });
    expect(room.version).toBe(version);
    room.drawStroke(B, wholeStroke(1, STROKE, CANVAS), NO_POINT_LIMIT, open);
    expect(phase(room, PhaseType.Drawing).current).toEqual({ userId: B, canvas: CANVAS, strokes: [first, STROKE] });
    room.undoStroke(B, open);
    room.undoStroke(B, open);
    expect(phase(room, PhaseType.Drawing).current).toBeNull();
    expect(codeOf(() => room.undoStroke(B, open))).toBe(GameErrorCode.InvalidRequest);
  });

  it('ending a turn files the sketch and hands the turn to the next drawer', () => {
    const { room } = drawingRoom();
    const open = phase(room, PhaseType.Drawing).turn.drawFrom;
    room.drawStroke(B, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, open);
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

  it('refuses a vote for a non-player, accepts one for oneself, and lets a voter change their vote', () => {
    const { room } = votingRoom();
    expect(codeOf(() => room.vote(A, uid(99)))).toBe(GameErrorCode.InvalidRequest);
    expect(room.vote(A, A)).toEqual([{ type: RoomEventType.VotesChanged, votes: new Map([[A, A]]) }]);
    room.vote(A, B);
    const events = room.vote(A, C);
    expect(events).toEqual([{ type: RoomEventType.VotesChanged, votes: new Map([[A, C]]) }]);
    expect(phase(room, PhaseType.Vote).votes).toEqual(new Map([[A, C]]));
  });

  it('lets a voter withdraw their vote with a null target', () => {
    const { room } = votingRoom();
    room.vote(A, C);
    room.vote(B, C);
    const events = room.vote(A, null);
    expect(events).toEqual([{ type: RoomEventType.VotesChanged, votes: new Map([[B, C]]) }]);
    expect(room.vote(A, null)).toEqual([{ type: RoomEventType.VotesChanged, votes: new Map([[B, C]]) }]);
  });

  it('keeps the vote open until the deadline even when everyone has voted', () => {
    const { room, now } = votingRoom();
    room.vote(A, C);
    room.vote(B, C);
    expect(room.vote(C, A)).toEqual([{ type: RoomEventType.VotesChanged, votes: new Map([[A, C], [B, C], [C, A]]) }]);
    expect(phase(room, PhaseType.Vote).deadline).toBe(now + TEST_OPTION.voteMs);
  });

  it('a tie accuses nobody, so the mafia wins', () => {
    const { room, now } = votingRoom();
    room.vote(A, C);
    room.vote(C, A);
    room.expire(room.version, now + TEST_OPTION.voteMs);
    expect(phase(room, PhaseType.End).result).toEqual({ mafiaId: C, accusedId: null, mafiaGuess: null, winner: Role.Mafia });
  });

  it('the mafia wins when the vote accuses someone else', () => {
    const { room, now } = votingRoom();
    room.vote(A, B);
    room.vote(C, B);
    room.vote(B, A);
    room.expire(room.version, now + TEST_OPTION.voteMs);
    expect(phase(room, PhaseType.End)).toMatchObject({ result: { accusedId: B, winner: Role.Mafia } });
    expect(room.deadline).toBeNull();
  });

  it('an unfinished vote is tallied at the deadline', () => {
    const { room, now } = votingRoom();
    room.vote(A, C);
    room.expire(room.version, now + TEST_OPTION.voteMs);
    expect(phase(room, PhaseType.Answer)).toMatchObject({ typing: '', deadline: now + TEST_OPTION.voteMs + TEST_OPTION.answerMs });
  });

  function answeringRoom(): { room: Room; now: number } {
    const { room, now: voteFrom } = votingRoom();
    room.vote(A, C);
    room.vote(B, C);
    room.vote(C, A);
    const now = voteFrom + TEST_OPTION.voteMs;
    room.expire(room.version, now);
    phase(room, PhaseType.Answer);
    return { room, now };
  }

  it('only the mafia types and submits; a right guess wins for the mafia', () => {
    const { room, now } = answeringRoom();
    expect(codeOf(() => room.typeAnswer(A, '도시'))).toBe(GameErrorCode.NotYourTurn);
    expect(room.typeAnswer(C, '도')).toEqual([{ type: RoomEventType.AnswerTyped, mafiaId: C, answer: '도' }]);
    expect(phase(room, PhaseType.Answer).typing).toBe('도');
    room.submitAnswer(C, ' 도시 ');
    expect(phase(room, PhaseType.End).result).toEqual({ mafiaId: C, accusedId: C, mafiaGuess: ' 도시 ', winner: Role.Mafia });
  });

  it('a synonym of the keyword also wins for the mafia', () => {
    const { room, now } = answeringRoom();
    room.submitAnswer(C, '시내');
    expect(phase(room, PhaseType.End).result).toMatchObject({ mafiaGuess: '시내', winner: Role.Mafia });
  });

  it('at the answer deadline the last typed answer is judged', () => {
    const { room, now } = answeringRoom();
    room.typeAnswer(C, '바다');
    room.expire(room.version, now);
    expect(phase(room, PhaseType.End).result).toMatchObject({ mafiaGuess: '바다', winner: Role.Citizen });
  });

  it('closing a finished game empties the room back to WAIT', () => {
    const { room, now } = answeringRoom();
    room.submitAnswer(C, '도시');
    expect(room.isOver).toBe(true);
    room.closeGame(now);
    expect(room.phase).toEqual({ type: PhaseType.Wait });
    expect(room.isEmpty).toBe(true);
    expect(room.emptySince).toBe(now);
    expect(room.deadline).toBeNull();
  });

  it('only a finished game can be closed', () => {
    const { room, now } = drawingRoom();
    expect(codeOf(() => room.closeGame(now))).toBe(GameErrorCode.InvalidPhase);
  });

  it('the first player back into an emptied room becomes host', () => {
    const { room, now } = answeringRoom();
    room.submitAnswer(C, '도시');
    room.closeGame(now);
    expect(room.addPlayer(B, NICK)).toEqual([{ type: RoomEventType.PlayersChanged }]);
    room.addPlayer(A, NICK);
    expect(room.hostId).toBe(B);
    expect(room.players.map((p) => p.userId)).toEqual([B, A]);
  });

  it('only a non-host player of a waiting custom room readies up, and the host starts once all are ready', () => {
    const room = roomOf(3);
    room.setReady(C, false);
    expect(room.players.map((p) => p.isReady)).toEqual([false, true, false]);
    expect(room.setReady(C, false)).toEqual([]);
    expect(codeOf(() => room.setReady(A, true))).toBe(GameErrorCode.InvalidRequest);
    expect(codeOf(() => room.setReady(uid(9), true))).toBe(GameErrorCode.NotInRoom);
    expect(codeOf(() => room.start(A, GAME, T0))).toBe(GameErrorCode.NotAllReady);
    expect(room.setReady(C, true)).toEqual([{ type: RoomEventType.PlayersChanged }]);
    room.start(A, GAME, T0);
    expect(codeOf(() => room.setReady(B, false))).toBe(GameErrorCode.InvalidPhase);
  });

  it('a rule change takes everyone back to not ready, and a new host starts not ready', () => {
    const room = roomOf(3);
    room.updateRule(A, { strokesPerTurn: 1, categoryIds: [], keywordLocale: Locale.Ko }, ['animal']);
    expect(room.players.map((p) => p.isReady)).toEqual([false, false, false]);
    readyUp(room);
    room.removePlayer(A, T0);
    expect(room.hostId).toBe(B);
    expect(room.players.map((p) => p.isReady)).toEqual([false, true]);
  });

  it('only the host of a waiting custom room changes the rule, within range and with known categories', () => {
    const room = roomOf(3);
    const ids = ['animal', 'food'];
    expect(room.rule).toEqual({ strokesPerTurn: TEST_OPTION.defaultStrokesPerTurn, categoryIds: [], keywordLocale: Locale.Ko });
    expect(codeOf(() => room.updateRule(B, { strokesPerTurn: 3, categoryIds: [], keywordLocale: Locale.Ko }, ids))).toBe(GameErrorCode.NotHost);
    for (const strokesPerTurn of [0, MAX_STROKES_PER_TURN + 1, 1.5]) {
      expect(codeOf(() => room.updateRule(A, { strokesPerTurn, categoryIds: [], keywordLocale: Locale.Ko }, ids))).toBe(GameErrorCode.InvalidRequest);
    }
    for (const categoryIds of [['unknown'], ['food', 'food']]) {
      expect(codeOf(() => room.updateRule(A, { strokesPerTurn: 1, categoryIds, keywordLocale: Locale.Ko }, ids))).toBe(GameErrorCode.InvalidRequest);
    }

    expect(room.updateRule(A, { strokesPerTurn: null, categoryIds: ['food'], keywordLocale: Locale.Ko }, ids)).toEqual([{ type: RoomEventType.RuleChanged }]);
    expect(room.rule).toEqual({ strokesPerTurn: null, categoryIds: ['food'], keywordLocale: Locale.Ko });
    room.updateRule(A, { strokesPerTurn: 1, categoryIds: ['animal', 'food'], keywordLocale: Locale.Ko }, ids);
    room.updateRule(A, { strokesPerTurn: 1, categoryIds: [], keywordLocale: Locale.Ko }, ids);
    expect(room.rule).toEqual({ strokesPerTurn: 1, categoryIds: [], keywordLocale: Locale.Ko });

    readyUp(room);
    room.start(A, GAME, T0);
    expect(codeOf(() => room.updateRule(A, { strokesPerTurn: 1, categoryIds: [], keywordLocale: Locale.Ko }, ids))).toBe(GameErrorCode.InvalidPhase);
  });

  it('a quick-start room keeps its rule', () => {
    const room = Room.create({ id: 'K7Q2' as RoomCode, locale: Locale.Ko, isQuickStart: true, option: TEST_OPTION, hostId: A, hostNickname: NICK });
    expect(codeOf(() => room.updateRule(A, { strokesPerTurn: 3, categoryIds: [], keywordLocale: Locale.Ko }, ['animal']))).toBe(GameErrorCode.InvalidRequest);
  });

  it('the rule sets how many strokes a turn takes, or none at all', () => {
    const limited = roomOf(3);
    limited.updateRule(A, { strokesPerTurn: 1, categoryIds: [], keywordLocale: Locale.Ko }, ['animal']);
    readyUp(limited);
    limited.start(A, GAME, T0);
    limited.expire(limited.version, T0 + TEST_OPTION.readyMs);
    const open = phase(limited, PhaseType.Drawing).turn.drawFrom;
    limited.drawStroke(B, wholeStroke(0, STROKE, CANVAS), NO_POINT_LIMIT, open);
    expect(codeOf(() => limited.drawStroke(B, wholeStroke(1, STROKE, CANVAS), NO_POINT_LIMIT, open))).toBe(GameErrorCode.InvalidRequest);

    const unlimited = roomOf(3);
    unlimited.updateRule(A, { strokesPerTurn: null, categoryIds: [], keywordLocale: Locale.Ko }, ['animal']);
    readyUp(unlimited);
    unlimited.start(A, GAME, T0);
    unlimited.expire(unlimited.version, T0 + TEST_OPTION.readyMs);
    for (let index = 0; index < 20; index++) {
      unlimited.drawStroke(B, wholeStroke(index, STROKE, CANVAS), NO_POINT_LIMIT, open);
    }
    expect(phase(unlimited, PhaseType.Drawing).current?.strokes).toHaveLength(20);
  });
});
