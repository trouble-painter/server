export interface Random {
  /** A uniformly chosen element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** A new array in uniformly random order. */
  shuffle<T>(items: readonly T[]): T[];
}
