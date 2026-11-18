import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateHistory } from '../src/data/schema.js';
import { validatePublicReport } from '../src/server/storage.js';

const repository = process.env.GH_REPO || 'antoniobialaczek-ctrl/SportLab-';
if (repository !== 'antoniobialaczek-ctrl/SportLab-') throw new Error('Nieprawidłowy cel publikacji danych SportLab');
if (!process.env.GH_TOKEN) throw new Error('Brak uwierzytelnienia GitHub w środowisku publikacji');
const branch = 'sportlab-data';
const root = fileURLToPath(new URL('../data/', import.meta.url));
const files = new Map();
for (const sport of ['nba', 'football', 'nhl', 'tennis']) {
  const path = `history/${sport}.json`;
  const bytes = await readFile(new URL(path, `file://${root}`));
  validateHistory(JSON.parse(bytes.toString()), sport);
  files.set(path, bytes);
}
for (const name of ['models', 'forward']) {
  const path = `reports/${name}.json`;
  try {
    const bytes = await readFile(join(root, path));
    validatePublicReport(JSON.parse(bytes.toString()), { forward: name === 'forward' });
    files.set(path, bytes);
  } catch (error) { if (error.code !== 'ENOENT' || name === 'models') throw error; }
}
const directory = await mkdtemp(join(tmpdir(), 'sportlab-publication-'));
function git(args, { optional = false } = {}) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 2_000_000 });
  if (result.error || result.status !== 0) {
    if (optional) return null;
    // Git uses a credential helper; neither arguments nor errors contain tokens.
    throw new Error(`Publikacja danych: ${result.stderr?.trim() || result.error?.message || 'błąd git'}`);
  }
  return result.stdout.trim();
}
try {
  git(['init', '-b', branch]);
  git(['config', 'user.name', 'SportLab data automation']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(['config', 'credential.helper', '']);
  git(['config', '--add', 'credential.helper', '!gh auth git-credential']);
  git(['remote', 'add', 'origin', `https://github.com/${repository}.git`]);
  const head = git(['ls-remote', '--exit-code', '--heads', 'origin', branch], { optional: true });
  if (head) {
    git(['fetch', '--depth', '1', 'origin', branch]);
    git(['checkout', '-B', branch, 'FETCH_HEAD']);
  }
  for (const [path, bytes] of files) {
    await mkdir(join(directory, path.split('/')[0]), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  // Nothing from the source repository, raw snapshots or private forecasts is copied.
  git(['add', '--', 'history', 'reports']);
  git(['commit', '--allow-empty', '-m', 'Update verified SportLab public data files']);
  const dataCommit = git(['rev-parse', 'HEAD']);
  const manifest = {
    schemaVersion: 1, repository, branch, generatedAt: new Date().toISOString(), dataCommit,
    files: Object.fromEntries([...files].map(([path, bytes]) => [path, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }])),
  };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  git(['add', '--', 'manifest.json']);
  git(['commit', '-m', 'Publish immutable SportLab data manifest']);
  // No force push: concurrent publications cannot overwrite one another.
  git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  console.log(JSON.stringify({ repository, branch, dataCommit, manifestCommit: git(['rev-parse', 'HEAD']), files: [...files.keys()] }));
} finally { await rm(directory, { recursive: true, force: true }); }
