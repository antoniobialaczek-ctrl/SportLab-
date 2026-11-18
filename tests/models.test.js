import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSport, predictFixture, walkForwardRows } from '../src/models/index.js';

// Synthetic records below are unit-test fixtures, never application history.
const DAY = 86_400_000;
const START = Date.parse('2024-01-01T12:00:00.000Z');
const routes = { nba: 'basketball/nba', nhl: 'hockey/nhl', football: 'soccer/eng.1', tennis: 'tennis/atp' };
function event(index, sport = 'nba', overrides = {}) {
  const route = overrides.route ?? routes[sport];
  const startTime = new Date(START + index * 2 * DAY).toISOString();
  const score = sport === 'nba' ? [110, 100] : sport === 'nhl' ? [4, 2] : sport === 'tennis' ? [2, 0] : [2, 1];
  const reversed = index % 3 === 0;
  return {
    id: `${route}:synthetic-${index}`, sourceEventId: `synthetic-${index}`, sport, league: route.split('/').at(-1), route, season: 2024,
    startTime, resultAvailableAt: new Date(Date.parse(startTime) + DAY).toISOString(), availabilityBasis: 'conservative-24h',
    homeId: 'test-A', awayId: 'test-B', home: 'Synthetic A', away: 'Synthetic B', homeScore: reversed ? score[1] : score[0], awayScore: reversed ? score[0] : score[1],
    neutralSite: sport === 'tennis', status: 'completed',
    source: { provider: 'ESPN', url: `https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=20240101`, fetchedAt: '2026-11-18T00:00:00.000Z' },
    ...overrides,
  };
}
const history = (count, sport = 'nba') => Array.from({ length: count }, (_, index) => event(index, sport));

test('all supported research models produce normalized outcomes, football includes draws', () => {
  for (const sport of Object.keys(routes)) {
    const rows = walkForwardRows(sport, history(12, sport));
    assert.equal(rows.length, 12);
    for (const row of rows) {
      assert.equal(row.probabilities.length, sport === 'football' ? 3 : 2);
      assert.ok(Math.abs(row.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-12);
      assert.ok(row.probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1));
    }
    if (sport === 'football') assert.ok(rows[0].probabilities[1] > 0);
  }
});

test('future outcome changes and appended fixtures cannot change earlier predictions', () => {
  const original = history(30);
  const mutated = [...original.slice(0, 20), ...original.slice(20).map(e => ({ ...e, homeScore: e.awayScore, awayScore: e.homeScore })), ...history(35).slice(30)];
  assert.deepEqual(walkForwardRows('nba', original).slice(0, 20), walkForwardRows('nba', mutated).slice(0, 20));
});

test('overlapping and simultaneous games cannot consume results not yet available', () => {
  const first = event(0, 'nba', { resultAvailableAt: '2024-01-06T12:00:00.000Z', availabilityBasis: 'verified-timestamp' });
  const next = event(1);
  const tied = event(2, 'nba', { startTime: next.startTime, resultAvailableAt: next.resultAvailableAt });
  const actual = walkForwardRows('nba', [tied, next, first]);
  const prior = walkForwardRows('nba', [next])[0].probabilities;
  assert.deepEqual(actual[1].probabilities, prior);
  assert.deepEqual(actual[2].probabilities, prior);
  const strictlyAtAvailability = event(3, 'nba', { startTime: first.resultAvailableAt, resultAvailableAt: '2024-01-07T12:00:00.000Z' });
  assert.deepEqual(walkForwardRows('nba', [first, strictlyAtAvailability])[1].probabilities, prior);
});

test('route isolation prevents cross-league or ATP/WTA training', () => {
  for (const [sport, alternate] of [['football', 'soccer/esp.1'], ['tennis', 'tennis/wta']]) {
    const earlier = event(0, sport);
    const isolated = event(3, sport, { route: alternate, league: alternate.split('/').at(-1), id: `${alternate}:synthetic-3`, source: { ...earlier.source, url: `https://site.api.espn.com/apis/site/v2/sports/${alternate}/scoreboard` } });
    assert.deepEqual(walkForwardRows(sport, [earlier, isolated]).at(-1).probabilities, walkForwardRows(sport, [isolated])[0].probabilities);
  }
});

