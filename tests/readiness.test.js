import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadiness } from '../src/server/readiness.js';
import { readinessHTML } from '../public/readiness-view.js';
import handler from '../api/readiness.js';

const now = Date.parse('2026-11-18T16:00:00.000Z');
const stamp = '2026-11-18T15:00:00.000Z';
function fixture() {
  const stages = Object.fromEntries([['calibration', 60, 40], ['selection', 45, 30], ['test', 150, 100]].map(([stage, target, minimumValid]) => [stage, { target, minimumValid, recorded: 0, settled: 0, pending: 0, void: 0, frozenAt: null }]));
  stages.calibration.recorded = 12; stages.calibration.pending = 8; stages.calibration.settled = 4;
  return {
    history: { generatedAt: stamp, sports: { nba: { status: 'validated', publication: { eligible: true }, metrics: { accuracy: 0.9 } } }, runtimeData: { origin: 'github', fallback: false } },
    forward: { generatedAt: stamp, validation: { registeredAt: '2026-11-18T10:00:00.000Z', policyHash: 'a'.repeat(64),
      leagues: [{ route: 'basketball/nba', league: 'nba', phase: 'calibration', stages, finalTestMetrics: { accuracy: 0.99, probabilities: [0.99, 0.01] } }] }, runtimeData: { origin: 'github', fallback: false } },
  };
}
const build = ({ history, forward } = fixture()) => buildReadiness(history, forward, { now });
function response() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('readiness reports actual fixed-cohort counts without claiming published or live-running forecasts', () => {
  const value = build();
  assert.equal(value.status, 'collecting');
  assert.equal(value.publication.eligible, false);
  assert.equal(value.protocol.status, 'reported');
  assert.equal(value.sources.forward.ageMinutes, 60);
  const league = value.sports.nba.leagues[0];
  assert.equal(league.stages.calibration.settled, 4);
  assert.equal(league.stages.calibration.pending, 8);
  assert.equal(league.stages.calibration.target, 60);
  assert.match(league.nextStep, /Dalej automatycznie/);
  assert.match(value.note, /nie potwierdza, że harmonogram działa/);
  assert.ok(!JSON.stringify(value).includes('finalTestMetrics'));
  assert.ok(!JSON.stringify(value).includes('probabilities'));
  assert.ok(!JSON.stringify(value).includes('0.99'));
});

test('missing and incomplete protocol stay unavailable rather than resetting the experiment', () => {
  const value = buildReadiness(null, null, { now });
  assert.equal(value.status, 'unavailable');
  assert.equal(value.sources.forward.status, 'missing');
  assert.equal(value.protocol.registeredAt, null);
  assert.equal(value.sports.nba.leagues[0].stages, null);
  const data = fixture(); delete data.forward.validation.leagues[0].stages.test;
  assert.equal(build(data).protocol.status, 'invalid');
  assert.equal(build(data).sports.nba.leagues[0].stages, null);
});

test('stale, fallback and future data have explicit health and cannot appear ready', () => {
  const stale = fixture(); stale.forward.generatedAt = '2026-11-17T12:00:00.000Z'; stale.forward.validation.registeredAt = '2026-11-16T10:00:00.000Z';
  assert.equal(build(stale).sources.forward.status, 'stale');
  assert.equal(build(stale).status, 'attention');
  const fallback = fixture(); fallback.forward.runtimeData.fallback = true;
  assert.equal(build(fallback).status, 'attention');
  assert.ok(build(fallback).sports.nba.blockers.some(line => line.includes('dołączone')));
  const future = fixture(); future.forward.generatedAt = '2026-11-18T16:01:00.000Z';
  assert.equal(build(future).sources.forward.status, 'invalid');
  assert.equal(build(future).protocol.status, 'invalid');
  assert.equal(build(future).sports.nba.leagues[0].stages, null);
  assert.throws(() => buildReadiness(null, null, { now: NaN }));
});

test('inconsistent counts, changed thresholds and phase transitions fail closed', () => {
  for (const mutate of [
    row => row.stages.calibration.settled = 13,
    row => row.stages.calibration.recorded = -1,
    row => row.stages.calibration.target = 12,
    row => row.stages.calibration.minimumValid = 1,
    row => row.stages.calibration.frozenAt = '2026-11-18T15:01:00.000Z',
    row => row.phase = 'test', row => row.phase = 'ready',
    row => row.league = 'other',
  ]) {
    const data = fixture(); mutate(data.forward.validation.leagues[0]);
    assert.equal(build(data).protocol.status, 'invalid');
  }
  const duplicate = fixture(); duplicate.forward.validation.leagues.push(structuredClone(duplicate.forward.validation.leagues[0]));
  assert.equal(build(duplicate).protocol.status, 'invalid');
});

test('a fully closed test still requires review and never returns its metrics here', () => {
  const data = fixture(); const row = data.forward.validation.leagues[0]; row.phase = 'completed-awaiting-review';
  Object.values(row.stages).forEach((stage, index) => {
    stage.recorded = stage.target; stage.settled = stage.target; stage.pending = 0;
    stage.frozenAt = new Date(Date.parse('2026-11-18T11:00:00Z') + index * 3600000).toISOString();
  });
  const value = build(data);
  assert.equal(value.status, 'attention');
  assert.equal(value.publication.eligible, false);
  assert.match(value.sports.nba.leagues[0].nextStep, /Sprawdzić dowody/);
  assert.ok(!JSON.stringify(value).includes('accuracy'));
});

test('readiness view filters leagues, explains fresh data and escapes report prose', () => {
  const data = build(); data.sports.nba.leagues[0].nextStep = '<img src=x onerror=alert(1)>';
  const html = readinessHTML(data, 'nba', 'nba');
  assert.match(html, /4\/60/);
  assert.match(html, /oczekujące: 8/);
  assert.match(html, /aktualny/);
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
  assert.ok(!readinessHTML(data, 'nba', 'other').includes('4/60'));
});

test('readiness API rejects methods and invalid filters before accessing storage', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected source request'); });
  const method = response(); await handler({ method: 'POST', query: {} }, method);
  assert.equal(method.statusCode, 405);
  for (const query of [{ sport: ['nba'] }, { sport: 'invalid' }, { sport: 'all', league: 'nba' }, { sport: 'nba', league: 'eng.1' }, { sport: 'nba', league: ['nba'] }]) {
    const res = response(); await handler({ method: 'GET', query }, res);
    assert.equal(res.statusCode, 400); assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(fetch.mock.callCount(), 0);
});
