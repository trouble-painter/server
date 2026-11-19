/** Assigned in this order to players as they join. */
export enum PlayerColor {
  Red = 'red',
  Orange = 'orange',
  Yellow = 'yellow',
  LightGreen = 'lightGreen',
  Green = 'green',
  LightBlue = 'lightBlue',
  Blue = 'blue',
  Purple = 'purple',
  Pink = 'pink',
  Gray = 'gray',
}

export const PLAYER_COLORS: readonly PlayerColor[] = Object.values(PlayerColor);