test('final holdout outcomes never select calibration temperature', () => {
  const original = history(500);
  const now = '2026-11-18T00:00:00.000Z';
  const before = evaluateSport('nba', original, { now });
  const testAt = Date.parse(before.leagues[0].boundaries.testAt);
  const changed = original.map(e => Date.parse(e.startTime) >= testAt ? { ...e, homeScore: e.awayScore, awayScore: e.homeScore } : e);
  const after = evaluateSport('nba', changed, { now });
  assert.deepEqual(before.leagues[0].calibration, after.leagues[0].calibration);
  assert.equal(before.samples.test, 100);
  assert.equal(before.metrics.count, 100);
  assert.notDeepEqual(before.metrics, after.metrics);
});

test('calibration and selection exclude outcomes unavailable at their next boundary', () => {
  const events = history(500);
  const ordinary = evaluateSport('nba', events, { now: '2026-11-18T00:00:00Z' });
  events[349] = { ...events[349], availabilityBasis: 'verified-timestamp', resultAvailableAt: events[360].startTime };
  events[399] = { ...events[399], availabilityBasis: 'verified-timestamp', resultAvailableAt: events[410].startTime };
  const delayed = evaluateSport('nba', events, { now: '2026-11-18T00:00:00Z' });
  assert.equal(delayed.samples.calibration, ordinary.samples.calibration - 1);
  assert.equal(delayed.samples.selection, ordinary.samples.selection - 1);
  assert.equal(delayed.samples.test, ordinary.samples.test);
});

test('same timestamp is never split between calibration selection and test', () => {
  const events = history(100);
  const duplicateTime = event(100, 'nba', { startTime: events[80].startTime, resultAvailableAt: events[80].resultAvailableAt });
  const report = evaluateSport('nba', [...events, duplicateTime], { now: '2026-11-18T00:00:00Z' });
  assert.equal(report.samples.test, 21);
});

test('historical metrics have explicit sample baseline reliability and uncertainty', () => {
  const report = evaluateSport('football', history(200, 'football'), { now: '2026-11-18T00:00:00Z' });
  assert.equal(report.status, 'research');
  assert.equal(report.metrics.count, report.samples.test);
  assert.equal(report.metrics.reliabilityBins.reduce((sum, bin) => sum + bin.count, 0), report.samples.test);
  assert.ok(report.metrics.accuracyInterval.lower <= report.metrics.accuracy);
  assert.ok(report.metrics.accuracyInterval.upper >= report.metrics.accuracy);
  assert.equal(report.baselineMetrics.count, report.metrics.count);
  assert.equal(report.provenance.pointInTimeVerified, false);
  assert.equal(report.publication.eligible, false);
});

test('retrospective ESPN histories never unlock a public probability', () => {
  const events = history(500);
  const report = evaluateSport('nba', events, { now: '2026-11-18T00:00:00Z' });
  const fixture = { sport: 'nba', route: routes.nba, homeId: 'test-A', awayId: 'test-B', neutralSite: false, startTime: '2026-11-19T00:00:00Z' };
  assert.equal(predictFixture(fixture, events, report, { now: '2026-11-18T00:00:00Z' }).probabilities, null);
  assert.equal(predictFixture(fixture, events, { ...report, status: 'validated', publication: { eligible: true } }, { now: '2026-11-18T00:00:00Z' }).probabilities, null);
  const forged = structuredClone(report);
  forged.status = 'validated';
  forged.publication.eligible = true;
  forged.provenance.pointInTimeVerified = true;
  forged.leagues.forEach(league => { league.publication.eligible = true; league.provenance.pointInTimeVerified = true; });
  assert.equal(predictFixture(fixture, events, forged, { now: '2026-11-18T00:00:00Z' }).probabilities, null);
});

test('invalid duplicate mixed-sport and future histories do not fabricate metrics', () => {
  const corrupt = event(0, 'nba', { homeScore: NaN });
  for (const records of [[corrupt], [event(0), event(0)], [event(0), event(1, 'nhl')]]) {
    const report = evaluateSport('nba', records);
    assert.equal(report.status, 'unavailable');
    assert.equal(report.metrics, null);
    assert.equal(report.publication.eligible, false);
  }
  const future = evaluateSport('nba', history(10), { now: '2023-01-01T00:00:00Z' });
  assert.equal(future.samples.total, 0);
  assert.equal(future.metrics, null);
});

test('CS2 and empty histories remain explicitly unavailable', () => {
  for (const sport of ['cs2', 'nba', 'nhl', 'tennis', 'football']) {
    const report = evaluateSport(sport, []);
    assert.equal(report.status, 'unavailable');
    assert.equal(report.metrics, null);
    assert.equal(report.publication.eligible, false);
  }
});
