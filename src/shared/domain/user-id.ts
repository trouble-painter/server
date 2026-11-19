declare const userIdBrand: unique symbol;

/** Positive integer below 2^53 (the app parses it as a Dart int). */
export type UserId = number & { readonly [userIdBrand]: true };

export function toUserId(value: number): UserId | null {
  return Number.isSafeInteger(value) && value > 0 ? (value as UserId) : null;
}
