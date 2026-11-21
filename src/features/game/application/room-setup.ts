import type { IdGenerator } from '../../../shared/application/ports/id-generator.js';
import type { Random } from '../../../shared/application/ports/random.js';
import type { RoomCode } from '../../../shared/domain/room-code.js';
import type { Game } from '../domain/phase.js';
import type { Room } from '../domain/room.js';
import type { KeywordRepository } from './ports/keyword-repository.js';
import type { RoomRepository } from './ports/room-repository.js';

export function unusedRoomCode(rooms: RoomRepository, ids: IdGenerator): RoomCode {
  let code: RoomCode;
  do {
    code = ids.roomCode();
  } while (rooms.get(code) !== null);
  return code;
}

/** One mafia, a random category among the rule's (all when it names none), a random keyword in it, and a shuffled turn order. */
export function drawGame(room: Room, keywords: KeywordRepository, random: Random): Game {
  const playerIds = room.players.map((p) => p.userId);
  const all = keywords.categories(room.rule.keywordLocale);
  const chosen = new Set(room.rule.categoryIds);
  const inPlay = all.filter((c) => chosen.has(c.id));
  // None chosen, or the chosen ones dropped from the keyword files: draw from all of them.
  const { category, keywords: candidates } = random.pick(inPlay.length > 0 ? inPlay : all);
  return {
    mafiaId: random.pick(playerIds),
    category,
    keyword: random.pick(candidates),
    turnOrder: random.shuffle(playerIds),
  };
}
