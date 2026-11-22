import { describe, expect, it } from 'vitest';
import { eventMessage, helloMessage, roomMessage } from '../../../../../src/features/game/adapters/ws/room-presenter.js';
import type { Nickname } from '../../../../../src/features/game/domain/nickname.js';
import { Reaction } from '../../../../../src/features/game/domain/reaction.js';
import { RoomEventType } from '../../../../../src/features/game/domain/room-event.js';
import { Room } from '../../../../../src/features/game/domain/room.js';
import { Locale } from '../../../../../src/shared/domain/locale.js';
import type { RoomCode } from '../../../../../src/shared/domain/room-code.js';
import type { UserId } from '../../../../../src/shared/domain/user-id.js';
import { FixedKeywords, TEST_LIMITS, TEST_OPTION } from '../../../../support/game.js';

const [A, B, C] = [1, 2, 3] as UserId[] as [UserId, UserId, UserId];
const NICK = 'nick' as Nickname;
const KEYWORDS = new FixedKeywords();

function startedRoom(): Room {
  const room = Room.create({
    id: 'K7Q2' as RoomCode,
    locale: Locale.Ko,
    isQuickStart: false,
    option: TEST_OPTION,
    hostId: A,
    hostNickname: NICK,
  });
  room.addPlayer(B, NICK);
  room.addPlayer(C, NICK);
  room.setReady(B, true);
  room.setReady(C, true);
  room.start(A, { mafiaId: C, category: '장소', keyword: { word: '도시', synonyms: [] }, turnOrder: [B, A, C] }, 0);
  return room;
}

describe('room presenter', () => {
  it('hides the keyword from the mafia and the mafia from everyone', () => {
    const room = startedRoom();
    const citizen = roomMessage(room, A, KEYWORDS).data as any;
    const mafia = roomMessage(room, C, KEYWORDS).data as any;
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
      defaultStrokesPerTurn: 2,
      voteMs: 30_000,
      answerMs: 20_000,
    });
  });

  it('reveals the mafia and the keyword in the END result', () => {
    const room = startedRoom();
    while (room.phase.type !== 'vote') {
      room.expire(room.version, 0);
    }
    room.vote(A, B);
    room.vote(B, A);
    room.vote(C, A);
    room.expire(room.version, room.deadline!);
    expect((roomMessage(room, C, KEYWORDS).data as any).room.phase).toMatchObject({
      type: 'END',
      sketches: [],
      result: { mafiaId: 3, accusedId: 1, answer: '도시', mafiaGuess: null, winner: 'MAFIA' },
    });
  });

  it('ANSWER names the accused, who is the mafia', () => {
    const room = startedRoom();
    while (room.phase.type !== 'vote') {
      room.expire(room.version, 0);
    }
    room.vote(A, C);
    room.vote(B, C);
    room.vote(C, A);
    room.expire(room.version, room.deadline!);
    expect((roomMessage(room, A, KEYWORDS).data as any).room.phase).toMatchObject({ type: 'ANSWER', accusedId: 3, typing: '' });
  });

  it('does not echo a stroke, clear, undo, reaction or answer back to its sender', () => {
    const room = startedRoom();
    const stroke = {
      type: RoomEventType.StrokeUpdated,
      drawerId: B,
      index: 0,
      stroke: { x: [1], y: [2], t: [0] },
      canvas: { w: 3, h: 4 },
    } as const;
    expect(eventMessage(room, stroke, B, KEYWORDS)).toBeNull();
    expect(eventMessage(room, stroke, A, KEYWORDS)).toEqual({
      type: 'STROKE',
      data: { index: 0, stroke: { x: [1], y: [2], t: [0] }, canvas: { w: 3, h: 4 } },
    });
    const cleared = { type: RoomEventType.SketchCleared, drawerId: B } as const;
    expect(eventMessage(room, cleared, B, KEYWORDS)).toBeNull();
    expect(eventMessage(room, cleared, A, KEYWORDS)).toEqual({ type: 'SKETCH_CLEARED', data: {} });
    const undone = { type: RoomEventType.StrokeUndone, drawerId: B } as const;
    expect(eventMessage(room, undone, B, KEYWORDS)).toBeNull();
    expect(eventMessage(room, undone, A, KEYWORDS)).toEqual({ type: 'STROKE_UNDONE', data: {} });
    const reaction = { type: RoomEventType.ReactionSent, userId: A, reaction: Reaction.Poop } as const;
    expect(eventMessage(room, reaction, A, KEYWORDS)).toBeNull();
    expect(eventMessage(room, reaction, B, KEYWORDS)).toEqual({ type: 'REACTION', data: { userId: 1, reaction: 'POOP' } });
    const typed = { type: RoomEventType.AnswerTyped, mafiaId: C, answer: '도' } as const;
    expect(eventMessage(room, typed, C, KEYWORDS)).toBeNull();
    expect(eventMessage(room, typed, A, KEYWORDS)).toEqual({ type: 'ANSWER_TYPING', data: { answer: '도' } });
    const votes = { type: RoomEventType.VotesChanged, votes: new Map([[A, C]]) } as const;
    expect(eventMessage(room, votes, A, KEYWORDS)).toEqual({ type: 'VOTES', data: { votes: { '1': 3 } } });
  });

  it('HELLO carries the queue status of a queued user', () => {
    const hello = helloMessage(7, 'v1', TEST_LIMITS, null, { locale: Locale.En, waitingCount: 2, startsAt: null, minCount: 3, waitMs: 10_000, ready: null }, A, KEYWORDS).data as any;
    expect(hello.serverVersion).toBe('v1');
    expect(hello.room).toBeNull();
    expect(hello.matching).toEqual({ locale: 'EN', waitingCount: 2, startsAt: null, minCount: 3, waitMs: 10_000, ready: null });
    expect((helloMessage(7, 'v1', TEST_LIMITS, null, null, A, KEYWORDS).data as any).matching).toBeNull();
  });
});
