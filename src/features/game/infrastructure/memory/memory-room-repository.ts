import type { RoomCode } from '../../../../shared/domain/room-code.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { RoomRepository } from '../../application/ports/room-repository.js';
import type { Room } from '../../domain/room.js';

export class MemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<RoomCode, Room>();
  private readonly roomByUser = new Map<UserId, RoomCode>();
  /** Players as of the last save, to unindex those who have left since. */
  private readonly indexedUsers = new Map<RoomCode, readonly UserId[]>();

  get(id: RoomCode): Room | null {
    return this.rooms.get(id) ?? null;
  }

  findByUser(userId: UserId): Room | null {
    const id = this.roomByUser.get(userId);
    return id === undefined ? null : this.get(id);
  }

  all(): readonly Room[] {
    return [...this.rooms.values()];
  }

  save(room: Room): void {
    this.unindex(room.id);
    const userIds = room.players.map((p) => p.userId);
    for (const userId of userIds) {
      this.roomByUser.set(userId, room.id);
    }
    this.indexedUsers.set(room.id, userIds);
    this.rooms.set(room.id, room);
  }

  delete(room: Room): void {
    this.unindex(room.id);
    this.rooms.delete(room.id);
  }

  private unindex(id: RoomCode): void {
    for (const userId of this.indexedUsers.get(id) ?? []) {
      if (this.roomByUser.get(userId) === id) {
        this.roomByUser.delete(userId);
      }
    }
    this.indexedUsers.delete(id);
  }
}
