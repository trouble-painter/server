import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeSnapshot } from '../../src/backup/snapshot.js';
import { openDatabase } from '../../src/features/game/infrastructure/sqlite/sqlite-database.js';

describe('writeSnapshot', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'snapshot-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies the game history without rooms while the source stays open and unflushed', () => {
    const source = openDatabase(join(dir, 'rooms.db'));
    source.exec(`
      INSERT INTO rooms VALUES ('ROOM1', '{}', 1);
      INSERT INTO games (room_id, started_at, ended_at, winner, meta) VALUES ('ROOM1', 1, 2, 'CITIZEN', '{}');
      INSERT INTO game_events VALUES (1, 0, 0, 'VOTE', '{}');
    `);
    const snapshotPath = join(dir, 'snapshot.db');

    writeSnapshot(join(dir, 'rooms.db'), snapshotPath);

    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    const tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    expect(tables.map((row) => row.name).sort()).toEqual(['game_events', 'games']);
    expect(snapshot.prepare('SELECT room_id FROM games').all()).toEqual([{ room_id: 'ROOM1' }]);
    expect(snapshot.prepare('SELECT type FROM game_events').all()).toEqual([{ type: 'VOTE' }]);
    expect(snapshot.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    snapshot.close();
    source.close();
  });

  it('leaves a single file next to the snapshot', () => {
    openDatabase(join(dir, 'rooms.db')).close();
    writeSnapshot(join(dir, 'rooms.db'), join(dir, 'snapshot.db'));
    expect(readdirSync(dir).filter((name) => name.startsWith('snapshot.db'))).toEqual(['snapshot.db']);
  });
});
