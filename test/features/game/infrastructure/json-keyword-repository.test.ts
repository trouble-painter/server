import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

/** Replaces a file the way rsync does: write a temporary file, then rename it over the old one. */
function replace(dir: string, name: string, content: string): void {
  const tmp = join(dir, `.${name}.tmp`);
  writeFileSync(tmp, content);
  renameSync(tmp, join(dir, name));
}

const SILENT = { info: () => {}, error: () => {} };

const VALID = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: 'x', synonyms: [] }] }]);
const RENAMED = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: 'renamed', synonyms: [] }] }]);
const OTHER_ID = JSON.stringify([{ id: 'b', category: 'B', keywords: [{ word: 'y', synonyms: [] }] }]);

describe('JsonKeywordRepository', () => {
  it('loads one file per locale', () => {
    const repo = JsonKeywordRepository.load(KEYWORDS_FIXTURE_DIR, SILENT);
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
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID }), SILENT)).toThrow(/en\.json/);
  });

  it('fails on an empty category or a blank keyword', () => {
    const empty = JSON.stringify([{ id: 'a', category: 'A', keywords: [] }]);
    const blank = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: ' ', synonyms: [] }] }]);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': empty, 'en.json': VALID }), SILENT)).toThrow(/Invalid keyword file/);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID, 'en.json': blank }), SILENT)).toThrow(/Invalid keyword file/);
  });

  it('fails on a keyword or synonym with whitespace in it', () => {
    const spacedWord = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: 'Ice cream', synonyms: [] }] }]);
    const spacedSynonym = JSON.stringify([{ id: 'a', category: 'A', keywords: [{ word: 'Dog', synonyms: ['Hot dog'] }] }]);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': spacedWord, 'en.json': VALID }), SILENT)).toThrow(/without whitespace/);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID, 'en.json': spacedSynonym }), SILENT)).toThrow(/without whitespace/);
  });

  it('fails on a missing, malformed or repeated category id', () => {
    const missing = JSON.stringify([{ category: 'A', keywords: [{ word: 'x', synonyms: [] }] }]);
    const malformed = JSON.stringify([{ id: 'Not ok', category: 'A', keywords: [{ word: 'x', synonyms: [] }] }]);
    const repeated = JSON.stringify([
      { id: 'a', category: 'A', keywords: [{ word: 'x', synonyms: [] }] },
      { id: 'a', category: 'B', keywords: [{ word: 'y', synonyms: [] }] },
    ]);
    for (const file of [missing, malformed, repeated]) {
      expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': file, 'en.json': VALID }), SILENT)).toThrow(/Invalid keyword file/);
    }
  });

  it('fails when locales offer different category ids', () => {
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID, 'en.json': OTHER_ID }), SILENT)).toThrow(/different category ids/);
  });

  it('reads the files again when one is replaced', () => {
    const dir = dirWith({ 'ko.json': VALID, 'en.json': VALID });
    const repo = JsonKeywordRepository.load(dir, SILENT);
    replace(dir, 'ko.json', RENAMED);
    expect(repo.categories(Locale.Ko)[0]!.keywords[0]!.word).toBe('renamed');
  });

  it('keeps the last good keywords when the new files are invalid, and takes them once they are fixed', () => {
    const dir = dirWith({ 'ko.json': VALID, 'en.json': VALID });
    const logger = { info: vi.fn(), error: vi.fn() };
    const repo = JsonKeywordRepository.load(dir, logger);

    replace(dir, 'ko.json', OTHER_ID);
    expect(repo.categories(Locale.Ko)[0]!.id).toBe('a');
    expect(repo.categories(Locale.Ko)[0]!.id).toBe('a');
    expect(logger.error).toHaveBeenCalledOnce();

    replace(dir, 'en.json', OTHER_ID);
    expect(repo.categories(Locale.Ko)[0]!.id).toBe('b');
    expect(repo.categories(Locale.En)[0]!.id).toBe('b');
  });

  it('keeps the last good keywords when a file goes missing', () => {
    const dir = dirWith({ 'ko.json': VALID, 'en.json': VALID });
    const repo = JsonKeywordRepository.load(dir, SILENT);
    renameSync(join(dir, 'en.json'), join(dir, 'en.json.bak'));
    expect(repo.categories(Locale.En)[0]!.id).toBe('a');
  });
});
