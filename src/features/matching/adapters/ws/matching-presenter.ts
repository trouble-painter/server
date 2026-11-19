import { localeToWire, ServerMessageType, type ServerMessage } from '../../../../shared/adapters/ws/protocol.js';
import type { MatchingStatus } from '../../domain/match-queue.js';

/** The single place a queue status becomes its wire form, for HELLO and MATCHING alike. */
export function matchingView(status: MatchingStatus) {
  return {
    locale: localeToWire(status.locale),
    waitingCount: status.waitingCount,
    startsAt: status.startsAt,
    minCount: status.minCount,
    waitMs: status.waitMs,
  };
}

export function matchingMessage(status: MatchingStatus): ServerMessage {
  return { type: ServerMessageType.Matching, data: matchingView(status) };
}
