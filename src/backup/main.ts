/**
 * Backs up the game history to the private backup repository. Run daily by a systemd timer
 * on the server (see backup/); the repository always ends up as one parentless commit
 * holding at most the kept daily and weekly files.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../shared/infrastructure/config/env.js';
import { BackupKind, backupFileName, isBackupFileName, planBackup, todayOf, type BackupFiles } from './retention.js';
import { gzipFile, writeSnapshot } from './snapshot.js';

const BRANCH = 'main';
const COMMIT_IDENTITY = { name: 'trouble-painter backup', email: 'backup@trouble-painter.invalid' };
/** `git ls-remote --exit-code` exits with this when the remote has no matching ref (an empty repository). */
const NO_MATCHING_REF = 2;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const env = loadEnv();
const repoUrl = requiredEnv('BACKUP_REPO_URL');
const sshKey = requiredEnv('BACKUP_SSH_KEY');
const gitEnv = {
  ...process.env,
  GIT_SSH_COMMAND: `ssh -i ${sshKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
  GIT_AUTHOR_NAME: COMMIT_IDENTITY.name,
  GIT_AUTHOR_EMAIL: COMMIT_IDENTITY.email,
  GIT_COMMITTER_NAME: COMMIT_IDENTITY.name,
  GIT_COMMITTER_EMAIL: COMMIT_IDENTITY.email,
};

function git(args: string[], cwd?: string): void {
  execFileSync('git', args, { cwd, env: gitEnv, stdio: ['ignore', 'inherit', 'inherit'] });
}

function remoteHasBranch(): boolean {
  const { status } = spawnSync('git', ['ls-remote', '--exit-code', '--heads', repoUrl, BRANCH], { env: gitEnv, stdio: 'ignore' });
  if (status === 0) {
    return true;
  }
  if (status === NO_MATCHING_REF) {
    return false;
  }
  throw new Error(`git ls-remote failed (exit ${status})`);
}

function listFiles(repo: string): BackupFiles {
  const filesOf = (kind: BackupKind): string[] => {
    const dir = join(repo, kind);
    return existsSync(dir) ? readdirSync(dir).filter(isBackupFileName) : [];
  };
  return { [BackupKind.Daily]: filesOf(BackupKind.Daily), [BackupKind.Weekly]: filesOf(BackupKind.Weekly) };
}

const today = todayOf(new Date());
const work = mkdtempSync(join(tmpdir(), 'server-backup-'));
try {
  const repo = join(work, 'repo');
  if (remoteHasBranch()) {
    git(['clone', '--quiet', '--depth', '1', '--branch', BRANCH, repoUrl, repo]);
  } else {
    mkdirSync(repo);
  }

  const snapshotPath = join(work, 'snapshot.db');
  const archivePath = join(work, backupFileName(today));
  writeSnapshot(env.SQLITE_PATH, snapshotPath);
  await gzipFile(snapshotPath, archivePath);

  const existing = listFiles(repo);
  const kept = planBackup(existing, today);
  for (const kind of Object.values(BackupKind)) {
    mkdirSync(join(repo, kind), { recursive: true });
    for (const name of existing[kind].filter((file) => !kept[kind].includes(file))) {
      rmSync(join(repo, kind, name));
    }
    if (kept[kind].includes(backupFileName(today))) {
      copyFileSync(archivePath, join(repo, kind, backupFileName(today)));
    }
    console.log(`${kind}: ${kept[kind].join(', ')}`);
  }

  // Start the history over so the repository never grows past the kept files.
  rmSync(join(repo, '.git'), { recursive: true, force: true });
  git(['init', '--quiet', '--initial-branch', BRANCH], repo);
  git(['add', '--all'], repo);
  git(['commit', '--quiet', '--message', `Chore: back up game history on ${today}.`], repo);
  git(['push', '--quiet', '--force', repoUrl, `${BRANCH}:${BRANCH}`], repo);
  console.log(`pushed backup for ${today}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
