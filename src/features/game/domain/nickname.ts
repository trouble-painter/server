declare const nicknameBrand: unique symbol;

export type Nickname = string & { readonly [nicknameBrand]: true };

/** Matches the app's nickname field, which counts user-perceived characters. */
export const NICKNAME_MAX_LENGTH = 7;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Trims the value; null when it is blank or too long. */
export function toNickname(value: string): Nickname | null {
  const trimmed = value.trim();
  const length = [...graphemes.segment(trimmed)].length;
  return length >= 1 && length <= NICKNAME_MAX_LENGTH ? (trimmed as Nickname) : null;
}
