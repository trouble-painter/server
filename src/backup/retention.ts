/** The two rotations kept in the backup repository; each value is also the directory name. */
export enum BackupKind {
  Daily = 'daily',
  Weekly = 'weekly',
}

/** How many backups of each kind stay; the oldest are dropped first. */
export const KEEP_COUNT: Readonly<Record<BackupKind, number>> = {
  [BackupKind.Daily]: 10,
  [BackupKind.Weekly]: 5,
};

/** A weekly backup is added once the newest one is at least this many days old. */
export const WEEKLY_INTERVAL_DAYS = 7;

/** Dates in the backup file names are in this time zone. Keep the timer's `OnCalendar` in the same one. */
export const BACKUP_TIME_ZONE = 'Asia/Seoul';

const MS_PER_DAY = 86_400_000;
const FILE_EXTENSION = '.db.gz';
const BACKUP_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.db\.gz$/;

/** File names per kind. Names are `YYYY-MM-DD.db.gz`, so sorting them sorts by date. */
export type BackupFiles = Record<BackupKind, string[]>;

export function backupFileName(date: string): string {
  return `${date}${FILE_EXTENSION}`;
}

export function isBackupFileName(name: string): boolean {
  return BACKUP_FILE_PATTERN.test(name);
}

/** Today's `YYYY-MM-DD` in {@link BACKUP_TIME_ZONE}. */
export function todayOf(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: BACKUP_TIME_ZONE }).format(now);
}

/**
 * The files that should exist after today's backup: today's file in daily, and in weekly too
 * when there is none yet or the newest is {@link WEEKLY_INTERVAL_DAYS} days old. Anything over
 * {@link KEEP_COUNT} is cut from the oldest end. Running twice on the same day changes nothing.
 */
export function planBackup(existing: BackupFiles, today: string): BackupFiles {
  const todayFile = backupFileName(today);
  const daily = existing[BackupKind.Daily];
  const weekly = existing[BackupKind.Weekly];
  const newestWeekly = weekly.toSorted().at(-1);
  const weeklyDue = newestWeekly === undefined || daysBetween(newestWeekly.slice(0, 10), today) >= WEEKLY_INTERVAL_DAYS;
  return {
    [BackupKind.Daily]: keepNewest(BackupKind.Daily, [...daily, todayFile]),
    [BackupKind.Weekly]: keepNewest(BackupKind.Weekly, weeklyDue ? [...weekly, todayFile] : weekly),
  };
}

function keepNewest(kind: BackupKind, names: string[]): string[] {
  return [...new Set(names)].sort().slice(-KEEP_COUNT[kind]);
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY;
}
