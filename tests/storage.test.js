import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStorage, validatePublicReport } from '../src/server/storage.js';

const generatedAt = '2026-11-18T10:00:00.000Z';
const now = () => Date.parse(generatedAt);
const report = { schemaVersion: 1, generatedAt, sports: { nba: { status: 'research', metrics: null } } };
function fixture() {
  const files = Object.fromEntries(['nba', 'football', 'nhl', 'tennis'].map(s => [`history/${s}.json`, JSON.stringify({ schemaVersion: 1, updatedAt: generatedAt, events: [] })]));
  files['reports/models.json'] = JSON.stringify(report);
  const manifest = { schemaVersion: 1, repository: 'antoniobialaczek-ctrl/SportLab-', branch: 'sportlab-data', generatedAt, dataCommit: 'a'.repeat(40), files: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }])) };
  return { files, manifest };
}
async function local(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sportlab-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'reports'));
  await writeFile(join(directory, 'reports/models.json'), JSON.stringify(report));
  return pathToFileURL(directory + '/');
}
test('public data uses hash-verified immutable commit and caches one generation', async t => {
  const root = await local(t), { files, manifest } = fixture(), urls = [];
  const storage = createStorage({ root, remoteEnabled: true, now, fetchImpl: async url => {
    urls.push(url);
    if (url.endsWith('/manifest.json')) return new Response(JSON.stringify(manifest));
    assert.ok(url.includes(`/${manifest.dataCommit}/`));
    return new Response(files[url.split(`/${manifest.dataCommit}/`)[1]]);
  } });
  assert.equal((await storage.readReports()).runtimeData.origin, 'github');
  assert.equal((await storage.readReports()).runtimeData.fallback, false);
  assert.equal(urls.length, 2);
});
test('wrong content hash fails closed to explicitly labeled local data', async t => {
  const root = await local(t), { manifest } = fixture();
  const storage = createStorage({ root, remoteEnabled: true, now, fetchImpl: async url => new Response(url.endsWith('/manifest.json') ? JSON.stringify(manifest) : '{}') });
  const result = await storage.readReports();
  assert.equal(result.runtimeData.origin, 'local');
  assert.equal(result.runtimeData.fallback, true);
  assert.deepEqual(result.sports, report.sports);
});
test('stale or future manifest cannot be presented as a current automatic update', async t => {
  const root = await local(t);
  for (const generatedAt of ['2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z']) {
    const { manifest } = fixture(); manifest.generatedAt = generatedAt;
    const storage = createStorage({ root, remoteEnabled: true, now, fetchImpl: async () => new Response(JSON.stringify(manifest)) });
    assert.equal((await storage.readReports()).runtimeData.fallback, true);
  }
});
test('public artifact rejects forecast vectors and malformed evaluation metrics', () => {
  assert.throws(() => validatePublicReport({ ...report, forecasts: [{ probabilities: [0.5, 0.5] }] }));
  assert.throws(() => validatePublicReport({ ...report, sports: { nba: { status: 'research', metrics: { count: 1, accuracy: 2 } } } }));
});
