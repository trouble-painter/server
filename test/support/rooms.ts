import type { Nickname } from '../../src/features/game/domain/nickname.js';
import { PhaseType, type Game } from '../../src/features/game/domain/phase.js';
import { Room } from '../../src/features/game/domain/room.js';
import { Locale } from '../../src/shared/domain/locale.js';
import type { RoomCode } from '../../src/shared/domain/room-code.js';
import type { UserId } from '../../src/shared/domain/user-id.js';
import { TEST_OPTION } from './game.js';

const uid = (n: number) => n as UserId;
export const [A, B, C] = [uid(1), uid(2), uid(3)];
export const GAME: Game = { mafiaId: C, category: '장소', keyword: { word: '도시', synonyms: ['시내'] }, turnOrder: [B, A, C] };
const STROKE = { x: [1, 2], y: [3, 4], t: [0, 10] };
const CANVAS = { w: 300, h: 400 };
export const T0 = 1_000_000;

/** A fresh room with players A, B, C and the given code. */
export function waitingRoom(id = 'K7Q2ZP'): Room {
  const room = Room.create({
    id: id as RoomCode,
    locale: Locale.Ko,
    isQuickStart: false,
    option: TEST_OPTION,
    hostId: A,
    hostNickname: 'A' as Nickname,
  });
  room.addPlayer(B, 'B' as Nickname);
  room.addPlayer(C, 'C' as Nickname);
  return room;
}

/** Every turn played out by deadline, B's sketch kept, A voted for C. */
function votingRoom(): Room {
  const room = waitingRoom();
  room.start(A, GAME, T0);
  room.expire(room.version, T0 + TEST_OPTION.readyMs);
  room.drawStroke(B, 0, STROKE, CANVAS, room.deadline!);
  while (room.phase.type === PhaseType.Drawing) {
    room.expire(room.version, room.deadline!);
  }
  room.vote(A, C);
  return room;
}

/**
 * One room per phase, each carrying the data that phase holds: a stroke in progress,
 * finished sketches, votes, typed answer, result.
 */
export function roomsInEveryPhase(): Record<PhaseType, Room> {
  const wait = waitingRoom();

  const ready = waitingRoom();
  ready.start(A, GAME, T0);

  const drawing = waitingRoom();
  drawing.start(A, GAME, T0);
  drawing.expire(drawing.version, T0 + TEST_OPTION.readyMs);
  drawing.endTurn(B, T0 + 20_000);
  const drawFrom = (drawing.phase as Extract<Room['phase'], { type: PhaseType.Drawing }>).turn.drawFrom;
  drawing.drawStroke(A, 0, STROKE, CANVAS, drawFrom);

  const vote = votingRoom();

  const answer = votingRoom();
  answer.vote(B, C);
  answer.expire(answer.version, answer.deadline!);
  answer.typeAnswer(C, '바다');

  const end = votingRoom();
  end.vote(B, C);
  end.expire(end.version, end.deadline!);
  end.submitAnswer(C, '도시');

  return {
    [PhaseType.Wait]: wait,
    [PhaseType.Ready]: ready,
    [PhaseType.Drawing]: drawing,
    [PhaseType.Vote]: vote,
    [PhaseType.Answer]: answer,
    [PhaseType.End]: end,
  };
}
