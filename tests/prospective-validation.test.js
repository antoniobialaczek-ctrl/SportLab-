import test from 'node:test';
import assert from 'node:assert/strict';
import { createValidationProtocol, advanceValidationProtocol, enrollValidationForecast, publicValidationProgress } from '../src/data/prospective-validation.js';
import { MODEL_VERSION, MODEL_CODE_FINGERPRINT } from '../src/models/index.js';

const registeredAt = '2026-01-01T00:00:00.000Z', route = 'basketball/nba', DAY = 86400000;
const setup = () => ({ protocol: createValidationProtocol(registeredAt), state: { forecasts: [], events: [], conflicts: [], voids: [] } });
function cohort(protocol, state, count, issued) {
  const records = [];
  for (let i = 0; i < count; i++) {
    const id = `${route}:${1000000 + state.forecasts.length}`;
    const row = { id, route, sourceEventId: id.split(':')[1], sport: 'nba', league: 'nba', homeId: '1', awayId: '2',
      issuedAt: new Date(issued).toISOString(), startTime: new Date(issued + 3600000 + Math.floor(i / 10) * DAY + i % 10 * 60000).toISOString(),
      modelVersion: MODEL_VERSION, modelCodeFingerprint: MODEL_CODE_FINGERPRINT, knownEventCount: 200,
      probabilities: [0.9, 0.1], baseline: [0.5, 0.5] };
    state.forecasts.push(row); records.push(row); enrollValidationForecast(protocol, row);
  }
  return records;
}
function resolve(state, records, count = records.length) {
  for (const [i, f] of records.slice(0, count).entries()) state.events.push({ id: f.id, sport: 'nba', homeId: f.homeId, awayId: f.awayId,
    homeScore: i % 4 ? 100 : 90, awayScore: i % 4 ? 90 : 100, startTime: f.startTime,
    resultAvailableAt: new Date(Date.parse(f.startTime) + 7200000).toISOString() });
  return new Date(Math.max(...state.events.map(e => Date.parse(e.resultAvailableAt))) + 1000).toISOString();
}
function finishPhase(protocol, state, stage) {
  const league = protocol.leagues[route], issued = Date.parse(league.openedAt) + 1000;
  const rows = cohort(protocol, state, protocol.policy.slots[stage], issued);
  const now = resolve(state, rows); advanceValidationProtocol(protocol, state, now);
  return { rows, now };
}

