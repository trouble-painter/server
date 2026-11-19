declare const roomCodeBrand: unique symbol;

/** Six characters from {@link ROOM_CODE_ALPHABET}. */
export type RoomCode = string & { readonly [roomCodeBrand]: true };

/** Uppercase letters and digits without the look-alikes 0, O, 1 and I. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function toRoomCode(value: string): RoomCode | null {
  const valid = value.length === ROOM_CODE_LENGTH && [...value].every((c) => ROOM_CODE_ALPHABET.includes(c));
  return valid ? (value as RoomCode) : null;
}
