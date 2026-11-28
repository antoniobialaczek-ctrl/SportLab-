import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFootballExtraAnalysis } from '../public/football-extra-analysis.js';

const DAY = 86400000, now = Date.parse('2026-11-28T12:00:00.000Z'), observedAt = new Date(now - 60000).toISOString();
const route = 'soccer/eng.1';
const event = { sport: 'football', route, id: `${route}:999999`, homeId: '1', awayId: '2', home: 'Home FC', away: 'Away FC', state: 'pre', date: '2026-11-29T12:00:00.000Z' };
function team(id, size = 10) {
  return { id, sample: size, matches: Array.from({ length: size }, (_, index) => ({ matchId: `${route}:${Number(id) * 100000 + index}`, date: new Date(now - (index + 2) * DAY).toISOString(),
    route, scope: 'regulation_90', isHome: index % 2 === 0, opponent: `Rival ${index}`, sourceFetchedAt: observedAt,
    stats: { corners: { own: 7, opponent: 5 }, yellowCards: { own: 1, opponent: 1 }, shots: { own: 18, opponent: 13 }, shotsOnTarget: { own: 6, opponent: 4 } } })) };
}
function source(homeSize = 10, awaySize = 10) {
  return { sport: 'football', route, fixtureId: event.id, homeId: event.homeId, awayId: event.awayId, fixtureStart: event.date,
    scope: 'regulation_90', status: 'available', currentDescriptive: true, modelExperimentEligible: false, observedAt, fetchedAt: observedAt,
    teams: { home: team('1', homeSize), away: team('2', awaySize) } };
}
const build = (data = source(), options = {}) => buildFootballExtraAnalysis(data, event, { now, ...options });
const metric = (result, key) => result.metrics.find(row => row.key === key);

test('four verified football statistics use fixed independent lines with factual evidence and no borrowed prices', () => {
  const result = build(source(), { oddsData: { status: 'available', quotes: [{ market: 'winner', outcomes: [{ side: 'home', decimal: 2 }] }, { market: 'total_corners_90', line: 9.5, decimal: 1.9 }] } });
  assert.equal(result.status, 'available'); assert.equal(result.metrics.length, 4);
  assert.deepEqual(result.metrics.map(m => [m.key, m.line]), [['corners', 9.5], ['yellowCards', 3.5], ['shots', 23.5], ['shotsOnTarget', 7.5]]);
  const corners = metric(result, 'corners');
  assert.equal(corners.best.direction, 'over'); assert.equal(corners.home.averageOwn, 7); assert.equal(corners.away.averageAgainst, 5);
  assert.deepEqual(corners.best.support, { home: { hits: 10, sample: 10 }, away: { hits: 10, sample: 10 } });
  assert.equal(corners.home.last5.over, 5); assert.equal(corners.home.venue.sample, 5);
  assert.equal(metric(result, 'yellowCards').best.direction, 'under');
  for (const row of result.metrics) for (const pick of row.candidates) {
    assert.equal(pick.scope, 'regulation_90'); assert.equal(pick.quote.status, 'unavailable'); assert.equal(pick.quote.decimal, null);
    assert.equal(pick.settlementVerified, false); assert.equal(pick.comparisonOnly, true); assert.ok(pick.reasons.length >= 3); assert.ok(pick.counterevidence.length >= 3);
  }
  assert.ok(result.notes.some(note => note.includes('drugiej żółtej')));
  assert.ok(!/probability|expectedValue|modelProbability/.test(JSON.stringify(result)));
});

