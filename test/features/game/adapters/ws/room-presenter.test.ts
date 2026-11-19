import { describe, expect, it } from 'vitest';
import { eventMessage, roomMessage } from '../../../../../src/features/game/adapters/ws/room-presenter.js';
import type { Nickname } from '../../../../../src/features/game/domain/nickname.js';
import { Reaction } from '../../../../../src/features/game/domain/reaction.js';
import { RoomEventType } from '../../../../../src/features/game/domain/room-event.js';
import { Room } from '../../../../../src/features/game/domain/room.js';
import { Locale } from '../../../../../src/shared/domain/locale.js';
import type { RoomCode } from '../../../../../src/shared/domain/room-code.js';
import type { UserId } from '../../../../../src/shared/domain/user-id.js';
import { TEST_OPTION } from '../../../../support/game.js';

const [A, B, C] = [1, 2, 3] as UserId[] as [UserId, UserId, UserId];
const NICK = 'nick' as Nickname;

function startedRoom(): Room {
  const room = Room.create({
    id: 'K7Q2ZP' as RoomCode,
    locale: Locale.Ko,
    isQuickStart: false,
    option: TEST_OPTION,
    hostId: A,
    hostNickname: NICK,
  });
  room.addPlayer(B, NICK);
  room.addPlayer(C, NICK);
  room.start(A, { mafiaId: C, category: '장소', keyword: '도시', turnOrder: [B, A, C] }, 0);
  return room;
}

describe('room presenter', () => {
  it('hides the keyword from the mafia and the mafia from everyone', () => {
    const room = startedRoom();
    const citizen = roomMessage(room, A).data as any;
    const mafia = roomMessage(room, C).data as any;
    expect(citizen.room.phase).toEqual({
      type: 'READY',
      game: { role: 'CITIZEN', category: '장소', keyword: '도시', turnOrder: [2, 1, 3] },
      deadline: TEST_OPTION.readyMs,
    });
    expect(mafia.room.phase.game).toEqual({ role: 'MAFIA', category: '장소', keyword: null, turnOrder: [2, 1, 3] });
    expect(JSON.stringify(citizen)).not.toContain('mafiaId');
    expect(citizen.room.option).toEqual({
      minPlayers: 3,
      maxPlayers: 10,
      readyMs: 5_000,
      introAnimationMs: 3_000,
      roundAnimationMs: 2_000,
      rounds: 2,
      turnMs: 10_000,
      strokesPerTurn: 2,
      voteMs: 30_000,
      answerMs: 20_000,
      endMs: 15_000,
    });
  });

  it('reveals the mafia and the keyword in the END result', () => {
    const room = startedRoom();
    while (room.phase.type !== 'vote') {
      room.expire(room.version, 0);
    }
    room.vote(A, B, 0);
    room.vote(B, A, 0);
    room.vote(C, A, 0);
    expect((roomMessage(room, C).data as any).room.phase).toMatchObject({
      type: 'END',
      sketches: [],
      result: { mafiaId: 3, accusedId: 1, answer: '도시', mafiaGuess: null, winner: 'MAFIA' },
    });
  });

  it('does not echo a stroke, reaction or answer back to its sender', () => {
    const room = startedRoom();
    const stroke = {
      type: RoomEventType.StrokeUpdated,
      drawerId: B,
      index: 0,
      stroke: { x: [1], y: [2], t: [0] },
      canvas: { w: 3, h: 4 },
    } as const;
    expect(eventMessage(room, stroke, B)).toBeNull();
    expect(eventMessage(room, stroke, A)).toEqual({
      type: 'STROKE',
      data: { index: 0, stroke: { x: [1], y: [2], t: [0] }, canvas: { w: 3, h: 4 } },
    });
    const reaction = { type: RoomEventType.ReactionSent, userId: A, reaction: Reaction.Poop } as const;
    expect(eventMessage(room, reaction, A)).toBeNull();
    expect(eventMessage(room, reaction, B)).toEqual({ type: 'REACTION', data: { userId: 1, reaction: 'POOP' } });
    const typed = { type: RoomEventType.AnswerTyped, mafiaId: C, answer: '도' } as const;
    expect(eventMessage(room, typed, C)).toBeNull();
    expect(eventMessage(room, typed, A)).toEqual({ type: 'ANSWER_TYPING', data: { answer: '도' } });
    const votes = { type: RoomEventType.VotesChanged, votes: new Map([[A, C]]) } as const;
    expect(eventMessage(room, votes, A)).toEqual({ type: 'VOTES', data: { votes: { '1': 3 } } });
  });
});
