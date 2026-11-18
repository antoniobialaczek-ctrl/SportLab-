import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditForecastEvidence } from '../src/data/evidence-audit.js';
import { MODEL_CODE_FINGERPRINT, MODEL_VERSION, recordResearchForecast } from '../src/models/index.js';
import { normalizeScoreboard } from '../src/data/espn.js';

const issue = '2026-01-05T10:05:00.000Z';
const observedAt = '2026-01-05T10:00:00.000Z';
const route = 'basketball/nba';
function historical(overrides = {}) {
  return { id: `${route}:test-prior`, sourceEventId: 'test-prior', sport: 'nba', route, league: 'nba', season: '2026',
    startTime: '2026-01-01T12:00:00.000Z', resultAvailableAt: '2026-01-02T12:00:00.000Z', availabilityBasis: 'conservative-24h',
    homeId: '1', awayId: '2', home: 'Test Home', away: 'Test Away', homeScore: 110, awayScore: 90, neutralSite: false, status: 'completed',
    source: { provider: 'ESPN', url: `https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=20260101`, fetchedAt: '2026-01-04T12:00:00.000Z' }, ...overrides };
}
function rawFixture() {
  return { events: [{ id: '123456', competitions: [{ id: '123456', date: '2026-01-06T12:00:00Z', neutralSite: false,
    status: { type: { state: 'pre', completed: false } },
    competitors: [{ id: '1', homeAway: 'home', team: { displayName: 'Test Home' } }, { id: '2', homeAway: 'away', team: { displayName: 'Test Away' } }] }] }] };
}
const fixture = { id: `${route}:123456`, sourceEventId: '123456', sport: 'nba', route, league: 'nba', startTime: '2026-01-06T12:00:00.000Z', homeId: '1', awayId: '2', home: 'Test Home', away: 'Test Away', neutralSite: false };
async function prepare(t) {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const kind of ['raw', 'training']) await mkdir(join(root, 'snapshots', kind), { recursive: true });
  async function archive(kind, value) {
    const bytes = JSON.stringify(value), sha = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(root, 'snapshots', kind, `${sha}.json`), bytes); return sha;
  }
  const replay = recordResearchForecast(fixture, [historical()], { now: issue });
  const raw = rawFixture();
  const fixtureSnapshotSha256 = await archive('raw', raw);
  const training = { schemaVersion: 1, sport: 'nba', route, modelVersion: MODEL_VERSION, modelCodeFingerprint: MODEL_CODE_FINGERPRINT, events: replay.trainingEvents };
  const trainingSnapshotSha256 = await archive('training', training);
  const row = { ...fixture, ...replay.record, fixtureObservedAt: observedAt, fixtureSnapshotSha256, trainingSnapshotSha256 };
  const state = { forecasts: [row], snapshots: [{ sha256: fixtureSnapshotSha256, sport: 'nba', route, day: '2026-01-06', observedAt, url: `https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=20260106` }] };
  return { root, state, row, raw, training, archive };
}

test('semantic evidence audit replays the exact frozen model and inputs', async t => {
  const { root, state, row } = await prepare(t);
  assert.deepEqual(await auditForecastEvidence(root, state), { verifiedIds: [row.id], legacyIds: [] });
  assert.match(row.modelCodeFingerprint, /^[a-f0-9]{64}$/);
});

test('a valid probability vector edited without changing evidence is rejected', async t => {
  const { root, state, row } = await prepare(t);
  row.probabilities = [0.1, 0.9];
  await assert.rejects(auditForecastEvidence(root, state), /wektora probabilities/);
});

test('swapping to a valid different training archive cannot preserve a forecast', async t => {
  const { root, state, row, training, archive } = await prepare(t);
  training.events[0] = historical({ homeScore: 80, awayScore: 120 });
  row.trainingSnapshotSha256 = await archive('training', training);
  await assert.rejects(auditForecastEvidence(root, state), /dataFingerprint/);
});

test('raw fixture hash alone cannot authenticate a post-match response', async t => {
  const { root, state, row, raw, archive } = await prepare(t);
  raw.events[0].competitions[0].status.type = { state: 'post', completed: true };
  row.fixtureSnapshotSha256 = await archive('raw', raw);
  state.snapshots[0].sha256 = row.fixtureSnapshotSha256;
  await assert.rejects(auditForecastEvidence(root, state), /stanu przed rozpoczęciem/);
});

test('a mismatched participant or source observation time invalidates evidence', async t => {
  const { root, state, row } = await prepare(t);
  row.homeId = '999';
  await assert.rejects(auditForecastEvidence(root, state), /homeId/);
  row.homeId = '1'; row.fixtureObservedAt = '2026-01-05T10:06:00.000Z';
  await assert.rejects(auditForecastEvidence(root, state), /chronologia/);
});

