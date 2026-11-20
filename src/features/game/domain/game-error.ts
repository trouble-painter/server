export enum GameErrorCode {
  RoomNotFound = 'roomNotFound',
  RoomFull = 'roomFull',
  RoomInGame = 'roomInGame',
  AlreadyInGame = 'alreadyInGame',
  NotInRoom = 'notInRoom',
  NotHost = 'notHost',
  NotEnoughPlayers = 'notEnoughPlayers',
  NotAllReady = 'notAllReady',
  InvalidPhase = 'invalidPhase',
  NotYourTurn = 'notYourTurn',
  /** Well formed but against the rules, such as a vote for oneself or a skipped stroke index. */
  InvalidRequest = 'invalidRequest',
}

/** A request the rules refuse; the requester gets the code back. */
export class GameError extends Error {
  constructor(readonly code: GameErrorCode) {
    super(code);
    this.name = 'GameError';
  }
}
