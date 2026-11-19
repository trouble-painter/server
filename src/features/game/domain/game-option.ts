import { PLAYER_COLORS } from './player-color.js';

export interface GameOption {
  readonly minPlayers: number;
  readonly maxPlayers: number;
}

export const DEFAULT_GAME_OPTION: GameOption = {
  minPlayers: 3,
  // Every player needs a distinct color.
  maxPlayers: PLAYER_COLORS.length,
};
