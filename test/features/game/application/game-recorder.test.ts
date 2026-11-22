import { beforeEach, describe, expect, it } from 'vitest';
import { GameRecorder } from '../../../../src/features/game/application/game-recorder.js';
import type { GameHistoryRepository } from '../../../../src/features/game/application/ports/game-history-repository.js';
import { HistoryEventType, type GameRecord } from '../../../../src/features/game/domain/game-history.js';
import { PhaseType, type Stroke } from '../../../../src/features/game/domain/phase.js';
import { Reaction } from '../../../../src/features/game/domain/reaction.js';
import type { RoomEvent } from '../../../../src/features/game/domain/room-event.js';
import type { Room } from '../../../../src/features/game/domain/room.js';
import { Role } from '../../../../src/features/game/domain/role.js';
import { FakeClock } from '../../../support/fakes.js';
import { TEST_OPTION } from '../../../support/game.js';
import { A, B, C, GAME, T0, waitingRoom } from '../../../support/rooms.js';

const CANVAS = { w: 300, h: 400 };

class SavedGames implements GameHistoryRepository {
  readonly records: GameRecord[] = [];

  save(record: GameRecord): void {
    this.records.push(record);
  }
}

function stroke(points: number): Stroke {
  return {
    x: Array.from({ length: points }, (_, i) => i),
    y: Array.from({ length: points }, (_, i) => i * 2),
    t: Array.from({ length: points }, (_, i) => (i === 0 ? 700 : 20)),
  };
}

