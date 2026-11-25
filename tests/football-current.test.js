import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentPlayerMatchesLoader } from '../src/server/recent-player-matches.js';
import { buildMatchAnalysis, buildCurrentFootballAnalysis } from '../src/server/match-analysis.js';
import handler from '../api/match-analysis.js';

const now = Date.parse('2026-11-25T12:00:00.000Z'), at = new Date(now).toISOString(), route = 'soccer/uefa.champions';
const query = { sport: 'football', route, homeId: '1', awayId: '2', fixtureId: `${route}:999999`, fixtureStart: '2026-11-25T22:00:00.000Z', cutoff: at };
function sourceEvent(id = '100001', changes = {}) {
  const date = '2026-11-20T20:00Z';
  return { id, date, league: { slug: 'uefa.champions' }, season: { year: 2026 }, competitions: [{ id, date,
    status: { period: 2, clock: 5400, type: { state: 'post', completed: true, name: 'STATUS_FULL_TIME' } },
    competitors: [{ id: '1', homeAway: 'home', team: { id: '1', displayName: 'Home' }, score: { value: 2, displayValue: '2' } },
      { id: '3', homeAway: 'away', team: { id: '3', displayName: 'Rival' }, score: { value: 1, displayValue: '1' } }] }], ...changes };
}
const body = events => ({ team: { id: '1' }, season: { year: 2026 }, events });
const loader = fetchImpl => createRecentPlayerMatchesLoader({ fetchImpl, clock: () => now, enabled: true });

test('football schedules mark only completed regulation results, excluding extra time, penalties, short and foreign matches', async () => {
  const bad = [sourceEvent('100002'), sourceEvent('100003'), sourceEvent('100004'), sourceEvent('100005'), sourceEvent('100006'), sourceEvent('100007')];
  bad[0].competitions[0].status.period = 4;
  bad[1].competitions[0].competitors[0].shootoutScore = 4;
  bad[2].competitions[0].status.clock = 3600;
  bad[3].competitions[0].status.clock = 7200;
  bad[4].league.slug = 'esp.1';
  bad[5].date = bad[5].competitions[0].date = '2026-11-26T20:00Z';
  const result = await loader(async () => body([sourceEvent(), ...bad]))([], { ...query, teamId: '1' });
  assert.equal(result.events.length, 1); assert.equal(result.coverage.excludedMatches, 6);
  assert.equal(result.events[0].scoreScope, 'regulation_90'); assert.equal(result.events[0].regulationOnly, true);
  assert.equal(result.events[0].resultAvailableAt, at);
});

test('requested prior season is established by event years rather than misleading current top-level metadata', async () => {
  let calls = 0;
  const load = loader(async url => { calls++; const season = new URL(url).searchParams.get('season'); return body([sourceEvent(season ? '100002' : '100001', { season: { year: season ? Number(season) : 2026 } })]); });
  const current = await load([], { ...query, teamId: '1' });
  const prior = await load([], { ...query, teamId: '1', season: 2025 });
  assert.equal(current.coverage.season, 2026); assert.equal(prior.coverage.season, 2025);
  assert.equal(prior.events[0].season, 2025); assert.match(prior.events[0].source.url, /season=2025$/);
  await load([], { ...query, teamId: '1', season: 2025 }); assert.equal(calls, 2);
  const wrong = await loader(async () => body([sourceEvent()]))([], { ...query, teamId: '1', season: 2025 });
  assert.equal(wrong.coverage.status, 'fallback'); assert.deepEqual(wrong.events, []);
});

function record(teamId, index = 0, season = 2026, changes = {}) {
  const otherId = teamId === '1' ? '3' : '4', sourceEventId = String(Number(teamId) * 100000 + (2026 - season) * 10000 + index);
  return { id: `${route}:${sourceEventId}`, sourceEventId, sport: 'football', route, season, status: 'completed',
    startTime: season === 2026 ? new Date(now - (index + 1) * 86400000).toISOString() : `2025-11-${String(index + 1).padStart(2, '0')}T20:00:00.000Z`,
    homeId: teamId, awayId: otherId, home: teamId === '1' ? 'Home' : 'Away', away: 'Rival', homeScore: 2, awayScore: 1,
    resultAvailableAt: at, availabilityBasis: 'current-descriptive-observation', descriptiveOnly: true, regulationOnly: true, scoreScope: 'regulation_90',
    source: { provider: 'ESPN', url: `https://site.api.espn.com/apis/site/v2/sports/${route}/teams/${teamId}/schedule${season === 2026 ? '' : `?season=${season}`}`, fetchedAt: at }, ...changes };
}
function loaded(teamId, season = 2026, count = season === 2026 ? 4 : 6) {
  return { events: Array.from({ length: count }, (_, i) => record(teamId, i, season)), coverage: { status: 'refreshed', fetchedAt: at, season, complete: false } };
}

test('same-millisecond current observations are inclusive only for explicitly marked descriptive records', () => {
  const rows = [record('1'), record('2')];
  assert.equal(buildMatchAnalysis(rows, query).home.sample, 0);
  const current = buildMatchAnalysis(rows, { ...query, availabilityInclusive: true });
  assert.equal(current.home.sample, 1); assert.equal(current.away.sample, 1);
  assert.equal(current.home.recent[0].scoreScope, 'regulation_90');
  const unmarked = rows.map(row => ({ ...row, descriptiveOnly: false }));
  assert.equal(buildMatchAnalysis(unmarked, { ...query, availabilityInclusive: true }).home.sample, 0);
  const future = rows.map(row => ({ ...row, resultAvailableAt: '2026-11-25T12:00:00.001Z' }));
  assert.equal(buildMatchAnalysis(future, { ...query, availabilityInclusive: true }).home.sample, 0);
  assert.ok(rows.every(row => row.resultAvailableAt === at));
  assert.equal(current.context.home.opposition.matchedGames, 0);
});

