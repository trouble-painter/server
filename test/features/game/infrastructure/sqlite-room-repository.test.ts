import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhaseType } from '../../../../src/features/game/domain/phase.js';
import { SqliteRoomRepository } from '../../../../src/features/game/infrastructure/sqlite/sqlite-room-repository.js';
import { FakeClock } from '../../../support/fakes.js';
import { A, B, roomsInEveryPhase, waitingRoom } from '../../../support/rooms.js';

const STALE_MS = 600_000;

describe('SqliteRoomRepository', () => {
  let dir: string;
  let path: string;
  let clock: FakeClock;
  let logger: ReturnType<typeof pino>;
  const opened: SqliteRoomRepository[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rooms-'));
    path = join(dir, 'rooms.db');
    clock = new FakeClock();
    logger = pino({ enabled: false });
  });

  afterEach(() => {
    for (const repository of opened.splice(0)) {
      repository.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function open(): SqliteRoomRepository {
    const repository = SqliteRoomRepository.open(path, clock, logger, STALE_MS);
    opened.push(repository);
    return repository;
  }

  /** Closes the current repository and opens the file again, as a restart would. */
  function reopen(repository: SqliteRoomRepository): SqliteRoomRepository {
    repository.close();
    opened.splice(opened.indexOf(repository), 1);
    return open();
  }

  it('round-trips a room in every phase through the file', () => {
    for (const type of Object.values(PhaseType)) {
      const room = roomsInEveryPhase()[type];
      const first = open();
      first.save(room);
      const second = reopen(first);
      expect(second.get(room.id)?.toSnapshot()).toEqual(room.toSnapshot());
      expect(second.findByUser(A)?.id).toBe(room.id);
      second.delete(room);
      reopen(second);
    }
  });

  it('forgets a deleted room and follows players who left', () => {
    const repository = open();
    const kept = waitingRoom('AAAA');
    const gone = waitingRoom('BBBB');
    repository.save(gone);
    repository.save(kept);
    kept.removePlayer(B, clock.now());
    repository.save(kept);
    repository.delete(gone);

    const reopened = reopen(repository);
    expect(reopened.all().map((r) => r.id)).toEqual(['AAAA']);
    expect(reopened.findByUser(A)?.id).toBe('AAAA');
    expect(reopened.findByUser(B)).toBeNull();
  });

  it('drops rooms nobody has touched for the stale time', () => {
    const repository = open();
    repository.save(waitingRoom('AAAA'));
    clock.time += 1;
    repository.save(waitingRoom('BBBB'));
    clock.time += STALE_MS;

    const reopened = reopen(repository);
    expect(reopened.all().map((r) => r.id)).toEqual(['BBBB']);
    const db = new DatabaseSync(path);
    expect(db.prepare('SELECT COUNT(*) AS n FROM rooms').get()).toEqual({ n: 1 });
    db.close();
  });

  it('drops rows it cannot read and warns', () => {
    const repository = open();
    repository.save(waitingRoom('AAAA'));
    repository.close();
    opened.splice(0);
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO rooms VALUES (?, ?, ?)').run('BBBB', '{"v":1}', clock.now());
    db.prepare('INSERT INTO rooms VALUES (?, ?, ?)').run('CCCC', 'not json', clock.now());
    db.close();
    const warn = vi.spyOn(logger, 'warn');

    const reopened = open();
    expect(reopened.all().map((r) => r.id)).toEqual(['AAAA']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('reads a room saved before rules existed with the default rule', () => {
    const repository = open();
    const room = waitingRoom('AAAA');
    repository.close();
    opened.splice(0);
    const { rule: _rule, option: { defaultStrokesPerTurn, ...option }, ...rest } = room.toSnapshot();
    const v1 = { ...rest, v: 1, option: { ...option, strokesPerTurn: defaultStrokesPerTurn } };
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO rooms VALUES (?, ?, ?)').run('AAAA', JSON.stringify(v1), clock.now());
    db.close();

    const restored = open().get(room.id)!;
    expect(restored.toSnapshot()).toEqual(room.toSnapshot());
  });

  it('reads a room saved before the rule had a keyword locale with the room locale', () => {
    const repository = open();
    const room = waitingRoom('AAAA');
    repository.close();
    opened.splice(0);
    const { rule: { keywordLocale: _keywordLocale, ...rule }, ...rest } = room.toSnapshot();
    const v2 = { ...rest, v: 2, rule };
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO rooms VALUES (?, ?, ?)').run('AAAA', JSON.stringify(v2), clock.now());
    db.close();

    const restored = open().get(room.id)!;
    expect(restored.toSnapshot()).toEqual(room.toSnapshot());
  });

  it('keeps the room in memory and logs when a write fails', () => {
    const repository = open();
    const error = vi.spyOn(logger, 'error');
    const db = new DatabaseSync(path);
    db.exec('DROP TABLE rooms');
    db.close();

    const room = waitingRoom();
    repository.save(room);
    expect(repository.get(room.id)).toBe(room);
    expect(error).toHaveBeenCalledOnce();
  });

  it('refuses a database written by a newer schema', () => {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => open()).toThrow(/newer/);
  });
});
