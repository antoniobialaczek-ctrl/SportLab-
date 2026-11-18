import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Operate only on this workflow's SportLab state bundles in the current branch.
const repository = process.env.GH_REPO;
const branch = process.env.GITHUB_REF_NAME;
const name = 'sportlab-history';
const workflow = 'history.yml';
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !branch) throw new Error('Brak kontekstu repozytorium i gałęzi GitHub.');
const command = process.argv[2];
if (!['restore', 'prune'].includes(command)) throw new Error('Użycie: node scripts/artifact-state.js restore|prune');
function gh(args, { parse = true, optional = false, allowMissing = false } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 5_000_000 });
  if (result.error || result.status !== 0) {
    if (allowMissing && /HTTP 404/.test(result.stderr || '')) return null;
    if (optional) return null;
    throw new Error(`Polecenie GitHub zakończone błędem: ${result.error?.message || result.stderr.trim()}`);
  }
  return parse ? JSON.parse(result.stdout) : result.stdout;
}
const runs = gh(['run', 'list', '--repo', repository, '--workflow', workflow, '--branch', branch, '--limit', '100', '--json', 'databaseId']);
const artifacts = [];
for (const run of runs) {
  const response = gh(['api', `repos/${repository}/actions/runs/${run.databaseId}/artifacts`, '--paginate', '--slurp']);
  for (const page of response) for (const artifact of page.artifacts || []) {
    if (artifact.name === name && !artifact.expired && (!artifact.workflow_run || (artifact.workflow_run.head_branch === branch && artifact.workflow_run.id === run.databaseId))) {
      artifacts.push({ ...artifact, runId: run.databaseId });
    }
  }
  // Restoration needs only the most recent downloadable bundle. A failed run may
  // still contain valid newly captured snapshots alongside the previous report.
  if (command === 'restore' && artifacts.length >= 2) break;
}
artifacts.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
if (command === 'restore') {
  let restored = false;
  for (const artifact of artifacts) {
    const directory = await mkdtemp(join(tmpdir(), 'sportlab-restore-'));
    try {
      const result = gh(['run', 'download', String(artifact.runId), '--repo', repository, '--name', name, '--dir', directory], { parse: false, optional: true });
      if (result === null) continue;
      await mkdir('data', { recursive: true });
      await cp(directory, 'data', { recursive: true, force: true });
      console.log(`Przywrócono stan SportLab z uruchomienia ${artifact.runId}.`);
      restored = true;
      break;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  if (!restored && artifacts.length) throw new Error('Nie udało się przywrócić poprzednich migawek. Zatrzymuję aktualizację, aby nie zastąpić zachowanej historii nowym, niepełnym stanem.');
  if (!restored && runs.some(run => String(run.databaseId) !== process.env.GITHUB_RUN_ID)) {
    const published = gh(['api', `repos/${repository}/contents/reports/forward.json?ref=sportlab-data`], { allowMissing: true });
    if (published) {
      if (typeof published.content !== 'string') throw new Error('Nie można sprawdzić ciągłości opublikowanego eksperymentu.');
      const report = JSON.parse(Buffer.from(published.content, 'base64').toString('utf8'));
      if (report.validation?.registeredAt || Object.values(report.sports || {}).some(sport => sport.samples?.recorded > 0)) {
        throw new Error('Poprzednie archiwum dowodów wygasło, a opublikowany eksperyment już istnieje. Aktualizacja zatrzymana; nie zerujemy prób ani protokołu.');
      }
    }
  }
  if (!restored) console.log('Brak poprzedniego artefaktu; używam zapisanych zbiorów repozytorium i tworzę nowe migawki.');
} else {
  const current = Number(process.env.NEW_ARTIFACT_ID);
  if (!Number.isSafeInteger(current) || !artifacts.some(artifact => artifact.id === current)) {
    throw new Error('Nowy artefakt nie został potwierdzony; poprzednie kopie pozostają zachowane.');
  }
  const keep = new Set([current]);
  for (const artifact of artifacts) { if (keep.size < 2) keep.add(artifact.id); }
  for (const artifact of artifacts) {
    if (keep.has(artifact.id)) continue;
    gh(['api', '--method', 'DELETE', `repos/${repository}/actions/artifacts/${artifact.id}`], { parse: false });
    console.log(`Usunięto starszą kompletną kopię SportLab: ${artifact.id}.`);
  }
  console.log('Zachowano dwie najnowsze kompletne kopie stanu; inne artefakty pozostają bez zmian.');
}
