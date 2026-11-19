/** Request limits the server enforces; the app reads them from HELLO instead of keeping its own copy. */
export interface Limits {
  readonly drawThrottleMs: number;
  readonly reactionThrottleMs: number;
  readonly maxStrokePoints: number;
  readonly maxAnswerLength: number;
  readonly maxStrokesPerTurn: number;
}
