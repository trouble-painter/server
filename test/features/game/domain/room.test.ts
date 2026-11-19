import { describe, expect, it } from 'vitest';
import { GameError, GameErrorCode } from '../../../../src/features/game/domain/game-error.js';
import { DEFAULT_GAME_OPTION } from '../../../../src/features/game/domain/game-option.js';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import { PLAYER_COLORS, PlayerColor } from '../../../../src/features/game/domain/player-color.js';
import { Room } from '../../../../src/features/game/domain/room.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { RoomCode } from '../../../../src/shared/domain/room-code.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';

const NICK = 'nick' as Nickname;
const uid = (n: number) => n as UserId;

function newRoom(): Room {
  return Room.create({
    id: 'K7Q2ZP' as RoomCode,
    locale: Locale.Ko,
    isQuickStart: false,
    option: DEFAULT_GAME_OPTION,
    hostId: uid(1),
    hostNickname: NICK,
  });
}

function expectGameError(run: () => unknown, code: GameErrorCode): void {
  expect(run).toThrow(GameError);
  try {
    run();
  } catch (error) {
    expect((error as GameError).code).toBe(code);
  }
}

describe('Room', () => {
  it('starts with the host connected and colored first', () => {
    const room = newRoom();
    expect(room.hostId).toBe(1);
    expect(room.players).toEqual([{ userId: 1, nickname: NICK, color: PlayerColor.Red, isConnected: true }]);
    expect(room.isInGame).toBe(false);
  });

  it('gives each joiner the first unused color, reusing a freed one', () => {
    const room = newRoom();
    room.addPlayer(uid(2), NICK);
    room.addPlayer(uid(3), NICK);
    room.removePlayer(uid(2), 0);
    room.addPlayer(uid(4), NICK);
    expect(room.players.map((p) => [p.userId, p.color])).toEqual([
      [1, PlayerColor.Red],
      [3, PlayerColor.Yellow],
      [4, PlayerColor.Orange],
    ]);
  });

  it('refuses a joiner beyond maxPlayers', () => {
    const room = newRoom();
    for (let i = 2; i <= DEFAULT_GAME_OPTION.maxPlayers; i++) {
      room.addPlayer(uid(i), NICK);
    }
    expect(DEFAULT_GAME_OPTION.maxPlayers).toBe(PLAYER_COLORS.length);
    expectGameError(() => room.addPlayer(uid(99), NICK), GameErrorCode.RoomFull);
  });

  it('hands the host role to the earliest remaining joiner', () => {
    const room = newRoom();
    room.addPlayer(uid(2), NICK);
    room.addPlayer(uid(3), NICK);
    room.removePlayer(uid(1), 0);
    expect(room.hostId).toBe(2);
    room.removePlayer(uid(3), 0);
    expect(room.hostId).toBe(2);
  });

  it('reports a change only when something changed', () => {
    const room = newRoom();
    expect(room.setConnected(uid(1), true, 0)).toEqual([]);
    expect(room.setConnected(uid(1), false, 0)).toHaveLength(1);
    expect(room.removePlayer(uid(42), 0)).toEqual([]);
  });

  it('records when the last connected player went away, and clears it on return', () => {
    const room = newRoom();
    room.addPlayer(uid(2), NICK);
    room.setConnected(uid(1), false, 100);
    expect(room.emptySince).toBeNull();
    room.setConnected(uid(2), false, 200);
    expect(room.emptySince).toBe(200);
    room.setConnected(uid(1), false, 300);
    expect(room.emptySince).toBe(200);
    room.setConnected(uid(2), true, 400);
    expect(room.emptySince).toBeNull();
  });

  it('becomes empty-since when the only connected player leaves', () => {
    const room = newRoom();
    room.addPlayer(uid(2), NICK);
    room.setConnected(uid(2), false, 100);
    room.removePlayer(uid(1), 500);
    expect(room.emptySince).toBe(500);
  });
});
