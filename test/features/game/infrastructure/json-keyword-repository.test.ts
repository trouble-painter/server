import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonKeywordRepository } from '../../../../src/features/game/infrastructure/keywords/json-keyword-repository.js';
import { Locale } from '../../../../src/shared/domain/locale.js';
import { KEYWORDS_FIXTURE_DIR } from '../../../support/game.js';

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'keywords-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const VALID = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: 'x', synonyms: [] }] }]);

describe('JsonKeywordRepository', () => {
  it('loads one file per locale', () => {
    const repo = JsonKeywordRepository.load(KEYWORDS_FIXTURE_DIR);
    expect(repo.categories(Locale.Ko)[0]).toEqual({
      id: 'animal',
      category: '동물',
      keywords: [
        { word: '고양이', synonyms: ['야옹이'] },
        { word: '강아지', synonyms: ['개'] },
      ],
    });
    expect(repo.categories(Locale.En)[1]).toEqual({ id: 'food', category: 'Food', keywords: [{ word: 'Pizza', synonyms: [] }] });
  });

  it('fails when a locale file is missing', () => {
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID }))).toThrow(/en\.json/);
  });

  it('fails on an empty category or a blank keyword', () => {
    const empty = JSON.stringify([{ id: 'a', category: 'A', keywords: [] }]);
    const blank = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: ' ', synonyms: [] }] }]);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': empty, 'en.json': VALID }))).toThrow(/Invalid keyword file/);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID, 'en.json': blank }))).toThrow(/Invalid keyword file/);
  });

  it('fails on a keyword or synonym with whitespace in it', () => {
    const spacedWord = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: 'Ice cream', synonyms: [] }] }]);
    const spacedSynonym = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: 'Dog', synonyms: ['Hot dog'] }] }]);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': spacedWord, 'en.json': VALID }))).toThrow(/without whitespace/);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID, 'en.json': spacedSynonym }))).toThrow(/without whitespace/);
  });

  it('fails on a missing, malformed or repeated category id', () => {
    const missing = JSON.stringify([{ category: 'A', keywords: [{ word: 'x', synonyms: [] }] }]);
    const malformed = JSON.stringify([{ id: 'Not ok', category: 'A', keywords: [{ word: 'x', synonyms: [] }] }]);
    const repeated = JSON.stringify([
      { id: 'a', category: 'A', keywords: [{ word: 'x', synonyms: [] }] },
      { id: 'a', category: 'B', keywords: [{ word: 'y', synonyms: [] }] },
    ]);
    for (const file of [missing, malformed, repeated]) {
      expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': file, 'en.json': VALID }))).toThrow(/Invalid keyword file/);
    }
  });

  it('fails when locales offer different category ids', () => {
    const other = JSON.stringify([{ id: 'b', category: 'B', keywords: [{ word: 'x', synonyms: [] }] }]);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID, 'en.json': other }))).toThrow(/different category ids/);
  });
});
