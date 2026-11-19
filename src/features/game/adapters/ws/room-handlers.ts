import { z } from 'zod';
import { ClientMessageType, IdleReason, LocaleSchema, type ServerMessage } from '../../../../shared/adapters/ws/protocol.js';
import type { WsRouter } from '../../../../shared/adapters/ws/router.js';
import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { UserId } from '../../../../shared/domain/user-id.js';
import type { ConnectUser } from '../../application/usecases/connect-user.js';
import type { CreateRoom } from '../../application/usecases/create-room.js';
import type { DisconnectUser } from '../../application/usecases/disconnect-user.js';
import type { JoinRoom } from '../../application/usecases/join-room.js';
import type { LeaveRoom } from '../../application/usecases/leave-room.js';
import { toNickname, type Nickname } from '../../domain/nickname.js';
import { helloMessage, idleMessage, roomMessage } from './room-presenter.js';

const NicknameSchema = z.string().transform((value, ctx): Nickname => {
  const nickname = toNickname(value);
  if (nickname === null) {
    ctx.addIssue({ code: 'custom', message: 'invalid nickname' });
    return z.NEVER;
  }
  return nickname;
});

/** Generous bound only; JoinRoom treats any malformed code as a missing room. */
const ROOM_CODE_INPUT_MAX = 32;

export function registerRoomHandlers(
  router: WsRouter,
  deps: { createRoom: CreateRoom; joinRoom: JoinRoom; leaveRoom: LeaveRoom },
): void {
  router.register(
    ClientMessageType.CreateRoom,
    z.object({ nickname: NicknameSchema, locale: LocaleSchema }),
    (userId, { nickname, locale }) => roomMessage(deps.createRoom.execute(userId, nickname, locale)),
  );
  router.register(
    ClientMessageType.JoinRoom,
    z.object({ roomId: z.string().max(ROOM_CODE_INPUT_MAX), nickname: NicknameSchema }),
    (userId, { roomId, nickname }) => roomMessage(deps.joinRoom.execute(userId, roomId, nickname)),
  );
  router.register(ClientMessageType.LeaveRoom, z.object({}), (userId) => {
    deps.leaveRoom.execute(userId);
    return idleMessage(IdleReason.Left);
  });
}

export function connectionHandlers(deps: { connectUser: ConnectUser; disconnectUser: DisconnectUser; clock: Clock }) {
  return {
    onConnect: (userId: UserId): ServerMessage => helloMessage(deps.clock.now(), deps.connectUser.execute(userId)),
    onDisconnect: (userId: UserId): void => deps.disconnectUser.execute(userId),
  };
}
