/** Whether a room in a game still has anyone to play it. */
export enum Vacancy {
  /** Someone is connected, or the room is not in a game. */
  Occupied = 'occupied',
  /** Everyone is away and more than half of them left on purpose: the game is over for good. */
  Deserted = 'deserted',
  /** Everyone is away, at least half of them through a lost connection: the game waits for them. */
  Stranded = 'stranded',
}
