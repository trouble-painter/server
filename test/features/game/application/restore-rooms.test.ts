import { beforeEach, describe, expect, it } from 'vitest';
import { Membership, waitLeaveKey } from '../../../../src/features/game/application/membership.js';
import { phaseTimerKey, PhaseTimer } from '../../../../src/features/game/application/phase-timer.js';
import type { RoomEventPublisher } from '../../../../src/features/game/application/ports/room-event-publisher.js';
import { RestoreRooms } from '../../../../src/features/game/application/usecases/restore-rooms.js';
import { PhaseType } from '../../../../src/features/game/domain/phase.js';
import type { Room } from '../../../../src/features/game/domain/room.js';
import { MemoryRoomRepository } from '../../../../src/features/game/infrastructure/memory/memory-room-repository.js';
import { FakeClock, FakeScheduler } from '../../../support/fakes.js';
import { A, B, C, roomsInEveryPhase, waitingRoom } from '../../../support/rooms.js';

const RESTORE_GRACE_MS = 10_000;
const WAIT_GRACE_MS = 30_000;

const SILENT: RoomEventPublisher = { publish: () => {} };

describe('RestoreRooms', () => {
  let rooms: MemoryRoomRepository;
  let scheduler: FakeScheduler;
  let clock: FakeClock;
  let restore: RestoreRooms;

  beforeEach(() => {
    rooms = new MemoryRoomRepository();
    scheduler = new FakeScheduler();
    clock = new FakeClock();
    const membership = new Membership(rooms, SILENT, scheduler, clock);
    const timer = new PhaseTimer(rooms, SILENT, scheduler, clock);
    restore = new RestoreRooms(rooms, membership, timer, clock, RESTORE_GRACE_MS, WAIT_GRACE_MS);
  });

  function load(room: Room): Room {
    rooms.save(room);
    return room;
  }

  it('arms the phase timer on the extended deadline of a game', () => {
    const room = load(roomsInEveryPhase()[PhaseType.Vote]);
    clock.time = room.deadline! + 5_000;
    restore.execute();
    expect(room.players.some((p) => p.isConnected)).toBe(false);
    expect(scheduler.tasks.get(phaseTimerKey(room.id))?.delayMs).toBe(RESTORE_GRACE_MS);
    expect(scheduler.tasks.has(waitLeaveKey(A))).toBe(false);

    scheduler.fire(phaseTimerKey(room.id));
    expect(room.phase.type).not.toBe(PhaseType.Vote);
  });

  it('lets waiting players go unless they reconnect in time', () => {
    const room = load(waitingRoom());
    restore.execute();
    expect(scheduler.tasks.has(phaseTimerKey(room.id))).toBe(false);
    for (const userId of [A, B, C]) {
      expect(scheduler.tasks.get(waitLeaveKey(userId))?.delayMs).toBe(WAIT_GRACE_MS);
    }

    room.setConnected(A, true, clock.now());
    scheduler.fire(waitLeaveKey(A));
    scheduler.fire(waitLeaveKey(B));
    expect(room.players.map((p) => p.userId)).toEqual([A, C]);
    scheduler.fire(waitLeaveKey(C));
    expect(rooms.get(room.id)?.players.map((p) => p.userId)).toEqual([A]);
  });

  it('deletes a waiting room once every player has failed to return', () => {
    const room = load(waitingRoom());
    restore.execute();
    for (const userId of [A, B, C]) {
      scheduler.fire(waitLeaveKey(userId));
    }
    expect(rooms.get(room.id)).toBeNull();
  });

  it('closes a game saved with its result out', () => {
    const room = load(roomsInEveryPhase()[PhaseType.End]);
    restore.execute();
    expect(room.phase.type).toBe(PhaseType.Wait);
    expect(room.isEmpty).toBe(true);
    expect(rooms.get(room.id)).toBe(room);
    expect(rooms.findByUser(A)).toBeNull();
  });
});
