import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ekstraklasaDayURL, normalizeEkstraklasaResponse } from '../src/server/ekstraklasa-source.js';
import { validateEkstraklasaHistory, mergeEkstraklasaHistory, readPublishedEkstraklasa, loadEkstraklasaHistory } from '../src/server/ekstraklasa-history.js';
const observedAt = '2026-11-19T10:00:00.000Z', now = Date.parse(observedAt);
const fixture = { idEvent: '2490318', idLeague: '4422', strSport: 'Soccer', strHomeTeam: 'Piast Gliwice', strAwayTeam: 'Korona Kielce', idHomeTeam: '135300', idAwayTeam: '135298', strTimestamp: '2026-11-17T17:00:00', dateEvent: '2026-11-17', strTime: '17:00:00', strStatus: 'FT', strPostponed: 'no', intHomeScore: '2', intAwayScore: '1' };
const events = normalizeEkstraklasaResponse({ events: [fixture] }, { observedAt, day: '2026-11-17', sourceURL: ekstraklasaDayURL('2026-11-17') }).history;
const data = { schemaVersion: 1, kind: 'supplemental-descriptive-history', route: 'soccer/pol.1', modelExperimentEligible: false, fetchedAt: observedAt, events, coverage: { complete: false } };
const bytes = Buffer.from(JSON.stringify(data));
const manifest = { schemaVersion: 1, repository: 'antoniobialaczek-ctrl/SportLab-', branch: 'sportlab-ekstraklasa-data', source: 'TheSportsDB', generatedAt: observedAt, dataCommit: 'a'.repeat(40), files: { 'ekstraklasa.json': { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
const response = body => ({ ok: true, text: async () => body, headers: { get() { return null; } } });
test('separate Ekstraklasa history validates provider identities and actual result observation without changing model schema', () => {
  assert.equal(validateEkstraklasaHistory(data), data);
  for (const extra of [{ homeId: '135300' }, { resultAvailableAt: '2026-11-18T10:00:00.000Z' }, { source: { ...events[0].source, provider: 'ESPN' } }, { homeScore: null }]) assert.throws(() => validateEkstraklasaHistory({ ...data, events: [{ ...events[0], ...extra }] }));
  assert.throws(() => validateEkstraklasaHistory({ ...data, modelExperimentEligible: true }));
  assert.throws(() => validateEkstraklasaHistory({ ...data, events: [{ ...events[0], source: { ...events[0].source, url: ekstraklasaDayURL('2026-11-16') } }] }));
});
test('unchanged supplemental results preserve first observation; corrections get a new auditable availability time', () => {
  const next = { ...events[0], firstObservedAt: '2026-11-20T10:00:00.000Z', resultAvailableAt: '2026-11-20T10:00:00.000Z', source: { ...events[0].source, fetchedAt: '2026-11-20T10:00:00.000Z' } };
  const unchanged = mergeEkstraklasaHistory(events, [next])[0];
  assert.equal(unchanged.resultAvailableAt, observedAt);
  assert.equal(unchanged.firstObservedAt, observedAt);
  const corrected = mergeEkstraklasaHistory(events, [{ ...next, homeScore: 3 }])[0];
  assert.equal(corrected.resultAvailableAt, next.resultAvailableAt);
  assert.equal(corrected.revisions[0].previous.homeScore, 2);
  assert.throws(() => mergeEkstraklasaHistory(events, [{ ...next, homeId: 'tsdb-1' }]));
});
test('published supplemental data uses immutable commit plus hash and rejects stale or changed content', async () => {
  const seen = [];
  const fetchImpl = async url => { seen.push(url); return response(url.endsWith('manifest.json') ? JSON.stringify(manifest) : bytes.toString()); };
  const result = await readPublishedEkstraklasa({ fetchImpl, now });
  assert.equal(result.events.length, 1);
  assert.equal(result.runtimeData.dataCommit, manifest.dataCommit);
  assert.equal(seen[1], `https://raw.githubusercontent.com/antoniobialaczek-ctrl/SportLab-/${manifest.dataCommit}/ekstraklasa.json`);
  await assert.rejects(readPublishedEkstraklasa({ fetchImpl, now: now + 3 * 86400000 }));
  await assert.rejects(readPublishedEkstraklasa({ now, fetchImpl: async url => response(url.endsWith('manifest.json') ? JSON.stringify(manifest) : bytes.toString().replace('Piast', 'Other')) }));
});
test('invalid remote generation uses validated local descriptive history with explicit fallback and no source network refresh', async () => {
  const result = await loadEkstraklasaHistory({ remote: true, now, historyData: data, fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(result.events.length, 1);
  assert.equal(result.usingLocalFallback, true);
  assert.equal(result.runtimeData.origin, 'local');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.modelExperimentEligible, false);
});
