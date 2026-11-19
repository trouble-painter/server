import { IdleReason, localeToWire, ServerMessageType, type ServerMessage } from '../../../../shared/adapters/ws/protocol.js';
import type { Phase } from '../../domain/phase.js';
import type { Player, Room } from '../../domain/room.js';
import { PHASE_WIRE, PLAYER_COLOR_WIRE } from './wire.js';

/** The single place a room becomes its wire form, for HELLO, ROOM and patches alike. */
function roomView(room: Room) {
  return {
    id: room.id,
    locale: localeToWire(room.locale),
    isQuickStart: room.isQuickStart,
    hostId: room.hostId,
    players: room.players.map(playerView),
    option: { minPlayers: room.option.minPlayers, maxPlayers: room.option.maxPlayers },
    phase: phaseView(room.phase),
  };
}

function playerView(player: Readonly<Player>) {
  return {
    id: player.userId,
    nickname: player.nickname,
    color: PLAYER_COLOR_WIRE[player.color],
    isConnected: player.isConnected,
  };
}

function phaseView(phase: Phase) {
  return { type: PHASE_WIRE[phase.type] };
}

export function helloMessage(serverTime: number, room: Room | null): ServerMessage {
  return {
    type: ServerMessageType.Hello,
    // TODO(M3): fill limits; TODO(M5): fill matching.
    data: { serverTime, limits: {}, room: room === null ? null : roomView(room), matching: null },
  };
}

export function roomMessage(room: Room): ServerMessage {
  return { type: ServerMessageType.Room, data: { room: roomView(room) } };
}

export function playersMessage(room: Room): ServerMessage {
  return { type: ServerMessageType.Players, data: { players: room.players.map(playerView), hostId: room.hostId } };
}

export function idleMessage(reason: IdleReason): ServerMessage {
  return { type: ServerMessageType.Idle, data: { reason } };
}
