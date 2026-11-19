export enum RoomEventType {
  PlayersChanged = 'playersChanged',
}

export type RoomEvent = { readonly type: RoomEventType.PlayersChanged };
