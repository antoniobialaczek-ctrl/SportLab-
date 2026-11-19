import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { refreshEkstraklasa, refreshEkstraklasaFile } from '../scripts/refresh-ekstraklasa.js';
import { verifyEkstraklasaArtifact } from '../scripts/publish-ekstraklasa.js';
import { ekstraklasaDayURL, normalizeEkstraklasaResponse } from '../src/server/ekstraklasa-source.js';

const now = Date.parse('2026-11-19T10:00:00.000Z');
const day = '2026-11-18';
const sourceRow = extra => ({ idEvent: '2490318', idLeague: '4422', strSport: 'Soccer', strHomeTeam: 'Home', strAwayTeam: 'Away', idHomeTeam: '135300', idAwayTeam: '135298',
  strTimestamp: `${day}T17:00:00`, dateEvent: day, strTime: '17:00:00', strStatus: 'FT', strPostponed: 'no', intHomeScore: '2', intAwayScore: '1', ...extra });
const snapshot = () => ({ schemaVersion: 1, kind: 'supplemental-descriptive-history', sport: 'football', route: 'soccer/pol.1', modelExperimentEligible: false,
  createdAt: '2026-11-19T09:00:00.000Z', fetchedAt: '2026-11-19T09:00:00.000Z', coverage: { complete: false, from: day, to: day }, observations: [],
  events: normalizeEkstraklasaResponse({ events: [sourceRow()] }, { observedAt: '2026-11-19T09:00:00.000Z', day, sourceURL: ekstraklasaDayURL(day) }).history });

test('daily supplemental refresh requests only seven past UTC days sequentially at no more than ten per minute', async () => {
  let time = now;
  const calls = [];
  const result = await refreshEkstraklasa(null, { clock: () => time, wait: async delay => { time += delay; }, fetchDay: async url => { calls.push({ url, at: time }); return { events: null }; } });
  assert.deepEqual(calls.map(call => new URL(call.url).searchParams.get('d')), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
  assert.ok(calls.slice(1).every((call, index) => call.at - calls[index].at >= 6000));
  assert.equal(result.observations.length, 7); assert.equal(result.coverage.complete, false);
  assert.equal(result.modelExperimentEligible, false); assert.deepEqual(result.events, []);
});

test('unchanged results retain their first actual availability while corrections become available only when newly observed', async () => {
  const previous = snapshot(), original = structuredClone(previous);
  previous.coverage.from = '2026-08-01';
  previous.observations = [{ day: '2026-08-01', sourceURL: ekstraklasaDayURL('2026-08-01'), observedAt: previous.fetchedAt, rawCount: 0, completedCount: 0, possiblyTruncated: false, exclusions: [] }];
  Object.assign(original, structuredClone(previous));
  const unchanged = await refreshEkstraklasa(previous, { days: 1, clock: () => now, fetchDay: async () => ({ events: [sourceRow()] }) });
  assert.equal(unchanged.events[0].firstObservedAt, previous.events[0].firstObservedAt);
  assert.equal(unchanged.events[0].resultAvailableAt, previous.events[0].resultAvailableAt);
  assert.equal(unchanged.coverage.from, '2026-08-01');
  assert.equal(unchanged.observations[0].day, '2026-08-01');
  const correctionTime = now + 86400000;
  let time = correctionTime;
  const corrected = await refreshEkstraklasa(previous, { days: 2, clock: () => time, wait: async delay => { time += delay; }, fetchDay: async url => ({ events: new URL(url).searchParams.get('d') === day ? [sourceRow({ intHomeScore: '3' })] : null }) });
  assert.equal(corrected.events[0].firstObservedAt, previous.events[0].firstObservedAt);
  assert.ok(Date.parse(corrected.events[0].resultAvailableAt) >= correctionTime);
  assert.equal(corrected.events[0].revisions[0].previous.homeScore, 2);
  assert.deepEqual(previous, original);
  await assert.rejects(refreshEkstraklasa(previous, { days: 1, clock: () => now, fetchDay: async () => ({ events: [sourceRow({ idHomeTeam: '135301' })] }) }), /tożsamość/);
});

test('HTTP 429 or later-day failure preserves the complete previous file byte for byte and is never retried', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sportlab-ekstraklasa-refresh-test-'));
  try {
    const path = join(directory, 'ekstraklasa.json'), bytes = JSON.stringify(snapshot(), null, 2) + '\n';
    await writeFile(path, bytes);
    let calls = 0, time = now;
    await assert.rejects(refreshEkstraklasaFile({ path, clock: () => time, wait: async delay => { time += delay; }, fetchDay: async () => {
      if (++calls === 2) throw new Error('TheSportsDB zwróciło HTTP 429');
      return { events: null };
    } }), /429/);
    assert.equal(calls, 2);
    assert.equal(await readFile(path, 'utf8'), bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication validates exact immutable artifact hash and rejects fixture or manifest substitution', () => {
  const verify = (manifest, bytes) => verifyEkstraklasaArtifact(manifest, bytes, { now });
  const bytes = Buffer.from(JSON.stringify(snapshot()));
  const manifest = { schemaVersion: 1, source: 'TheSportsDB', repository: 'antoniobialaczek-ctrl/SportLab-', branch: 'sportlab-ekstraklasa-data', generatedAt: new Date(now).toISOString(), dataCommit: 'a'.repeat(40),
    files: { 'ekstraklasa.json': { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
  assert.equal(verify(manifest, bytes).events.length, 1);
  assert.throws(() => verify(manifest, Buffer.from('{}')), /skrót|rozmiar/);
  assert.throws(() => verify({ ...manifest, branch: 'main' }, bytes), /manifest/);
  assert.throws(() => verify({ ...manifest, dataCommit: '../main' }, bytes), /manifest/);
  const unsafe = structuredClone(snapshot()); unsafe.events[0].homeId = unsafe.events[0].awayId;
  const invalid = Buffer.from(JSON.stringify(unsafe));
  assert.throws(() => verify({ ...manifest, files: { 'ekstraklasa.json': { bytes: invalid.length, sha256: createHash('sha256').update(invalid).digest('hex') } } }, invalid), /wynik/);
});
