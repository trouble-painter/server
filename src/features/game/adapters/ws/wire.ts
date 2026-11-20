import { z } from 'zod';
import { WireErrorCode } from '../../../../shared/adapters/ws/protocol.js';
import type { ErrorMapper } from '../../../../shared/adapters/ws/router.js';
import { GameError, GameErrorCode } from '../../domain/game-error.js';
import { PhaseType } from '../../domain/phase.js';
import { PlayerColor } from '../../domain/player-color.js';
import { Reaction } from '../../domain/reaction.js';
import { Role } from '../../domain/role.js';

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
  [PhaseType.Ready]: 'READY',
  [PhaseType.Drawing]: 'DRAWING',
  [PhaseType.Vote]: 'VOTE',
  [PhaseType.Answer]: 'ANSWER',
  [PhaseType.End]: 'END',
};

export const ROLE_WIRE: Record<Role, string> = {
  [Role.Mafia]: 'MAFIA',
  [Role.Citizen]: 'CITIZEN',
};

export const REACTION_WIRE: Record<Reaction, string> = {
  [Reaction.Hamster]: 'HAMSTER',
  [Reaction.Bear]: 'BEAR',
  [Reaction.Heart]: 'HEART',
  [Reaction.Poop]: 'POOP',
  [Reaction.Best]: 'BEST',
  [Reaction.Question]: 'QUESTION',
};

const REACTION_FROM_WIRE = new Map(Object.entries(REACTION_WIRE).map(([reaction, wire]) => [wire, reaction as Reaction]));

export const ReactionSchema = z
  .string()
  .refine((wire) => REACTION_FROM_WIRE.has(wire))
  .transform((wire) => REACTION_FROM_WIRE.get(wire) as Reaction);

const GAME_ERROR_WIRE: Record<GameErrorCode, WireErrorCode> = {
  [GameErrorCode.RoomNotFound]: WireErrorCode.RoomNotFound,
  [GameErrorCode.RoomFull]: WireErrorCode.RoomFull,
  [GameErrorCode.RoomInGame]: WireErrorCode.RoomInGame,
  [GameErrorCode.AlreadyInGame]: WireErrorCode.AlreadyInGame,
  [GameErrorCode.NotInRoom]: WireErrorCode.NotInRoom,
  [GameErrorCode.NotHost]: WireErrorCode.NotHost,
  [GameErrorCode.NotEnoughPlayers]: WireErrorCode.NotEnoughPlayers,
  [GameErrorCode.NotAllReady]: WireErrorCode.NotAllReady,
  [GameErrorCode.InvalidPhase]: WireErrorCode.InvalidPhase,
  [GameErrorCode.NotYourTurn]: WireErrorCode.NotYourTurn,
  [GameErrorCode.InvalidRequest]: WireErrorCode.InvalidRequest,
};

export const mapGameError: ErrorMapper = (error) => (error instanceof GameError ? GAME_ERROR_WIRE[error.code] : null);