test('missing or malformed metric values do not become zeros or suppress other valid statistics', () => {
  const data = source();
  data.teams.home.matches.slice(0, 3).forEach(row => delete row.stats.yellowCards);
  data.teams.away.matches.slice(0, 4).forEach(row => row.stats.yellowCards = { own: null, opponent: 1 });
  data.teams.home.matches[3].stats.yellowCards = { own: 0, opponent: 0 };
  data.teams.home.matches[0].stats.shotsOnTarget.own = 99;
  const result = build(data), cards = metric(result, 'yellowCards');
  assert.equal(result.status, 'available'); assert.equal(metric(result, 'corners').home.sample, 10);
  assert.equal(cards.status, 'limited'); assert.equal(cards.best, null); assert.equal(cards.home.sample, 7); assert.equal(cards.away.sample, 6);
  assert.equal(cards.coverage.missingHome, 3); assert.equal(cards.home.recent[0].total, 0);
  assert.equal(metric(result, 'shotsOnTarget').home.sample, 9);
  const allMissing = source();
  for (const side of ['home', 'away']) allMissing.teams[side].matches.forEach(row => row.stats = {});
  const empty = build(allMissing);
  assert.equal(empty.status, 'unavailable'); assert.ok(empty.metrics.every(row => row.home.sample === 0 && row.best === null && row.candidates.length === 0));
});

test('own half-lines are exact comparisons and invalid thresholds cannot alter another metric', () => {
  const result = build(source(), { lines: { corners: 12.5, yellowCards: 3 } });
  const corners = metric(result, 'corners');
  assert.equal(corners.lineOrigin, 'manual'); assert.equal(corners.best.direction, 'under'); assert.equal(corners.best.line, 12.5);
  assert.equal(metric(result, 'yellowCards').status, 'unavailable'); assert.equal(metric(result, 'shots').status, 'available');
  for (const line of ['9.5', 0, 9, 100.5, NaN, Infinity]) assert.equal(metric(build(source(), { lines: { corners: line } }), 'corners').status, 'unavailable');
  assert.equal(build(source(), { lines: [9.5] }).status, 'unavailable');
});

test('short or stale windows and contradictory recent form retain facts without forcing a stronger direction', () => {
  const short = build(source(4, 6));
  assert.equal(short.status, 'limited'); assert.ok(short.metrics.every(row => row.best === null && row.candidates.length === 2));
  const old = source();
  for (const side of ['home', 'away']) old.teams[side].matches.forEach(row => row.date = new Date(Date.parse(row.date) - 35 * DAY).toISOString());
  const stale = build(old); assert.equal(stale.status, 'limited'); assert.ok(stale.metrics.every(row => row.best === null && row.coverage.stale));
  const mixed = source();
  mixed.teams.home.matches.forEach((row, index) => row.stats.corners = { own: index < 5 ? 4 : 8, opponent: index < 5 ? 4 : 6 });
  const corners = metric(build(mixed), 'corners');
  assert.equal(corners.line, 9.5); assert.equal(corners.best, null);
  assert.ok(corners.candidates.some(pick => pick.counterevidence.some(reason => reason.includes('Ostatnie wyniki'))));
});

test('future, duplicate, foreign, wrong-scope or conflicting shared observations cannot produce football extra directions', () => {
  for (const mutate of [d => d.fixtureId = `${route}:888888`, d => d.homeId = '2', d => d.scope = 'including_overtime',
    d => d.observedAt = d.fetchedAt = '2026-11-28T12:01:00.000Z', d => d.currentDescriptive = false,
    d => d.teams.home.matches[0].date = event.date, d => d.teams.home.matches[0].scope = 'regulation_60',
    d => d.teams.home.matches[0].route = 'soccer/usa.1', d => d.teams.home.matches[0].sourceFetchedAt = '2026-11-28T12:01:00.000Z',
    d => d.teams.home.matches[1].matchId = d.teams.home.matches[0].matchId]) {
    const data = source(); mutate(data); assert.equal(build(data).status, 'unavailable');
  }
  const same = source(), h = same.teams.home.matches[0], a = same.teams.away.matches[0];
  a.matchId = h.matchId; a.date = h.date; a.isHome = !h.isHome;
  for (const key of Object.keys(h.stats)) a.stats[key] = { own: h.stats[key].opponent, opponent: h.stats[key].own };
  assert.equal(metric(build(same), 'corners').coverage.sharedMatches, 1);
  a.stats.corners.own++;
  assert.equal(build(same).status, 'unavailable');
  assert.equal(buildFootballExtraAnalysis(source(), { ...event, state: 'post' }, { now }).status, 'closed');
});
