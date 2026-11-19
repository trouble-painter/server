import type { RoomCode } from '../../../../shared/domain/room-code.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { RoomRepository } from '../ports/room-repository.js';

export class GetPlayingRoom {
  constructor(private readonly rooms: RoomRepository) {}

  /** Any room the user is in, waiting rooms included. */
  execute(userId: UserId): RoomCode | null {
    return this.rooms.findByUser(userId)?.id ?? null;
  }
}
