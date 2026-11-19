import { IdleReason, localeToWire, ServerMessageType, type ServerMessage } from '../../../../shared/adapters/ws/protocol.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import { matchingView } from '../../../matching/adapters/ws/matching-presenter.js';
import type { MatchingStatus } from '../../../matching/domain/match-queue.js';
import type { KeywordRepository } from '../../application/ports/keyword-repository.js';
import type { GameOption } from '../../domain/game-option.js';
import type { GameRule } from '../../domain/game-rule.js';
import type { Limits } from '../../domain/limits.js';
import { PhaseType, type Game, type Result, type Sketch, type Stroke, type Turn } from '../../domain/phase.js';
import { Role } from '../../domain/role.js';
import { RoomEventType, type RoomEvent } from '../../domain/room-event.js';
import type { Player, Room } from '../../domain/room.js';
import { PHASE_WIRE, PLAYER_COLOR_WIRE, REACTION_WIRE, ROLE_WIRE } from './wire.js';

/**
 * The single place a room becomes its wire form, for HELLO, ROOM and patches alike.
 * Built per viewer: only END reveals the mafia, and the mafia never gets the keyword in GameView.
 */
function roomView(room: Room, viewer: UserId, keywords: KeywordRepository) {
  return {
    id: room.id,
    locale: localeToWire(room.locale),
    isQuickStart: room.isQuickStart,
    hostId: room.hostId,
    players: room.players.map(playerView),
    option: optionView(room.option),
    rule: ruleView(room.rule),
    phase: phaseView(room, viewer, keywords),
  };
}

function playerView(player: Readonly<Player>) {
  return {
    id: player.userId,
    nickname: player.nickname,
    color: PLAYER_COLOR_WIRE[player.color],
    isConnected: player.isConnected,
  };
}

function optionView(option: GameOption) {
  return {
    minPlayers: option.minPlayers,
    maxPlayers: option.maxPlayers,
    readyMs: option.readyMs,
    introAnimationMs: option.introAnimationMs,
    roundAnimationMs: option.roundAnimationMs,
    rounds: option.rounds,
    turnMs: option.turnMs,
    defaultStrokesPerTurn: option.defaultStrokesPerTurn,
    voteMs: option.voteMs,
    answerMs: option.answerMs,
  };
}

function ruleView(rule: GameRule) {
  return {
    strokesPerTurn: rule.strokesPerTurn,
    categoryIds: [...rule.categoryIds],
  };
}

function limitsView(limits: Limits) {
  return {
    drawThrottleMs: limits.drawThrottleMs,
    reactionThrottleMs: limits.reactionThrottleMs,
    maxStrokePoints: limits.maxStrokePoints,
    maxAnswerLength: limits.maxAnswerLength,
    maxStrokesPerTurn: limits.maxStrokesPerTurn,
  };
}

/** WAIT carries the categories a host can pick from, named in the room's locale. */
function phaseView(room: Room, viewer: UserId, keywords: KeywordRepository) {
  const phase = room.phase;
  const type = PHASE_WIRE[phase.type];
  switch (phase.type) {
    case PhaseType.Wait:
      return { type, categories: keywords.categories(room.locale).map((c) => ({ id: c.id, name: c.category })) };
    case PhaseType.Ready:
      return { type, game: gameView(phase.game, viewer), deadline: phase.deadline };
    case PhaseType.Drawing:
      return {
        type,
        game: gameView(phase.game, viewer),
        turn: turnView(phase.turn),
        sketches: phase.sketches.map(sketchView),
        current: phase.current === null ? null : sketchView(phase.current),
      };
    case PhaseType.Vote:
      return {
        type,
        game: gameView(phase.game, viewer),
        sketches: phase.sketches.map(sketchView),
        votes: votesView(phase.votes),
        deadline: phase.deadline,
      };
    case PhaseType.Answer:
      return {
        type,
        game: gameView(phase.game, viewer),
        sketches: phase.sketches.map(sketchView),
        // ANSWER only follows a vote that caught the mafia, so the accused is the mafia.
        accusedId: phase.game.mafiaId,
        typing: phase.typing,
        deadline: phase.deadline,
      };
    case PhaseType.End:
      return {
        type,
        game: gameView(phase.game, viewer),
        sketches: phase.sketches.map(sketchView),
        result: resultView(phase.result, phase.game.keyword.word),
      };
  }
}

