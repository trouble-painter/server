import type { Clock } from '../../../shared/application/ports/clock.js';
import type { RoomCode } from '../../../shared/domain/room-code.js';
import type { UserId } from '../../../shared/domain/user-id.js';
import { HistoryEventType, type GameMeta, type HistoryEvent } from '../domain/game-history.js';
import { PhaseType, type Canvas, type Stroke, type Turn } from '../domain/phase.js';
import { RoomEventType, type RoomEvent } from '../domain/room-event.js';
import type { Room } from '../domain/room.js';
import type { GameHistoryRepository } from './ports/game-history-repository.js';

/** The stroke being drawn: it is kept as one entry until some other event shows it is finished. */
interface PendingStroke {
  readonly drawerId: UserId;
  readonly index: number;
  readonly startAt: number;
  endAt: number;
  stroke: Stroke;
  canvas: Canvas;
}

/** A game in progress. Times it hands out are relative to the start. */
class Recording {
  readonly #events: HistoryEvent[] = [];
  #pending: PendingStroke | null = null;

  constructor(
    readonly startedAt: number,
    readonly meta: GameMeta,
  ) {}

  /** Milliseconds since the game started. */
  since(time: number): number {
    return time - this.startedAt;
  }

  /** A stroke is sent again and again as it grows; only the last version of each is kept. */
  stroke(drawerId: UserId, index: number, stroke: Stroke, canvas: Canvas, at: number): void {
    const pending = this.#pending;
    if (pending !== null && pending.drawerId === drawerId && pending.index === index) {
      pending.stroke = stroke;
      pending.canvas = canvas;
      pending.endAt = at;
      return;
    }
    this.#flush();
    this.#pending = { drawerId, index, startAt: at, endAt: at, stroke, canvas };
  }

  turn(turn: Turn): void {
    this.push({
      type: HistoryEventType.Turn,
      at: this.since(turn.startedAt),
      round: turn.round,
      turn: turn.turn,
      drawerId: turn.drawerId,
      drawFromAt: this.since(turn.drawFrom),
      deadlineAt: this.since(turn.deadline),
    });
  }

  push(event: HistoryEvent): void {
    this.#flush();
    this.#events.push(event);
  }

  events(): readonly HistoryEvent[] {
    this.#flush();
    return this.#events;
  }

  #flush(): void {
    const pending = this.#pending;
    if (pending === null) {
      return;
    }
    this.#pending = null;
    this.#events.push({
      type: HistoryEventType.Stroke,
      at: pending.startAt,
      endAt: pending.endAt,
      drawerId: pending.drawerId,
      index: pending.index,
      stroke: pending.stroke,
      canvas: pending.canvas,
    });
  }
}

/**
 * Follows the events of each room's game and saves the whole game, drawing included, when its result
 * comes out. A game the recorder did not see start (the server restarted in the middle of it) is not saved.
 */
export class GameRecorder {
  readonly #recordings = new Map<RoomCode, Recording>();

  constructor(
    private readonly history: GameHistoryRepository,
    private readonly clock: Clock,
  ) {}

  /** Call with what the room just raised, after the room has changed. */
  record(room: Room, events: readonly RoomEvent[]): void {
    const now = this.clock.now();
    for (const event of events) {
      if (event.type === RoomEventType.PhaseChanged) {
        this.#onPhaseChanged(room, now);
        continue;
      }
      const recording = this.#recordings.get(room.id);
      if (recording !== undefined) {
        this.#onEvent(recording, event, recording.since(now));
      }
    }
  }

  #onEvent(recording: Recording, event: RoomEvent, at: number): void {
    switch (event.type) {
      case RoomEventType.StrokeUpdated:
        recording.stroke(event.drawerId, event.index, event.stroke, event.canvas, at);
        return;
      case RoomEventType.TurnChanged:
        recording.turn(event.turn);
        return;
      case RoomEventType.StrokeUndone:
        recording.push({ type: HistoryEventType.StrokeUndone, at, drawerId: event.drawerId });
        return;
      case RoomEventType.SketchCleared:
        recording.push({ type: HistoryEventType.SketchCleared, at, drawerId: event.drawerId });
        return;
      case RoomEventType.ReactionSent:
        recording.push({ type: HistoryEventType.Reaction, at, userId: event.userId, reaction: event.reaction });
        return;
      case RoomEventType.VotesChanged:
        recording.push({ type: HistoryEventType.Votes, at, votes: [...event.votes] });
        return;
      case RoomEventType.AnswerTyped:
        recording.push({ type: HistoryEventType.Answer, at, mafiaId: event.mafiaId, answer: event.answer });
        return;
      case RoomEventType.PlayersChanged:
      case RoomEventType.RuleChanged:
      case RoomEventType.PhaseChanged:
        return;
    }
  }

  #onPhaseChanged(room: Room, now: number): void {
    const phase = room.phase;
    if (phase.type === PhaseType.Ready) {
      this.#recordings.set(
        room.id,
        new Recording(now, {
          locale: room.locale,
          isQuickStart: room.isQuickStart,
          option: room.option,
          rule: room.rule,
          players: room.players.map(({ userId, nickname, color }) => ({ userId, nickname, color })),
          game: phase.game,
        }),
      );
      return;
    }
    const recording = this.#recordings.get(room.id);
    if (recording === undefined) {
      return;
    }
    const at = recording.since(now);
    switch (phase.type) {
      case PhaseType.Drawing:
        recording.turn(phase.turn);
        return;
      case PhaseType.Vote:
      case PhaseType.Answer:
        recording.push({ type: HistoryEventType.Phase, at, phase: phase.type, deadlineAt: recording.since(phase.deadline) });
        return;
      case PhaseType.End:
        recording.push({ type: HistoryEventType.Result, at, result: phase.result });
        this.#recordings.delete(room.id);
        this.history.save({
          roomId: room.id,
          startedAt: recording.startedAt,
          endedAt: now,
          winner: phase.result.winner,
          meta: recording.meta,
          events: recording.events(),
        });
        return;
      case PhaseType.Wait:
        return;
    }
  }
}
