import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { BaseLogger } from 'pino';
import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { RoomCode } from '../../../../shared/domain/room-code.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { RoomRepository } from '../../application/ports/room-repository.js';
import { Room } from '../../domain/room.js';
import { MemoryRoomRepository } from '../memory/memory-room-repository.js';
import { RoomSnapshotSchema } from './room-snapshot-schema.js';

/** Raise when the table layout changes, and migrate from the previous one in {@link migrate}. */
const SCHEMA_VERSION = 1;

interface RoomRow {
  room_id: string;
  state: string;
  updated_at: number;
}

type Logger = Pick<BaseLogger, 'info' | 'warn' | 'error'>;

/**
 * Rooms live in memory; every save is also written through to SQLite so they can be loaded
 * again after a restart. A failed write is logged and the room carries on in memory.
 */
export class SqliteRoomRepository implements RoomRepository {
  private readonly memory = new MemoryRoomRepository();
  private readonly upsert: StatementSync;
  private readonly remove: StatementSync;

  private constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {
    this.upsert = db.prepare(
      `INSERT INTO rooms (room_id, state, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    );
    this.remove = db.prepare('DELETE FROM rooms WHERE room_id = ?');
  }

  /** Opens (or creates) the database and loads its rooms; rows untouched for `staleAfterMs` are dropped. */
  static open(path: string, clock: Clock, logger: Logger, staleAfterMs: number): SqliteRoomRepository {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrate(db);
    const repository = new SqliteRoomRepository(db, clock, logger);
    repository.load(clock.now() - staleAfterMs);
    return repository;
  }

  get(id: RoomCode): Room | null {
    return this.memory.get(id);
  }

  findByUser(userId: UserId): Room | null {
    return this.memory.findByUser(userId);
  }

  all(): readonly Room[] {
    return this.memory.all();
  }

  save(room: Room): void {
    this.memory.save(room);
    this.write(room.id, () => this.upsert.run(room.id, JSON.stringify(room.toSnapshot()), this.clock.now()));
  }

  delete(room: Room): void {
    this.memory.delete(room);
    this.write(room.id, () => this.remove.run(room.id));
  }

  close(): void {
    this.db.close();
  }

  private load(staleBefore: number): void {
    const rows = this.db.prepare('SELECT room_id, state, updated_at FROM rooms').all() as unknown as RoomRow[];
    for (const row of rows) {
      if (row.updated_at < staleBefore) {
        this.logger.info({ roomId: row.room_id }, 'dropping stale saved room');
        this.remove.run(row.room_id);
        continue;
      }
      const snapshot = RoomSnapshotSchema.safeParse(parseJson(row.state));
      if (!snapshot.success) {
        this.logger.warn({ roomId: row.room_id, err: snapshot.error }, 'dropping unreadable saved room');
        this.remove.run(row.room_id);
        continue;
      }
      this.memory.save(Room.fromSnapshot(snapshot.data));
    }
    this.logger.info({ rooms: this.memory.all().length }, 'rooms loaded');
  }

  private write(roomId: RoomCode, run: () => unknown): void {
    try {
      run();
    } catch (error) {
      this.logger.error({ err: error, roomId }, 'failed to persist room');
    }
  }
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
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