describe('GameRecorder', () => {
  let history: SavedGames;
  let clock: FakeClock;
  let recorder: GameRecorder;
  let room: Room;

  beforeEach(() => {
    history = new SavedGames();
    clock = new FakeClock(T0);
    recorder = new GameRecorder(history, clock);
    room = waitingRoom();
  });

  /** Runs `act` at `ms` after the game started and records what it raised, as the publisher would. */
  function at(ms: number, act: () => RoomEvent[]): void {
    clock.time = T0 + ms;
    recorder.record(room, act());
  }

  const startAt = TEST_OPTION.readyMs;

  function startGame(): void {
    at(0, () => room.start(A, GAME, clock.now()));
    at(startAt, () => room.expire(room.version, clock.now()));
  }

  function savedEvents() {
    return history.records[0]?.events ?? [];
  }

  /** Plays every remaining turn out by its deadline, then returns the time it ended. */
  function expireTurns(): number {
    while (room.phase.type === PhaseType.Drawing) {
      const deadline = room.deadline!;
      at(deadline - T0, () => room.expire(room.version, deadline));
    }
    return clock.now() - T0;
  }

  /** Lets the vote run out with no votes, which ends the game. */
  function finish(): void {
    const voteAt = expireTurns();
    at(voteAt + TEST_OPTION.voteMs, () => room.expire(room.version, clock.now()));
  }

  it('records nothing for a game it did not see start', () => {
    room.start(A, GAME, T0);
    room.expire(room.version, T0 + startAt);
    expireTurns();
    at(clock.now() - T0 + 1_000, () => room.vote(A, C));
    at(clock.now() - T0 + TEST_OPTION.voteMs, () => room.expire(room.version, clock.now()));
    at(clock.now() - T0 + 100, () => room.submitAnswer(C, '도시'));
    expect(history.records).toEqual([]);
  });

  it('saves who played, with what rule and what word, once the result is out', () => {
    startGame();
    const voteAt = expireTurns();
    at(voteAt + 1_000, () => room.vote(A, C));
    at(voteAt + 2_000, () => room.vote(B, C));
    at(voteAt + TEST_OPTION.voteMs, () => room.expire(room.version, clock.now()));
    at(voteAt + TEST_OPTION.voteMs + 3_000, () => room.submitAnswer(C, '도시'));

    expect(history.records).toHaveLength(1);
    const record = history.records[0]!;
    expect(record.roomId).toBe(room.id);
    expect(record.startedAt).toBe(T0);
    expect(record.endedAt).toBe(clock.now());
    expect(record.winner).toBe(Role.Mafia);
    expect(record.meta.game).toEqual(GAME);
    expect(record.meta.rule).toEqual(room.rule);
    expect(record.meta.option).toEqual(TEST_OPTION);
    expect(record.meta.players.map((p) => [p.userId, p.nickname])).toEqual([
      [A, 'A'],
      [B, 'B'],
      [C, 'C'],
    ]);
  });

  it('records every turn with its time on the game clock', () => {
    startGame();
    finish();

    const turns = savedEvents().filter((e) => e.type === HistoryEventType.Turn);
    expect(turns.map((t) => t.drawerId)).toEqual([B, A, C, B, A, C]);
    const first = turns[0]!;
    expect(first.at).toBe(startAt);
    expect(first.drawFromAt).toBeGreaterThan(first.at);
    expect(first.deadlineAt).toBeGreaterThan(first.drawFromAt);
  });

  it('keeps the last version of a stroke as one entry timed from its first to its last update', () => {
    startGame();
    const drawFrom = (room.phase as { turn: { drawFrom: number } }).turn.drawFrom - T0;
    at(drawFrom + 100, () => room.drawStroke(B, 0, stroke(2), CANVAS, clock.now()));
    at(drawFrom + 150, () => room.drawStroke(B, 0, stroke(4), CANVAS, clock.now()));
    at(drawFrom + 400, () => room.drawStroke(B, 0, stroke(8), CANVAS, clock.now()));
    at(drawFrom + 900, () => room.drawStroke(B, 1, stroke(3), CANVAS, clock.now()));
    finish();

    const strokes = savedEvents().filter((e) => e.type === HistoryEventType.Stroke);
    expect(strokes).toHaveLength(2);
    expect(strokes[0]).toEqual({
      type: HistoryEventType.Stroke,
      at: drawFrom + 100,
      endAt: drawFrom + 400,
      drawerId: B,
      index: 0,
      stroke: stroke(8),
      canvas: CANVAS,
    });
    expect(strokes[1]).toMatchObject({ at: drawFrom + 900, endAt: drawFrom + 900, index: 1, stroke: stroke(3) });
  });

  it('records an undo and the stroke drawn again at the same index', () => {
    startGame();
    const drawFrom = (room.phase as { turn: { drawFrom: number } }).turn.drawFrom - T0;
    at(drawFrom + 100, () => room.drawStroke(B, 0, stroke(3), CANVAS, clock.now()));
    at(drawFrom + 500, () => room.undoStroke(B, clock.now()));
    at(drawFrom + 800, () => room.drawStroke(B, 0, stroke(5), CANVAS, clock.now()));
    at(drawFrom + 1_200, () => room.clearSketch(B, clock.now()));
    finish();

    const drawing = savedEvents().filter((e) =>
      [HistoryEventType.Stroke, HistoryEventType.StrokeUndone, HistoryEventType.SketchCleared].includes(e.type),
    );
    expect(drawing.map((e) => [e.type, e.at])).toEqual([
      [HistoryEventType.Stroke, drawFrom + 100],
      [HistoryEventType.StrokeUndone, drawFrom + 500],
      [HistoryEventType.Stroke, drawFrom + 800],
      [HistoryEventType.SketchCleared, drawFrom + 1_200],
    ]);
  });

  it('keeps events in the order they happened, flushing a stroke before the next event', () => {
    startGame();
    const drawFrom = (room.phase as { turn: { drawFrom: number } }).turn.drawFrom - T0;
    at(drawFrom + 100, () => room.drawStroke(B, 0, stroke(3), CANVAS, clock.now()));
    at(drawFrom + 200, () => room.react(A, Reaction.Heart));
    finish();

    const types = savedEvents().map((e) => e.type);
    expect(types.indexOf(HistoryEventType.Stroke)).toBeLessThan(types.indexOf(HistoryEventType.Reaction));
    const times = savedEvents().map((e) => e.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('records votes, the mafia typing, the phases and the result', () => {
    startGame();
    const voteAt = expireTurns();
    at(voteAt + 1_000, () => room.vote(A, C));
    at(voteAt + 2_000, () => room.vote(B, C));
    at(voteAt + TEST_OPTION.voteMs, () => room.expire(room.version, clock.now()));
    const answerAt = clock.now() - T0;
    at(answerAt + 500, () => room.typeAnswer(C, '도'));
    at(answerAt + 3_000, () => room.submitAnswer(C, '바다'));

    const events = savedEvents().filter((e) => e.type !== HistoryEventType.Turn);
    expect(events.map((e) => e.type)).toEqual([
      HistoryEventType.Phase,
      HistoryEventType.Votes,
      HistoryEventType.Votes,
      HistoryEventType.Phase,
      HistoryEventType.Answer,
      HistoryEventType.Result,
    ]);
    expect(events[0]).toMatchObject({ phase: PhaseType.Vote, at: voteAt, deadlineAt: voteAt + TEST_OPTION.voteMs });
    expect(events[2]).toMatchObject({
      votes: [
        [A, C],
        [B, C],
      ],
    });
    expect(events[3]).toMatchObject({ phase: PhaseType.Answer });
    expect(events[4]).toMatchObject({ mafiaId: C, answer: '도', at: answerAt + 500 });
    expect(events[5]).toMatchObject({
      result: { mafiaId: C, accusedId: C, mafiaGuess: '바다', winner: Role.Citizen },
      at: answerAt + 3_000,
    });
    expect(history.records[0]?.winner).toBe(Role.Citizen);
  });
});
