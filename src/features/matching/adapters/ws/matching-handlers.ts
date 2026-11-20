import { z } from 'zod';
import { ClientMessageType, IdleReason, LocaleSchema } from '../../../../shared/adapters/ws/protocol.js';
import type { WsRouter } from '../../../../shared/adapters/ws/router.js';
import { idleMessage } from '../../../game/adapters/ws/room-presenter.js';
import { NicknameSchema } from '../../../game/adapters/ws/room-handlers.js';
import type { Matchmaking } from '../../application/matchmaking.js';
import { matchingMessage } from './matching-presenter.js';

export function registerMatchingHandlers(router: WsRouter, deps: { matchmaking: Matchmaking }): void {
  router.register(
    ClientMessageType.MatchJoin,
    z.object({ nickname: NicknameSchema, locale: LocaleSchema }),
    (userId, { nickname, locale }) => {
      return matchingMessage(deps.matchmaking.join(userId, nickname, locale));
    },
  );
  router.register(ClientMessageType.MatchAccept, z.object({}), (userId) => {
    const status = deps.matchmaking.accept(userId);
    // Not queued, or the game has started: the room has already been sent.
    return status === null ? null : matchingMessage(status);
  });
  router.register(ClientMessageType.MatchCancel, z.object({}), (userId) => {
    deps.matchmaking.release(userId);
    return idleMessage(IdleReason.MatchCanceled);
  });
}
