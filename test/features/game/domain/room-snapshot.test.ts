import { describe, expect, it } from 'vitest';
import { PhaseType } from '../../../../src/features/game/domain/phase.js';
import { Room } from '../../../../src/features/game/domain/room.js';
import { A, B, C, roomsInEveryPhase, T0 } from '../../../support/rooms.js';

const GRACE_MS = 10_000;

describe('Room snapshot', () => {
  it.each(Object.values(PhaseType))('rebuilds a room in %s exactly, through JSON', (type) => {
    const room = roomsInEveryPhase()[type];
    expect(room.phase.type).toBe(type);
    const restored = Room.fromSnapshot(JSON.parse(JSON.stringify(room.toSnapshot())));
    expect(restored.toSnapshot()).toEqual(room.toSnapshot());
    expect(restored.phase).toEqual(room.phase);
    expect(restored.version).toBe(room.version);
    expect(restored.players.map((p) => p.userId)).toEqual([A, B, C]);
  });

  it('keeps votes as a map and stores them as pairs', () => {
    const room = roomsInEveryPhase()[PhaseType.Vote];
    const snapshot = room.toSnapshot();
    expect(snapshot.phase).toMatchObject({ votes: [[A, C]] });
    const restored = Room.fromSnapshot(JSON.parse(JSON.stringify(snapshot)));
    restored.vote(B, A);
    expect(restored.phase).toMatchObject({ votes: new Map([[A, C], [B, A]]) });
  });

  it('does not share players with the room it came from', () => {
    const room = roomsInEveryPhase()[PhaseType.Wait];
    const restored = Room.fromSnapshot(room.toSnapshot());
    restored.setConnected(A, false, T0);
    expect(room.isConnected(A)).toBe(true);
  });
});

describe('Room.resumeAfterRestart', () => {
  it('marks everyone away and counts the room empty from now', () => {
    const room = roomsInEveryPhase()[PhaseType.Wait];
    room.resumeAfterRestart(T0, GRACE_MS);
    expect(room.players.every((p) => !p.isConnected)).toBe(true);
    expect(room.emptySince).toBe(T0);
  });

  it.each([PhaseType.Ready, PhaseType.Drawing, PhaseType.Vote, PhaseType.Answer])(
    'pushes a passed %s deadline to now + grace and leaves a later one alone',
    (type) => {
      const late = roomsInEveryPhase()[type];
      const deadline = late.deadline!;
      late.resumeAfterRestart(deadline + 1, GRACE_MS);
      expect(late.deadline).toBe(deadline + 1 + GRACE_MS);

      const early = roomsInEveryPhase()[type];
      early.resumeAfterRestart(deadline - GRACE_MS - 1, GRACE_MS);
      expect(early.deadline).toBe(deadline);
    },
  );

  it('keeps the drawing window of the turn in progress', () => {
    const room = roomsInEveryPhase()[PhaseType.Drawing];
    const turnOf = (r: typeof room) => (r.phase as Extract<typeof r.phase, { type: PhaseType.Drawing }>).turn;
    const { startedAt, drawFrom } = turnOf(room);
    room.resumeAfterRestart(room.deadline! + 1, GRACE_MS);
    expect(turnOf(room)).toMatchObject({ startedAt, drawFrom });
  });

  it('does not change the version, so a timer armed after it is current', () => {
    const room = roomsInEveryPhase()[PhaseType.Vote];
    const version = room.version;
    room.resumeAfterRestart(T0, GRACE_MS);
    expect(room.version).toBe(version);
  });
});