function gameView(game: Game, viewer: UserId) {
  const isMafia = viewer === game.mafiaId;
  return {
    role: ROLE_WIRE[isMafia ? Role.Mafia : Role.Citizen],
    category: game.category,
    keyword: isMafia ? null : game.keyword.word,
    turnOrder: [...game.turnOrder],
  };
}

function turnView(turn: Turn) {
  return {
    round: turn.round,
    turn: turn.turn,
    drawerId: turn.drawerId,
    startedAt: turn.startedAt,
    drawFrom: turn.drawFrom,
    deadline: turn.deadline,
  };
}

function sketchView(sketch: Sketch) {
  return {
    userId: sketch.userId,
    canvas: { w: sketch.canvas.w, h: sketch.canvas.h },
    strokes: sketch.strokes.map(strokeView),
  };
}

function strokeView(stroke: Stroke) {
  return { x: [...stroke.x], y: [...stroke.y], t: [...stroke.t] };
}

function votesView(votes: ReadonlyMap<UserId, UserId>): Record<string, UserId> {
  return Object.fromEntries(votes);
}

function resultView(result: Result, keyword: string) {
  return {
    mafiaId: result.mafiaId,
    accusedId: result.accusedId,
    answer: keyword,
    mafiaGuess: result.mafiaGuess,
    winner: ROLE_WIRE[result.winner],
  };
}

export function helloMessage(
  serverTime: number,
  limits: Limits,
  room: Room | null,
  matching: MatchingStatus | null,
  viewer: UserId,
  keywords: KeywordRepository,
): ServerMessage {
  return {
    type: ServerMessageType.Hello,
    data: {
      serverTime,
      limits: limitsView(limits),
      room: room === null ? null : roomView(room, viewer, keywords),
      matching: matching === null ? null : matchingView(matching),
    },
  };
}

export function roomMessage(room: Room, viewer: UserId, keywords: KeywordRepository): ServerMessage {
  return { type: ServerMessageType.Room, data: { room: roomView(room, viewer, keywords) } };
}

export function playersMessage(room: Room): ServerMessage {
  return { type: ServerMessageType.Players, data: { players: room.players.map(playerView), hostId: room.hostId } };
}

export function idleMessage(reason: IdleReason): ServerMessage {
  return { type: ServerMessageType.Idle, data: { reason } };
}

/** What `viewer` is told about the event; null when it is not for them (their own stroke, clear, reaction or answer). */
export function eventMessage(room: Room, event: RoomEvent, viewer: UserId, keywords: KeywordRepository): ServerMessage | null {
  switch (event.type) {
    case RoomEventType.PlayersChanged:
      return playersMessage(room);
    case RoomEventType.PhaseChanged:
    case RoomEventType.RuleChanged:
      return roomMessage(room, viewer, keywords);
    case RoomEventType.TurnChanged:
      return {
        type: ServerMessageType.Turn,
        data: { turn: turnView(event.turn), sketch: event.sketch === null ? null : sketchView(event.sketch) },
      };
    case RoomEventType.StrokeUpdated:
      return viewer === event.drawerId
        ? null
        : {
            type: ServerMessageType.Stroke,
            data: { index: event.index, stroke: strokeView(event.stroke), canvas: { w: event.canvas.w, h: event.canvas.h } },
          };
    case RoomEventType.SketchCleared:
      return viewer === event.drawerId ? null : { type: ServerMessageType.SketchCleared, data: {} };
    case RoomEventType.ReactionSent:
      return viewer === event.userId
        ? null
        : { type: ServerMessageType.Reaction, data: { userId: event.userId, reaction: REACTION_WIRE[event.reaction] } };
    case RoomEventType.VotesChanged:
      return { type: ServerMessageType.Votes, data: { votes: votesView(event.votes) } };
    case RoomEventType.AnswerTyped:
      return viewer === event.mafiaId ? null : { type: ServerMessageType.AnswerTyping, data: { answer: event.answer } };
  }
}
