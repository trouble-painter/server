import type { Role } from '../../domain/role.js';

export interface GameMetrics {
  /** A game finished with a result. */
  gameEnded(winner: Role, isQuickStart: boolean): void;
}
