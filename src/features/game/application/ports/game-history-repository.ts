import type { GameRecord } from '../../domain/game-history.js';

export interface GameHistoryRepository {
  /** Keeps a finished game. A failed save is the repository's to log: it must not disturb the game. */
  save(record: GameRecord): void;
}
