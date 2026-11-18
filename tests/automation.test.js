import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/artifact-state.js', import.meta.url));
async function scenario(t, fixture, command, current = '3') {
  const directory = await mkdtemp(join(tmpdir(), 'sportlab-automation-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin'); await mkdir(bin);
  await writeFile(join(directory, 'fixture.json'), JSON.stringify(fixture));
  const gh = join(bin, 'gh');
  await writeFile(gh, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE, 'utf8'));
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'run' && args[1] === 'list') process.stdout.write(JSON.stringify(fixture.runs));
else if (args[0] === 'api' && args[1].includes('/contents/reports/forward.json')) process.stdout.write(JSON.stringify({content:Buffer.from(JSON.stringify(fixture.publishedReport || {})).toString('base64')}));
else if (args[0] === 'api' && args[1] !== '--method') process.stdout.write(JSON.stringify([{artifacts:fixture.artifacts}]));
else if (args[0] === 'api' && args[1] === '--method') process.exit(0);
else if (args[0] === 'run' && args[1] === 'download') {
  if (fixture.failedDownloads?.includes(args[2])) process.exit(1);
  const target = args[args.indexOf('--dir') + 1];
  fs.mkdirSync(path.join(target, 'forward'), {recursive:true});
  fs.writeFileSync(path.join(target, 'forward/state.json'), JSON.stringify({restoredFrom:args[2]}));
} else process.exit(2);
`);
  await chmod(gh, 0o700);
  const calls = join(directory, 'calls.jsonl');
  const result = spawnSync(process.execPath, [script, command], {
    cwd: directory, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, GH_REPO: 'test-owner/test-repo', GITHUB_REF_NAME: 'main', NEW_ARTIFACT_ID: current, FIXTURE: join(directory, 'fixture.json'), CALLS: calls, GH_TOKEN: 'synthetic-test-token' },
  });
  const invocations = (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { result, invocations, directory };
}
function artifact(id, overrides = {}) {
  return { id, name: 'sportlab-history', expired: false, created_at: `2026-11-${String(id).padStart(2, '0')}T00:00:00Z`, workflow_run: { id: 100, head_branch: 'main' }, ...overrides };
}

test('rotacja usuwa wyłącznie starszy stan SportLab własnego workflow i gałęzi, zachowuje dwie kopie', async t => {
  const { result, invocations } = await scenario(t, {
    runs: [{ databaseId: 100 }],
    artifacts: [artifact(1), artifact(2), artifact(3), artifact(99, { name: 'unrelated' }), artifact(98, { workflow_run: { id: 100, head_branch: 'another-branch' } }), artifact(97, { expired: true }), artifact(96, { workflow_run: { id: 999, head_branch: 'main' } })],
  }, 'prune');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(invocations.filter(args => args[1] === '--method'), [['api', '--method', 'DELETE', 'repos/test-owner/test-repo/actions/artifacts/1']]);
  const lookup = invocations[0];
  assert.equal(lookup[lookup.indexOf('--workflow') + 1], 'history.yml');
  assert.equal(lookup[lookup.indexOf('--branch') + 1], 'main');
});

test('brak potwierdzonej nowej kopii całkowicie blokuje usuwanie artefaktów', async t => {
  const { result, invocations } = await scenario(t, { runs: [{ databaseId: 100 }], artifacts: [artifact(1), artifact(2)] }, 'prune');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nie został potwierdzony/);
  assert.equal(invocations.filter(args => args[1] === '--method').length, 0);
});

test('odtwarzanie zachowuje migawki także z runu zakończonego błędem i ma drugą kopię rezerwową', async t => {
  const { result, invocations, directory } = await scenario(t, {
    runs: [{ databaseId: 100 }], artifacts: [artifact(2), artifact(3)], failedDownloads: [],
  }, 'restore');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocations[0].includes('--status'), false);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'data/forward/state.json'), 'utf8')), { restoredFrom: '100' });
  assert.equal(invocations.some(args => args[1] === '--method'), false);
});

test('niedostępne istniejące archiwum zatrzymuje aktualizację zamiast utracić wcześniejsze migawki', async t => {
  const { result, invocations } = await scenario(t, { runs: [{ databaseId: 100 }], artifacts: [artifact(2), artifact(3)], failedDownloads: ['100'] }, 'restore');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Zatrzymuję aktualizację/);
  assert.equal(invocations.some(args => args[1] === '--method'), false);
});

test('wygaśnięcie wszystkich artefaktów nie zeruje już opublikowanego eksperymentu', async t => {
  const { result, invocations } = await scenario(t, {
    runs: [{ databaseId: 100 }], artifacts: [artifact(1, { expired: true })],
    publishedReport: { sports: { nba: { samples: { recorded: 43 } } } },
  }, 'restore');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nie zerujemy/);
  assert.equal(invocations.some(args => args[1] === '--method'), false);
});
