import { describe, expect, it } from 'vitest';
import { GameRecorder } from '../../../../src/features/game/application/game-recorder.js';
import type { RoomEventPublisher } from '../../../../src/features/game/application/ports/room-event-publisher.js';
import { RecordingRoomEventPublisher } from '../../../../src/features/game/application/recording-room-event-publisher.js';
import type { RoomEvent } from '../../../../src/features/game/domain/room-event.js';
import { RoomEventType } from '../../../../src/features/game/domain/room-event.js';
import type { Room } from '../../../../src/features/game/domain/room.js';
import { FakeClock, RecordingMetrics } from '../../../support/fakes.js';
import { A, GAME, T0, waitingRoom } from '../../../support/rooms.js';

describe('RecordingRoomEventPublisher', () => {
  it('still tells the players when recording fails, and logs it', () => {
    const delivered: RoomEvent[] = [];
    const inner: RoomEventPublisher = { publish: (_room: Room, events) => delivered.push(...events) };
    const broken = new GameRecorder(
      {
        save: () => {
          throw new Error('disk full');
        },
      },
      new FakeClock(T0),
      new RecordingMetrics(),
    );
    const logged: object[] = [];
    const publisher = new RecordingRoomEventPublisher(inner, broken, { error: (context) => logged.push(context) });

    const room = waitingRoom();
    publisher.publish(room, room.start(A, GAME, T0));
    room.expire(room.version, T0 + 5_000);
    while (!room.isOver) {
      const events = room.expire(room.version, room.deadline!);
      publisher.publish(room, events);
    }

    expect(delivered.some((e) => e.type === RoomEventType.PhaseChanged)).toBe(true);
    expect(logged).toHaveLength(1);
  });
});
