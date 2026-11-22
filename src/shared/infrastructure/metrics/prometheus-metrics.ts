import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client';
import type { GameMetrics } from '../../../features/game/application/ports/game-metrics.js';
import type { MatchingMetrics } from '../../../features/matching/application/ports/matching-metrics.js';

const GAME_MODE = { quickStart: 'quick_start', room: 'room' } as const;

/** Every metric the server exposes, in its own registry so each instance (and test) counts alone. */
export class PrometheusMetrics implements GameMetrics, MatchingMetrics {
  readonly #registry = new Registry();
  readonly #gamesEnded: Counter<'winner' | 'mode'>;
  readonly #matchFound: Counter;
  readonly #matchAccepted: Counter;
  readonly #matchDeclined: Counter;
  readonly #logMessages: Counter<'level'>;

  constructor() {
    collectDefaultMetrics({ register: this.#registry });
    this.#gamesEnded = this.#counter('games_ended_total', 'Games that finished with a result.', ['winner', 'mode']);
    this.#matchFound = this.#counter('matching_found_players_total', 'Players put into an accept step.');
    this.#matchAccepted = this.#counter('matching_accepted_players_total', 'Players who accepted a match.');
    this.#matchDeclined = this.#counter('matching_declined_players_total', 'Players removed for not accepting in time.');
    this.#logMessages = this.#counter('log_messages_total', 'Log lines written, by level.', ['level']);
  }

  gameEnded(winner: string, isQuickStart: boolean): void {
    this.#gamesEnded.inc({ winner, mode: isQuickStart ? GAME_MODE.quickStart : GAME_MODE.room });
  }

  found(players: number): void {
    this.#matchFound.inc(players);
  }

  accepted(players: number): void {
    this.#matchAccepted.inc(players);
  }

  declined(players: number): void {
    this.#matchDeclined.inc(players);
  }

  logged(level: string): void {
    this.#logMessages.inc({ level });
  }

  /** Reads `read` at each scrape, for a value that is only known by asking (rooms, connections). */
  addGauge(name: string, help: string, read: () => number): void {
    new Gauge({
      name,
      help,
      registers: [this.#registry],
      collect() {
        this.set(read());
      },
    });
  }

  /** The conventional `build_info` gauge: constant 1, the version in a label. */
  setBuildInfo(version: string): void {
    new Gauge({ name: 'build_info', help: 'The commit this server was built from.', labelNames: ['version'], registers: [this.#registry] }).set({ version }, 1);
  }

  get contentType(): string {
    return this.#registry.contentType;
  }

  render(): Promise<string> {
    return this.#registry.metrics();
  }

  #counter<L extends string>(name: string, help: string, labelNames: readonly L[] = []): Counter<L> {
    return new Counter({ name, help, labelNames, registers: [this.#registry] });
  }
}
