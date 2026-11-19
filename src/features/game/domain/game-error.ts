export enum GameErrorCode {
  RoomNotFound = 'roomNotFound',
  RoomFull = 'roomFull',
  RoomInGame = 'roomInGame',
  AlreadyInGame = 'alreadyInGame',
  NotInRoom = 'notInRoom',
}

/** A request the rules refuse; the requester gets the code back. */
export class GameError extends Error {
  constructor(readonly code: GameErrorCode) {
    super(code);
    this.name = 'GameError';
  }
}
