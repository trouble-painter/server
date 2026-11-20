import { z } from 'zod';
import { Locale } from '../../domain/locale.js';

/** Wire values of the WebSocket protocol (protocol.md). Every protocol string is defined here once. */

export const WS_PATH = '/ws';

export enum ClientMessageType {
  CreateRoom = 'CREATE_ROOM',
  JoinRoom = 'JOIN_ROOM',
  LeaveRoom = 'LEAVE_ROOM',
  UpdateRule = 'UPDATE_RULE',
  SetReady = 'SET_READY',
  KickPlayer = 'KICK_PLAYER',
  StartGame = 'START_GAME',
  DrawStroke = 'DRAW_STROKE',
  ClearSketch = 'CLEAR_SKETCH',
  UndoStroke = 'UNDO_STROKE',
  EndTurn = 'END_TURN',
  Reaction = 'REACTION',
  Vote = 'VOTE',
  TypeAnswer = 'TYPE_ANSWER',
  SubmitAnswer = 'SUBMIT_ANSWER',
  MatchJoin = 'MATCH_JOIN',
  MatchCancel = 'MATCH_CANCEL',
  PushToken = 'PUSH_TOKEN',
}

export enum ServerMessageType {
  Hello = 'HELLO',
  Room = 'ROOM',
  Players = 'PLAYERS',
  Idle = 'IDLE',
  Error = 'ERROR',
  Turn = 'TURN',
  Stroke = 'STROKE',
  SketchCleared = 'SKETCH_CLEARED',
  StrokeUndone = 'STROKE_UNDONE',
  Reaction = 'REACTION',
  Votes = 'VOTES',
  AnswerTyping = 'ANSWER_TYPING',
  Matching = 'MATCHING',
}

export enum IdleReason {
  Left = 'LEFT',
  Kicked = 'KICKED',
  MatchCanceled = 'MATCH_CANCELED',
}

export enum WireErrorCode {
  InvalidRequest = 'INVALID_REQUEST',
  RoomNotFound = 'ROOM_NOT_FOUND',
  RoomFull = 'ROOM_FULL',
  RoomInGame = 'ROOM_IN_GAME',
  AlreadyInGame = 'ALREADY_IN_GAME',
  NotInRoom = 'NOT_IN_ROOM',
  NotHost = 'NOT_HOST',
  NotEnoughPlayers = 'NOT_ENOUGH_PLAYERS',
  NotAllReady = 'NOT_ALL_READY',
  InvalidPhase = 'INVALID_PHASE',
  NotYourTurn = 'NOT_YOUR_TURN',
  Internal = 'INTERNAL',
}

export enum CloseCode {
  GoingAway = 1001,
  Replaced = 4000,
  RateLimited = 4001,
}

export interface ServerMessage {
  type: ServerMessageType;
  data: unknown;
}

const LOCALE_WIRE = {
  [Locale.Ko]: 'KO',
  [Locale.En]: 'EN',
} as const satisfies Record<Locale, string>;

type WireLocale = (typeof LOCALE_WIRE)[Locale];

const LOCALE_FROM_WIRE = new Map(Object.entries(LOCALE_WIRE).map(([locale, wire]) => [wire, locale as Locale]));

export function localeToWire(locale: Locale): WireLocale {
  return LOCALE_WIRE[locale];
}

export const LocaleSchema = z
  .enum(Object.values(LOCALE_WIRE) as [WireLocale, ...WireLocale[]])
  .transform((wire) => LOCALE_FROM_WIRE.get(wire) as Locale);

export function errorMessage(request: string | null, code: WireErrorCode): ServerMessage {
  return { type: ServerMessageType.Error, data: { request, code } };
}
