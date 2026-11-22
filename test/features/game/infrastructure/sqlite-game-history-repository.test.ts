import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameRecorder } from '../../../../src/features/game/application/game-recorder.js';
import { HistoryEventType, type GameRecord } from '../../../../src/features/game/domain/game-history.js';
import { SqliteGameHistoryRepository } from '../../../../src/features/game/infrastructure/sqlite/sqlite-game-history-repository.js';
import { SqliteRoomRepository } from '../../../../src/features/game/infrastructure/sqlite/sqlite-room-repository.js';
import { Role } from '../../../../src/features/game/domain/role.js';
import { FakeClock, RecordingMetrics } from '../../../support/fakes.js';
import { NO_POINT_LIMIT, wholeStroke } from '../../../support/game.js';
import { A, C, GAME, T0, waitingRoom } from '../../../support/rooms.js';

interface GameRow {
  id: number;
  room_id: string;
  started_at: number;
  ended_at: number;
  winner: string;
  meta: string;
}

interface EventRow {
  game_id: number;
  seq: number;
  at: number;
  type: string;
  payload: string;
}

describe('SqliteGameHistoryRepository', () => {
  let dir: string;
  let path: string;
  let history: SqliteGameHistoryRepository;
  const logs: object[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'history-'));
    path = join(dir, 'rooms.db');
    logs.length = 0;
    history = SqliteGameHistoryRepository.open(path, { error: (context) => logs.push(context) });
  });

  afterEach(() => {
    history.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A finished game, played through the recorder so the record is what the server really produces. */
  function playedGame(): GameRecord {
    const saved: GameRecord[] = [];
    const clock = new FakeClock(T0);
    const recorder = new GameRecorder({ save: (record) => saved.push(record) }, clock, new RecordingMetrics());
    const room = waitingRoom();
    recorder.record(room, room.start(A, GAME, T0));
    clock.time = T0 + 5_000;
    recorder.record(room, room.expire(room.version, clock.now()));
    clock.time = (room.phase as { turn: { drawFrom: number } }).turn.drawFrom + 100;
    const stroke = wholeStroke(0, { x: [1, 2], y: [3, 4], t: [700, 20] }, { w: 300, h: 400 });
    recorder.record(room, room.drawStroke(GAME.turnOrder[0]!, stroke, NO_POINT_LIMIT, clock.now()));
    clock.time += 300;
    recorder.record(room, room.undoStroke(GAME.turnOrder[0]!, clock.now()));
    while (room.phase.type === 'drawing') {
      clock.time = room.deadline!;
      recorder.record(room, room.expire(room.version, clock.now()));
    }
    recorder.record(room, room.vote(A, C));
    clock.time = room.deadline!;
    recorder.record(room, room.expire(room.version, clock.now()));
    clock.time += 1_000;
    recorder.record(room, room.submitAnswer(C, '도시'));
    return saved[0]!;
  }

  function read<T>(sql: string): T[] {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db.prepare(sql).all() as unknown as T[];
    } finally {
      db.close();
    }
  }

  it('keeps a game and its events in order', () => {
    const record = playedGame();
    history.save(record);

    const [game] = read<GameRow>('SELECT * FROM games');
    expect(game).toMatchObject({
      room_id: record.roomId,
      started_at: record.startedAt,
      ended_at: record.endedAt,
      winner: Role.Mafia,
    });
    expect(JSON.parse(game!.meta)).toEqual(JSON.parse(JSON.stringify(record.meta)));

    const events = read<EventRow>('SELECT * FROM game_events ORDER BY seq');
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(events.map((e) => e.type)).toEqual(record.events.map((e) => e.type));
    expect(events.map((e) => e.at)).toEqual(record.events.map((e) => e.at));
    const stroke = events.find((e) => e.type === HistoryEventType.Stroke)!;
    expect(JSON.parse(stroke.payload)).toMatchObject({ index: 0, stroke: { t: [700, 20] }, canvas: { w: 300, h: 400 } });
    expect(JSON.parse(stroke.payload)).not.toHaveProperty('type');
    expect(JSON.parse(stroke.payload)).not.toHaveProperty('at');
  });

  it('keeps each game apart', () => {
    history.save(playedGame());
    history.save(playedGame());

    const games = read<GameRow>('SELECT id FROM games ORDER BY id');
    expect(games).toHaveLength(2);
    const counts = read<{ game_id: number; n: number }>('SELECT game_id, COUNT(*) AS n FROM game_events GROUP BY game_id');
    expect(counts.map((c) => c.game_id)).toEqual(games.map((g) => g.id));
    expect(counts[0]!.n).toBe(counts[1]!.n);
  });

  it('shares the file with the room repository', () => {
    const rooms = SqliteRoomRepository.open(path, new FakeClock(T0), { info: () => {}, warn: () => {}, error: () => {} }, 600_000);
    try {
      rooms.save(waitingRoom());
      history.save(playedGame());
      expect(read('SELECT * FROM rooms')).toHaveLength(1);
      expect(read('SELECT * FROM games')).toHaveLength(1);
    } finally {
      rooms.close();
    }
  });

  it('logs a failed save and leaves no half-written game', () => {
    const record = playedGame();
    const broken = { ...record, events: [{ ...record.events[0]!, at: Number.NaN }, { ...record.events[1]!, payload: 1n }] } as unknown as GameRecord;

    expect(() => history.save(broken)).not.toThrow();

    expect(logs).toHaveLength(1);
    expect(read('SELECT * FROM games')).toHaveLength(0);
    expect(read('SELECT * FROM game_events')).toHaveLength(0);
    history.save(record);
    expect(read('SELECT * FROM games')).toHaveLength(1);
  });

  it('reopens a database written before game history existed', () => {
    history.close();
    const db = new DatabaseSync(path);
    db.exec('DROP TABLE game_events; DROP TABLE games; PRAGMA user_version = 1;');
    db.close();

    history = SqliteGameHistoryRepository.open(path, { error: () => {} });
    history.save(playedGame());
    expect(read('SELECT * FROM games')).toHaveLength(1);
  });
});
