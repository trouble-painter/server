/** Counts players, not matches: a match found for six players counts six. */
export interface MatchingMetrics {
  found(players: number): void;
  accepted(players: number): void;
  declined(players: number): void;
}
