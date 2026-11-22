import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { GameHistoryRepository } from '../../application/ports/game-history-repository.js';
import type { GameRecord, HistoryEvent } from '../../domain/game-history.js';
import { openDatabase } from './sqlite-database.js';

interface ErrorLogger {
  error(context: object, message: string): void;
}

/** One `games` row per game and one `game_events` row per event; a game is written whole or not at all. */
export class SqliteGameHistoryRepository implements GameHistoryRepository {
  private readonly insertGame: StatementSync;
  private readonly insertEvent: StatementSync;

  private constructor(
    private readonly db: DatabaseSync,
    private readonly logger: ErrorLogger,
  ) {
    this.insertGame = db.prepare('INSERT INTO games (room_id, started_at, ended_at, winner, meta) VALUES (?, ?, ?, ?, ?)');
    this.insertEvent = db.prepare('INSERT INTO game_events (game_id, seq, at, type, payload) VALUES (?, ?, ?, ?, ?)');
  }

  static open(path: string, logger: ErrorLogger): SqliteGameHistoryRepository {
    return new SqliteGameHistoryRepository(openDatabase(path), logger);
  }

  save(record: GameRecord): void {
    try {
      this.db.exec('BEGIN');
      try {
        this.write(record);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      this.logger.error({ err: error, roomId: record.roomId }, 'failed to persist game history');
    }
  }

  close(): void {
    this.db.close();
  }

  private write(record: GameRecord): void {
    const { lastInsertRowid } = this.insertGame.run(
      record.roomId,
      record.startedAt,
      record.endedAt,
      record.winner,
      JSON.stringify(record.meta),
    );
    record.events.forEach((event, seq) => {
      const { type, at, ...payload } = event satisfies HistoryEvent;
      this.insertEvent.run(lastInsertRowid, seq, at, type, JSON.stringify(payload));
    });
  }
}
