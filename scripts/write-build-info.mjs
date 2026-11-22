// Records which commit dist/ was built from, so the running server can report it.
// Run after tsc (npm run build does); the server reads dist/build-info.json at startup.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const commit = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--porcelain') !== '';
const version = dirty ? `${commit}-dirty` : commit;

writeFileSync(new URL('../dist/build-info.json', import.meta.url), `${JSON.stringify({ version })}\n`);
console.log(`build version ${version}`);
