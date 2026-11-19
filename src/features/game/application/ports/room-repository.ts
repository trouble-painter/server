import type { RoomCode } from '../../../../shared/domain/room-code.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { Room } from '../../domain/room.js';

export interface RoomRepository {
  get(id: RoomCode): Room | null;
  /** The room the user is a player of. */
  findByUser(userId: UserId): Room | null;
  all(): readonly Room[];
  /** Call after every change so the user index follows the room's players. */
  save(room: Room): void;
  delete(room: Room): void;
}
