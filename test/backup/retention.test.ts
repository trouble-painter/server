import { describe, expect, it } from 'vitest';
import { BackupKind, backupFileName, isBackupFileName, KEEP_COUNT, planBackup, todayOf, type BackupFiles } from '../../src/backup/retention.js';

const file = backupFileName;
const none: BackupFiles = { [BackupKind.Daily]: [], [BackupKind.Weekly]: [] };

/** `count` consecutive days ending on `last` (UTC math; all dates are well inside one month pair). */
function daysUpTo(last: string, count: number): string[] {
  const end = Date.parse(`${last}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => file(new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10)));
}

describe('planBackup', () => {
  it('adds today to both kinds on the first run', () => {
    expect(planBackup(none, '2026-11-22')).toEqual({
      [BackupKind.Daily]: [file('2026-11-22')],
      [BackupKind.Weekly]: [file('2026-11-22')],
    });
  });

  it('drops the oldest daily file past the daily limit', () => {
    const daily = daysUpTo('2026-11-21', KEEP_COUNT[BackupKind.Daily]);
    const plan = planBackup({ [BackupKind.Daily]: daily, [BackupKind.Weekly]: [file('2026-11-20')] }, '2026-11-22');
    expect(plan[BackupKind.Daily]).toEqual([...daily.slice(1), file('2026-11-22')]);
  });

  it('adds a weekly file only once the newest is 7 days old', () => {
    const weekly = { [BackupKind.Daily]: [], [BackupKind.Weekly]: [file('2026-11-15')] };
    expect(planBackup(weekly, '2026-11-21')[BackupKind.Weekly]).toEqual([file('2026-11-15')]);
    expect(planBackup(weekly, '2026-11-22')[BackupKind.Weekly]).toEqual([file('2026-11-15'), file('2026-11-22')]);
    expect(planBackup(weekly, '2026-11-30')[BackupKind.Weekly]).toEqual([file('2026-11-15'), file('2026-11-30')]);
  });

  it('drops the oldest weekly file past the weekly limit', () => {
    const weekly = ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15'].map(file);
    const plan = planBackup({ [BackupKind.Daily]: [], [BackupKind.Weekly]: weekly }, '2026-11-22');
    expect(plan[BackupKind.Weekly]).toEqual([...weekly.slice(1), file('2026-11-22')]);
  });

  it('is idempotent within a day', () => {
    const once = planBackup(none, '2026-11-22');
    expect(planBackup(once, '2026-11-22')).toEqual(once);
  });
});

describe('backup file names', () => {
  it('recognizes only dated archives', () => {
    expect(isBackupFileName('2026-11-22.db.gz')).toBe(true);
    expect(isBackupFileName('README.md')).toBe(false);
    expect(isBackupFileName('2026-11-22.db')).toBe(false);
  });

  it('dates by the backup time zone, not UTC', () => {
    // 19:00 UTC on the 21st is already 04:00 on the 22nd in Seoul.
    expect(todayOf(new Date('2026-11-21T19:00:00Z'))).toBe('2026-11-22');
  });
});
