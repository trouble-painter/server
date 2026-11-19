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

const VALID = JSON.stringify([{ category: 'A', keywords: ['x'] }]);

describe('JsonKeywordRepository', () => {
  it('loads one file per locale', () => {
    const repo = JsonKeywordRepository.load(KEYWORDS_FIXTURE_DIR);
    expect(repo.categories(Locale.Ko)[0]).toEqual({ category: '동물', keywords: ['고양이', '강아지'] });
    expect(repo.categories(Locale.En)[1]).toEqual({ category: 'Food', keywords: ['Pizza'] });
  });

  it('fails when a locale file is missing', () => {
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID }))).toThrow(/en\.json/);
  });

  it('fails on an empty category or a blank keyword', () => {
    const empty = JSON.stringify([{ category: 'A', keywords: [] }]);
    const blank = JSON.stringify([{ category: 'A', keywords: [' '] }]);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': empty, 'en.json': VALID }))).toThrow(/Invalid keyword file/);
    expect(() => JsonKeywordRepository.load(dirWith({ 'ko.json': VALID, 'en.json': blank }))).toThrow(/Invalid keyword file/);
  });
});
