import { describe, expect, it } from 'vitest';
import type { Nickname } from '../../../../src/features/game/domain/nickname.js';
import { PhaseType } from '../../../../src/features/game/domain/phase.js';
import type { Room } from '../../../../src/features/game/domain/room.js';
import { Vacancy } from '../../../../src/features/game/domain/vacancy.js';
import type { UserId } from '../../../../src/shared/domain/user-id.js';
import { TEST_OPTION } from '../../../support/game.js';
import { A, B, C, GAME, roomsInEveryPhase, T0, waitingRoom } from '../../../support/rooms.js';

const D = 4 as UserId;

function playing(): Room {
  const room = waitingRoom();
  room.start(A, GAME, T0);
  return room;
}

function turnOf(room: Room) {
  return (room.phase as Extract<Room['phase'], { type: PhaseType.Drawing }>).turn;
}

describe('Room vacancy', () => {
  it('a game with anyone connected is occupied, and so is a waiting room nobody is in', () => {
    const room = playing();
    room.leaveGame(A, T0);
    room.leaveGame(B, T0);
    expect(room.vacancy).toBe(Vacancy.Occupied);
    expect(room.isPaused).toBe(false);

    const waiting = waitingRoom();
    for (const userId of [A, B, C]) {
      waiting.setConnected(userId, false, T0);
    }
    expect(waiting.vacancy).toBe(Vacancy.Occupied);
    expect(waiting.isPaused).toBe(false);
  });

  it('is deserted once everyone is away and more than half of them left', () => {
    const room = playing();
    room.setConnected(A, false, T0);
    room.leaveGame(B, T0);
    room.leaveGame(C, T0);
    expect(room.vacancy).toBe(Vacancy.Deserted);
  });

  it('is stranded once everyone is away and at least half of them lost their connection', () => {
    const mostlyDropped = playing();
    mostlyDropped.leaveGame(A, T0);
    mostlyDropped.setConnected(B, false, T0);
    mostlyDropped.setConnected(C, false, T0);
    expect(mostlyDropped.vacancy).toBe(Vacancy.Stranded);

    const tie = waitingRoom();
    tie.addPlayer(D, 'D' as Nickname);
    tie.setReady(D, true);
    tie.start(A, GAME, T0);
    tie.leaveGame(A, T0);
    tie.leaveGame(B, T0);
    tie.setConnected(C, false, T0);
    tie.setConnected(D, false, T0);
    expect(tie.vacancy).toBe(Vacancy.Stranded);
  });

  it('coming back takes back a leave', () => {
    const room = playing();
    room.leaveGame(A, T0);
    room.setConnected(A, true, T0);
    room.setConnected(A, false, T0);
    room.leaveGame(B, T0);
    room.setConnected(C, false, T0);
    expect(room.vacancy).toBe(Vacancy.Stranded);
  });

  it('a leave from a waiting room is not kept', () => {
    const room = waitingRoom();
    room.leaveGame(A, T0);
    expect(room.isConnected(A)).toBe(false);
    expect(room.players.find((p) => p.userId === A)?.hasLeft).toBe(false);
  });

  it('pauses while everyone is away and moves the turn on by the pause when someone is back', () => {
    const room = roomsInEveryPhase()[PhaseType.Drawing];
    const before = turnOf(room);
    const awayAt = before.drawFrom + 1_000;
    for (const userId of [A, B, C]) {
      room.setConnected(userId, false, awayAt);
    }
    expect(room.isPaused).toBe(true);

    room.setConnected(B, true, awayAt + 7_000);
    expect(room.isPaused).toBe(false);
    expect(turnOf(room)).toEqual({
      ...before,
      startedAt: before.startedAt + 7_000,
      drawFrom: before.drawFrom + 7_000,
      deadline: before.deadline + 7_000,
    });
  });

  it.each([PhaseType.Ready, PhaseType.Vote, PhaseType.Answer])('moves a paused %s deadline on by the pause', (type) => {
    const room = roomsInEveryPhase()[type];
    const deadline = room.deadline!;
    for (const userId of [A, B, C]) {
      room.setConnected(userId, false, T0);
    }
    room.setConnected(A, true, T0 + 3_000);
    expect(room.deadline).toBe(deadline + 3_000);
  });

  it('a game paused before a restart loses none of its time to it', () => {
    const room = playing();
    const remaining = room.deadline! - T0;
    for (const userId of [A, B, C]) {
      room.setConnected(userId, false, T0);
    }
    const bootAt = T0 + TEST_OPTION.readyMs * 10;
    // A grace shorter than what was left, so only the pause moves the deadline.
    room.resumeAfterRestart(bootAt, remaining - 1);
    expect(room.emptySince).toBe(bootAt);
    expect(room.deadline).toBe(bootAt + remaining);
  });
});
