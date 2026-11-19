/** `word` is what citizens see and END reveals; a guess matching a synonym counts as correct too. */
export interface Keyword {
  readonly word: string;
  readonly synonyms: readonly string[];
}

/** `id` is the same in every locale; `category` is the name shown in the room's locale. */
export interface KeywordCategory {
  readonly id: string;
  readonly category: string;
  readonly keywords: readonly Keyword[];
}

/** Matches the word or any synonym; whitespace, letter case and Unicode composition do not matter. */
export function isCorrectGuess(guess: string, keyword: Keyword): boolean {
  const normalized = normalize(guess);
  return [keyword.word, ...keyword.synonyms].some((answer) => normalize(answer) === normalized);
}

function normalize(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}
