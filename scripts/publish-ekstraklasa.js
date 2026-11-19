import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateEkstraklasaHistory, validateEkstraklasaManifest as validateHistoryManifest } from '../src/server/ekstraklasa-history.js';

const REPOSITORY = 'antoniobialaczek-ctrl/SportLab-';
const BRANCH = 'sportlab-ekstraklasa-data';
const ARTIFACT = 'ekstraklasa.json';
const destination = new URL('../data/supplemental/ekstraklasa.json', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateEkstraklasaManifest(value, now = Date.now()) {
  return validateHistoryManifest(value, { now, allowStale: true });
}

export function verifyEkstraklasaArtifact(manifest, bytes, { now = Date.now() } = {}) {
  validateEkstraklasaManifest(manifest, now);
  const info = manifest.files[ARTIFACT];
  if (bytes.length !== info.bytes || digest(bytes) !== info.sha256) throw new Error('Niezgodny skrót lub rozmiar oddzielnej historii Ekstraklasy');
  return validateEkstraklasaHistory(JSON.parse(bytes.toString('utf8')));
}

/** Only JSON data is read from this branch; never run code from it. Old valid
 * observations may be restored after a pause without rewriting their times.
 */
export async function publishEkstraklasa(operation, { path = destination, repository = process.env.GH_REPO || REPOSITORY } = {}) {
  if (!['restore', 'publish'].includes(operation)) throw new Error('Użyj restore lub publish dla danych Ekstraklasy');
  if (repository !== REPOSITORY) throw new Error('Nieprawidłowy cel oddzielnych danych Ekstraklasy');
  if (!process.env.GH_TOKEN) throw new Error('Brak tokenu workflow GitHub w środowisku');
  const directory = await mkdtemp(join(tmpdir(), 'sportlab-ekstraklasa-'));
  const git = (args, { raw = false, absentRefAllowed = false } = {}) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 34 * 1024 * 1024 });
    if (absentRefAllowed && result.status === 2 && !result.error) return null;
    if (result.error || result.status !== 0) throw new Error(`Oddzielna publikacja Ekstraklasy: ${result.stderr?.trim() || result.error?.message || 'błąd git'}`);
    return raw ? result.stdout : result.stdout.trim();
  };
  try {
    git(['init', '-b', BRANCH]);
    git(['config', 'user.name', 'SportLab supplemental data automation']);
    git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    git(['config', 'credential.helper', '']);
    git(['config', '--add', 'credential.helper', '!gh auth git-credential']);
    git(['remote', 'add', 'origin', `https://github.com/${repository}.git`]);
    const previous = git(['ls-remote', '--exit-code', '--heads', 'origin', BRANCH], { absentRefAllowed: true });
    if (previous) {
      git(['fetch', '--depth', '2', 'origin', BRANCH]);
      git(['checkout', '-B', BRANCH, 'FETCH_HEAD']);
      if (git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').some(path => ![ARTIFACT, 'manifest.json'].includes(path))) throw new Error('Gałąź Ekstraklasy zawiera pliki inne niż oddzielne dane');
    }
    if (operation === 'restore') {
      if (!previous) {
        validateEkstraklasaHistory(JSON.parse(await readFile(path, 'utf8')));
        return { restored: false, bootstrap: true, branch: BRANCH };
      }
      const manifest = validateEkstraklasaManifest(JSON.parse(git(['show', 'HEAD:manifest.json'], { raw: true })));
      const bytes = Buffer.from(git(['show', `${manifest.dataCommit}:${ARTIFACT}`], { raw: true }), 'utf8');
      const data = verifyEkstraklasaArtifact(manifest, bytes);
      const file = path instanceof URL ? fileURLToPath(path) : resolve(path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, bytes);
      await rename(`${file}.tmp`, file);
      return { restored: true, branch: BRANCH, dataCommit: manifest.dataCommit, events: data.events.length };
    }
    const bytes = await readFile(path);
    const data = validateEkstraklasaHistory(JSON.parse(bytes.toString('utf8')));
    if (!Number.isFinite(Date.parse(data.fetchedAt)) || Date.now() - Date.parse(data.fetchedAt) > 86400000 || Date.parse(data.fetchedAt) > Date.now() + 300000) throw new Error('Do publikacji potrzebna jest świeża kompletna aktualizacja Ekstraklasy');
    await writeFile(join(directory, ARTIFACT), bytes);
    git(['add', '--', ARTIFACT]);
    git(['commit', '--allow-empty', '-m', 'Update verified supplemental Ekstraklasa observations']);
    const dataCommit = git(['rev-parse', 'HEAD']);
    const manifest = { schemaVersion: 1, repository, branch: BRANCH, source: 'TheSportsDB', generatedAt: new Date().toISOString(), dataCommit,
      files: { [ARTIFACT]: { bytes: bytes.length, sha256: digest(bytes) } } };
    verifyEkstraklasaArtifact(manifest, bytes);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    git(['add', '--', 'manifest.json']);
    git(['commit', '-m', 'Publish immutable supplemental Ekstraklasa manifest']);
    // One non-forced push publishes both commits atomically. No application,
    // workflow, model, raw response or production deployment is published.
    git(['push', 'origin', `HEAD:refs/heads/${BRANCH}`]);
    return { repository, branch: BRANCH, dataCommit, manifestCommit: git(['rev-parse', 'HEAD']), events: data.events.length };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await publishEkstraklasa(process.argv[2])));
}