test('preregistered cohorts and code cannot be changed after results become available', () => {
  const { protocol } = setup();
  assert.deepEqual(protocol.policy.slots, { calibration: 60, selection: 45, test: 150 });
  const changed = structuredClone(protocol); changed.policy.slots.test = 10;
  assert.throws(() => advanceValidationProtocol(changed, { forecasts: [], events: [], conflicts: [] }, registeredAt), /Zmiana zamrożonego/);
});
test('pre-protocol or legacy research records never enter the independent experiment', () => {
  const { protocol, state } = setup();
  const rows = cohort(protocol, state, 1, Date.parse(registeredAt) - 1000);
  assert.equal(protocol.leagues[route].slots.calibration.length, 0);
  rows[0].issuedAt = '2026-01-02T00:00:00.000Z'; delete rows[0].modelCodeFingerprint;
  assert.equal(enrollValidationForecast(protocol, rows[0]), false);
});
test('minimum valid sample cannot close a still-pending predetermined cohort', () => {
  const { protocol, state } = setup(), rows = cohort(protocol, state, 61, Date.parse(registeredAt) + 1000);
  assert.equal(protocol.leagues[route].slots.calibration.length, 60);
  const now = resolve(state, rows, 40); advanceValidationProtocol(protocol, state, now);
  assert.equal(protocol.leagues[route].phase, 'calibration');
  assert.equal(protocol.leagues[route].freezes.calibration, undefined);
});
test('calibration and selection are frozen strictly before later-stage forecasts', () => {
  const { protocol, state } = setup();
  finishPhase(protocol, state, 'calibration');
  assert.equal(protocol.leagues[route].phase, 'selection');
  const frozen = structuredClone(protocol.leagues[route].freezes.calibration);
  finishPhase(protocol, state, 'selection');
  assert.equal(protocol.leagues[route].phase, 'test');
  assert.deepEqual(protocol.leagues[route].freezes.calibration, frozen);
  assert.ok(protocol.leagues[route].freezes.selection.temperature > 1);
});
test('final metrics stay hidden until the whole fixed test cohort resolves', () => {
  const { protocol, state } = setup();
  finishPhase(protocol, state, 'calibration'); finishPhase(protocol, state, 'selection');
  const rows = cohort(protocol, state, 150, Date.parse(protocol.leagues[route].openedAt) + 1000);
  const now = resolve(state, rows, 100); advanceValidationProtocol(protocol, state, now);
  const report = publicValidationProgress(protocol, state, now).leagues.find(l => l.route === route);
  assert.equal(report.stages.test.settled, 100);
  assert.equal(report.stages.test.pending, 50);
  assert.equal(report.finalTestMetrics, null);
  assert.equal(protocol.leagues[route].phase, 'test');
});
test('completed test reports independent scores and block uncertainty without unlocking forecasts', () => {
  const { protocol, state } = setup();
  finishPhase(protocol, state, 'calibration'); finishPhase(protocol, state, 'selection');
  const { now } = finishPhase(protocol, state, 'test');
  const report = publicValidationProgress(protocol, state, now), league = report.leagues.find(l => l.route === route);
  assert.equal(league.finalTestMetrics.count, 150);
  assert.ok(league.brierImprovementInterval.lower > 0);
  assert.ok(league.brierImprovementInterval.blocks >= 7);
  assert.equal(report.publication.eligible, false);
  assert.equal(league.phase, 'completed-awaiting-review');
});
test('later corrections invalidate a frozen stage instead of silently refitting it', () => {
  const { protocol, state } = setup(), { rows, now } = finishPhase(protocol, state, 'calibration');
  const frozen = structuredClone(protocol.leagues[route].freezes.calibration);
  state.conflicts.push({ id: rows[0].id, observedAt: new Date(Date.parse(now) + 1000).toISOString() });
  advanceValidationProtocol(protocol, state, new Date(Date.parse(now) + 2000).toISOString());
  assert.equal(protocol.leagues[route].phase, 'invalidated');
  assert.deepEqual(protocol.leagues[route].freezes.calibration, frozen);
});
test('fixed-window data failures cannot be replaced until the performance looks favorable', () => {
  const { protocol, state } = setup(), rows = cohort(protocol, state, 60, Date.parse(registeredAt) + 1000);
  const now = resolve(state, rows);
  state.voids = rows.slice(0, 4).map(row => ({ id: row.id, observedAt: now, reason: 'terminal-source-status' }));
  advanceValidationProtocol(protocol, state, now);
  assert.equal(protocol.leagues[route].phase, 'blocked-data');
  const extra = cohort(protocol, state, 1, Date.parse(now) + 1000);
  assert.equal(enrollValidationForecast(protocol, extra[0]), false);
  assert.equal(protocol.leagues[route].slots.calibration.length, 60);
});

test('stored temperature and final metrics are replayed instead of trusting edited freeze flags', () => {
  const { protocol, state } = setup();
  finishPhase(protocol, state, 'calibration'); const { now } = finishPhase(protocol, state, 'selection');
  const changed = structuredClone(protocol); changed.leagues[route].freezes.selection.temperature = 5;
  assert.throws(() => advanceValidationProtocol(changed, state, now), /Odtworzenie/);
  const finished = finishPhase(protocol, state, 'test');
  protocol.leagues[route].freezes.test.metrics.accuracy = 1;
  assert.throws(() => publicValidationProgress(protocol, state, finished.now), /Odtworzenie/);
});

test('a completed future protocol cannot be presented as an earlier historical report', () => {
  const { protocol, state } = setup();
  finishPhase(protocol, state, 'calibration'); const { now } = finishPhase(protocol, state, 'selection');
  finishPhase(protocol, state, 'test');
  assert.throws(() => publicValidationProgress(protocol, state, now), /przyszłego stanu/);
});

test('a correction after test closure hides invalidated public scores while preserving the private freeze', () => {
  const { protocol, state } = setup();
  finishPhase(protocol, state, 'calibration'); finishPhase(protocol, state, 'selection');
  const { rows, now } = finishPhase(protocol, state, 'test');
  state.conflicts.push({ id: rows[0].id, observedAt: new Date(Date.parse(now) + 1000).toISOString() });
  const later = new Date(Date.parse(now) + 2000).toISOString();
  advanceValidationProtocol(protocol, state, later);
  const publicLeague = publicValidationProgress(protocol, state, later).leagues.find(l => l.route === route);
  assert.equal(publicLeague.phase, 'invalidated');
  assert.equal(publicLeague.finalTestMetrics, null);
  assert.equal(protocol.leagues[route].freezes.test.metrics.count, 150);
});
