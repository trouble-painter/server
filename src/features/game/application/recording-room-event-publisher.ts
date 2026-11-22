import type { UserId } from '../../../shared/domain/user-id.js';
import type { RoomEvent } from '../domain/room-event.js';
import type { Room } from '../domain/room.js';
import type { GameRecorder } from './game-recorder.js';
import type { RoomEventPublisher } from './ports/room-event-publisher.js';

interface ErrorLogger {
  error(context: object, message: string): void;
}

/** Hands every event to the recorder as well as to the players. A recording that fails never reaches the game. */
export class RecordingRoomEventPublisher implements RoomEventPublisher {
  constructor(
    private readonly inner: RoomEventPublisher,
    private readonly recorder: GameRecorder,
    private readonly logger: ErrorLogger,
  ) {}

  publish(room: Room, events: readonly RoomEvent[], except?: UserId): void {
    try {
      this.recorder.record(room, events);
    } catch (error) {
      this.logger.error({ err: error, roomId: room.id }, 'failed to record game history');
    }
    this.inner.publish(room, events, except);
  }
}
