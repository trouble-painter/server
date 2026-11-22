// Records what dist/ was built from, so the running server can report it.
// version is package.json's (bumped by hand per release); commit pins the exact source.
// Run after tsc (npm run build does); the server reads dist/build-info.json at startup.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dirty = git('status', '--porcelain') !== '';
const commit = `${git('rev-parse', '--short', 'HEAD')}${dirty ? '-dirty' : ''}`;

writeFileSync(new URL('../dist/build-info.json', import.meta.url), `${JSON.stringify({ version, commit })}\n`);
console.log(`build ${version} (${commit})`);