test('future training rows are rejected even if a model would filter them out', async t => {
  const { root, state, row, training, archive } = await prepare(t);
  training.events.push(historical({ id: `${route}:test-future`, sourceEventId: 'test-future', source: { ...historical().source, fetchedAt: '2026-01-07T12:00:00.000Z' } }));
  row.trainingSnapshotSha256 = await archive('training', training);
  await assert.rejects(auditForecastEvidence(root, state), /niedostępne w chwili/);
});

test('code changes require a separate version review instead of silent replay', async t => {
  const { root, state, row } = await prepare(t);
  row.modelCodeFingerprint = '0'.repeat(64);
  await assert.rejects(auditForecastEvidence(root, state), /Kod modelu zmienił/);
});

test('legacy registrations without source fingerprint remain research only', async t => {
  const { root, state, row } = await prepare(t);
  delete row.modelCodeFingerprint;
  row.probabilities = [0.1, 0.9];
  assert.deepEqual(await auditForecastEvidence(root, state), { verifiedIds: [], legacyIds: [row.id] });
});

test('recomputed vectors cannot conceal an observed training score changed against raw evidence', async t => {
  const { root, state, row, training, archive } = await prepare(t);
  const resultRaw = rawFixture();
  const c = resultRaw.events[0].competitions[0];
  c.id = 'test-prior'; c.date = historical().startTime;
  c.status.type = { state: 'post', completed: true, name: 'STATUS_FINAL' };
  c.competitors[0].score = '110'; c.competitors[1].score = '90';
  const snapshotSha256 = await archive('raw', resultRaw);
  const known = historical({ availabilityBasis: 'historical-snapshot', resultAvailableAt: '2026-01-04T12:00:00.000Z', source: { ...historical().source, observedAt: '2026-01-04T12:00:00.000Z', snapshotSha256 } });
  training.events = [known];
  Object.assign(row, recordResearchForecast(fixture, training.events, { now: issue }).record);
  row.trainingSnapshotSha256 = await archive('training', training);
  assert.deepEqual((await auditForecastEvidence(root, state)).verifiedIds, [row.id]);
  known.homeScore = 120;
  Object.assign(row, recordResearchForecast(fixture, training.events, { now: issue }).record);
  row.trainingSnapshotSha256 = await archive('training', training);
  await assert.rejects(auditForecastEvidence(root, state), /obserwowanego wyniku treningowego/);
});

async function observedResult(prepared, time = '2026-01-07T12:00:00.000Z') {
  const raw = rawFixture(), c = raw.events[0].competitions[0];
  c.status.type = { state: 'post', completed: true, name: 'STATUS_FINAL' };
  c.competitors[0].score = '110'; c.competitors[1].score = '90';
  const sha = await prepared.archive('raw', raw), url = `https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=20260106`;
  prepared.state.snapshots.push({ sha256: sha, observedAt: time, sport: 'nba', route, day: '2026-01-06', url });
  const event = normalizeScoreboard(raw, { sport: 'nba', route, day: '2026-01-06', fetchedAt: time, url }).events[0];
  event.availabilityBasis = 'historical-snapshot'; event.resultAvailableAt = time;
  event.source = { ...event.source, observedAt: time, snapshotSha256: sha };
  prepared.state.events = [event];
  return event;
}

test('a last-test outcome never used for training is still verified against raw evidence', async t => {
  const prepared = await prepare(t), event = await observedResult(prepared);
  await auditForecastEvidence(prepared.root, prepared.state);
  event.homeScore = 70;
  await assert.rejects(auditForecastEvidence(prepared.root, prepared.state), /wyniku rozliczenia/);
});

test('a valid raw hash cannot justify a fabricated cancellation', async t => {
  const { root, state, row } = await prepare(t);
  state.snapshots.push({ ...state.snapshots[0], observedAt: '2026-01-07T12:00:00.000Z' });
  state.voids = [{ id: row.id, observedAt: '2026-01-07T12:00:00.000Z', snapshotSha256: row.fixtureSnapshotSha256, reason: 'terminal-source-status' }];
  await assert.rejects(auditForecastEvidence(root, state), /odwołania/);
});

test('a result observed after the fixed missing-result timeout cannot rewrite that exclusion', async t => {
  const prepared = await prepare(t), time = '2026-01-21T12:00:00.000Z';
  prepared.state.voids = [{ id: prepared.row.id, observedAt: time, snapshotSha256: null, reason: 'result-not-observed-in-14-days' }];
  await observedResult(prepared, '2026-01-22T12:00:00.000Z');
  assert.equal((await auditForecastEvidence(prepared.root, prepared.state)).verifiedIds.length, 1);
});
