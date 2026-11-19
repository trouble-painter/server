export interface Clock {
  /** Unix epoch milliseconds. */
  now(): number;
}