test('current football analysis fills a small current-season window with at most one verified prior-season read per team', async () => {
  const calls = [];
  const result = await buildCurrentFootballAnalysis(query, { clock: () => now, load: async (events, q) => { assert.deepEqual(events, []); calls.push(q); return loaded(q.teamId, q.season || 2026); } });
  assert.equal(result.resultScope, 'regulation_90'); assert.equal(result.currentDescriptive, true); assert.equal(result.modelExperimentEligible, false);
  assert.equal(result.home.sample, 10); assert.equal(result.away.sample, 10);
  assert.equal(calls.length, 4); assert.equal(calls.filter(q => q.season === 2025).length, 2);
  assert.equal(result.coverage.complete, false); assert.equal(result.coverage.previousSeasonRequested, true);
  assert.ok(result.home.recent.every(row => row.regulationOnly && row.scoreScope === 'regulation_90'));
  assert.equal(result.observedAt, at); assert.ok(result.notes[0].includes('nie odtwarzamy'));
  const enough = [];
  await buildCurrentFootballAnalysis(query, { clock: () => now, load: async (_, q) => { enough.push(q); return loaded(q.teamId, 2026, 10); } });
  assert.equal(enough.length, 2);
});

test('unavailable, unmarked or conflicting observations never fall back to an unverified goal scope', async () => {
  const unavailable = await buildCurrentFootballAnalysis(query, { clock: () => now, load: async () => ({ events: [], coverage: { status: 'fallback' } }) });
  assert.equal(unavailable.resultScope, 'unavailable'); assert.equal(unavailable.status, 'unavailable');
  const unmarked = await buildCurrentFootballAnalysis(query, { clock: () => now, load: async (_, q) => { const d = loaded(q.teamId, 2026, 10); d.events[0].regulationOnly = false; return d; } });
  assert.equal(unmarked.resultScope, 'unavailable');
  const conflict = await buildCurrentFootballAnalysis(query, { clock: () => now, load: async (_, q) => {
    const d = loaded(q.teamId, 2026, 10), shared = record('1', 99, 2026, { homeId: '1', awayId: '2', homeScore: q.teamId === '1' ? 2 : 3 });
    shared.source.url = `https://site.api.espn.com/apis/site/v2/sports/${route}/teams/${q.teamId}/schedule`; d.events.push(shared); return d;
  } });
  assert.equal(conflict.resultScope, 'unavailable'); assert.equal(conflict.home.sample, 0);
});

test('partial prior-season reads keep actual current observations and a fixture starting during the read becomes unavailable', async () => {
  const partial = await buildCurrentFootballAnalysis(query, { clock: () => now, load: async (_, q) => q.season
    ? { events: [], coverage: { status: 'fallback', fetchedAt: '2099-01-01T00:00:00.000Z' } } : loaded(q.teamId) });
  assert.equal(partial.coverage.status, 'partial'); assert.equal(partial.home.sample, 4); assert.equal(partial.away.sample, 4);
  assert.equal(partial.observedAt, at); assert.equal(partial.home.recent[0].date, record('1').startTime);
  let ticks = 0;
  const began = await buildCurrentFootballAnalysis({ ...query, fixtureStart: new Date(now + 1).toISOString() }, {
    clock: () => now + (ticks++ ? 2 : 0), load: async (_, q) => loaded(q.teamId, 2026, 10) });
  assert.equal(began.resultScope, 'unavailable'); assert.equal(began.home.sample, 0);
});

function response() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } }; }
test('current API requires a future football fixture and keeps historical/default validation intact', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected live network'); });
  const future = new Date(Date.now() + 86400000).toISOString(), past = new Date(Date.now() - 86400000).toISOString();
  const base = { ...query, cutoff: new Date(Date.now() - 1000).toISOString(), view: 'current', fixtureStart: future };
  for (const change of [{ fixtureStart: past }, { fixtureStart: '' }, { fixtureId: '' }, { sport: 'nba', route: 'basketball/nba', fixtureId: 'basketball/nba:999999' }, { view: 'unknown' }, { cutoff: future }]) {
    const res = response(); await handler({ method: 'GET', query: { ...base, ...change } }, res); assert.equal(res.statusCode, 400);
  }
  const res = response(); await handler({ method: 'GET', query: base }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.resultScope, 'unavailable'); assert.equal(res.headers['cache-control'], 'no-store');
});

test('known league history scope is exposed for Ekstraklasa and verified supplemental MLS only', async () => {
  for (const league of ['soccer/pol.1', 'soccer/usa.1']) {
    const res = response();
    await handler({ method: 'GET', query: { sport: 'football', route: league,
      homeId: league.endsWith('pol.1') ? 'tsdb-1' : '1', awayId: league.endsWith('pol.1') ? 'tsdb-2' : '2' } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.resultScope, 'regulation_90'); assert.equal(res.body.modelExperimentEligible, false);
  }
});
