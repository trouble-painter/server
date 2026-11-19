import type { UserId } from '../../../../shared/domain/user-id.js';
import type { PlayingRoomIndex } from '../ports/playing-room-index.js';

export class GetPlayingRoom {
  constructor(private readonly index: PlayingRoomIndex) {}

  execute(userId: UserId): string | null {
    return this.index.findRoomId(userId);
  }
}
