import type { Clock } from '../../src/shared/application/ports/clock.js';
import type { Scheduler } from '../../src/shared/application/ports/scheduler.js';

export class FakeClock implements Clock {
  constructor(public time = 1_000_000) {}

  now(): number {
    return this.time;
  }
}

/** Holds tasks until a test fires them. */
export class FakeScheduler implements Scheduler {
  readonly tasks = new Map<string, { delayMs: number; task: () => void }>();

  schedule(key: string, delayMs: number, task: () => void): void {
    this.tasks.set(key, { delayMs, task });
  }

  cancel(key: string): void {
    this.tasks.delete(key);
  }

  fire(key: string): void {
    const entry = this.tasks.get(key);
    if (entry === undefined) {
      throw new Error(`no task scheduled under ${key}`);
    }
    this.tasks.delete(key);
    entry.task();
  }
}
