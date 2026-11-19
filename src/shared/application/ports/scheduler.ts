export interface Scheduler {
  /** Runs `task` after `delayMs`, replacing any task already scheduled under `key`. */
  schedule(key: string, delayMs: number, task: () => void): void;
  cancel(key: string): void;
}
