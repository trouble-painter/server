import { WireErrorCode } from '../../../../shared/adapters/ws/protocol.js';
import type { ErrorMapper } from '../../../../shared/adapters/ws/router.js';
import { GameError, GameErrorCode } from '../../domain/game-error.js';
import { PhaseType } from '../../domain/phase.js';
import { PlayerColor } from '../../domain/player-color.js';

export const PLAYER_COLOR_WIRE: Record<PlayerColor, string> = {
  [PlayerColor.Red]: 'RED',
  [PlayerColor.Orange]: 'ORANGE',
  [PlayerColor.Yellow]: 'YELLOW',
  [PlayerColor.LightGreen]: 'LIGHT_GREEN',
  [PlayerColor.Green]: 'GREEN',
  [PlayerColor.LightBlue]: 'LIGHT_BLUE',
  [PlayerColor.Blue]: 'BLUE',
  [PlayerColor.Purple]: 'PURPLE',
  [PlayerColor.Pink]: 'PINK',
  [PlayerColor.Gray]: 'GRAY',
};

export const PHASE_WIRE: Record<PhaseType, string> = {
  [PhaseType.Wait]: 'WAIT',
};

const GAME_ERROR_WIRE: Record<GameErrorCode, WireErrorCode> = {
  [GameErrorCode.RoomNotFound]: WireErrorCode.RoomNotFound,
  [GameErrorCode.RoomFull]: WireErrorCode.RoomFull,
  [GameErrorCode.RoomInGame]: WireErrorCode.RoomInGame,
  [GameErrorCode.AlreadyInGame]: WireErrorCode.AlreadyInGame,
  [GameErrorCode.NotInRoom]: WireErrorCode.NotInRoom,
};

export const mapGameError: ErrorMapper = (error) => (error instanceof GameError ? GAME_ERROR_WIRE[error.code] : null);
