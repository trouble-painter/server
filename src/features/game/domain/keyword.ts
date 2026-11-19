export interface KeywordCategory {
  readonly category: string;
  readonly keywords: readonly string[];
}

/** Whitespace, letter case and Unicode composition do not matter when guessing. */
export function isCorrectGuess(guess: string, keyword: string): boolean {
  return normalize(guess) === normalize(keyword);
}

function normalize(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}
