import { describe, expect, it } from 'vitest';
import { GameStartPush } from '../../../../src/features/game/application/game-start-push.js';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import { Room } from '../../../../src/features/game/domain/room.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import type { RoomCode } from '../../../../src/shared/domain/room-code.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { TEST_OPTION } from '../../../support/game.js';

const [A, B, C] = [1, 2, 3] as UserId[] as [UserId, UserId, UserId];
const NICK = 'nick' as Nickname;

function roomOfABC(): Room {
  const room = Room.create({
    id: 'AAAAAA' as RoomCode,
    locale: Locale.Ko,
    isQuickStart: false,
    option: TEST_OPTION,
    hostId: A,
    hostNickname: NICK,
  });
  room.addPlayer(B, NICK);
  room.addPlayer(C, NICK);
  return room;
}

describe('GameStartPush', () => {
  function pushOf(): { push: GameStartPush; sent: [Locale, readonly string[]][] } {
    const sent: [Locale, readonly string[]][] = [];
    return { push: new GameStartPush({ notifyGameStarted: (locale, tokens) => sent.push([locale, tokens]), notifyMatchFound: () => {} }), sent };
  }

  it('sends nothing when no player has a token', () => {
    const { push, sent } = pushOf();
    push.notify(roomOfABC());
    expect(sent).toEqual([]);
  });

  it('keeps the latest token of a user', () => {
    const { push, sent } = pushOf();
    push.register(B, 'old');
    push.register(B, 'new');
    push.notify(roomOfABC());
    expect(sent).toEqual([[Locale.Ko, ['new']]]);
  });

  it('moves a device token to the user who registered it last', () => {
    const { push, sent } = pushOf();
    push.register(B, 'device');
    push.register(C, 'device');
    // B no longer has it, so leaving out C leaves nobody.
    push.notify(roomOfABC(), C);
    expect(sent).toEqual([]);
  });

  it('leaves out the player who started the game', () => {
    const { push, sent } = pushOf();
    push.register(A, 'a');
    push.register(B, 'b');
    push.notify(roomOfABC(), A);
    expect(sent).toEqual([[Locale.Ko, ['b']]]);
  });
});
