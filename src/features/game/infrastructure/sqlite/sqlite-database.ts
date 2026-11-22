import { DatabaseSync } from 'node:sqlite';

/** Raise when the table layout changes, and migrate from the previous one in {@link migrate}. */
const SCHEMA_VERSION = 2;

/** How long a write waits for another connection to the same file before it fails. */
const BUSY_TIMEOUT_MS = 5_000;

/** Opens (or creates) the database file at the current schema; the room and the game history repositories each open it. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version > SCHEMA_VERSION) {
    throw new Error(`Room database schema ${version} is newer than this server (${SCHEMA_VERSION})`);
  }
  if (version < 1) {
    db.exec(`
      CREATE TABLE rooms (
        room_id    TEXT PRIMARY KEY,
        state      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `);
  }
  if (version < 2) {
    db.exec(`
      CREATE TABLE games (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id    TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER NOT NULL,
        winner     TEXT NOT NULL,
        meta       TEXT NOT NULL
      ) STRICT;
      CREATE TABLE game_events (
        game_id INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
        seq     INTEGER NOT NULL,
        at      INTEGER NOT NULL,
        type    TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (game_id, seq)
      ) STRICT;
      PRAGMA user_version = 2;
    `);
  }
}
