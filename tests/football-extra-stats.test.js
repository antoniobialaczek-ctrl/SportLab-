import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootballExtraStatsService, extractFootballExtraStats } from '../src/server/football-extra-stats.js';
import { createSummaryLoader } from '../src/server/player-form.js';
import handler from '../api/football-extra-stats.js';

const now = Date.parse('2026-11-28T12:00:00.000Z'), at = new Date(now).toISOString(), route = 'soccer/eng.1';
const query = { sport: 'football', route, fixtureId: `${route}:999999`, homeId: '1', awayId: '2', fixtureStart: '2026-11-28T22:00:00.000Z' };
function match(teamId = '1', index = 0, changes = {}) {
  const sourceEventId = String(Number(teamId) * 100000 + index), home = index % 2 === 0;
  const homeId = home ? teamId : '8', awayId = home ? '8' : teamId;
  return { id: `${route}:${sourceEventId}`, sourceEventId, sport: 'football', route, status: 'completed', homeId, awayId,
    home: `Team ${homeId}`, away: `Team ${awayId}`, startTime: new Date(now - (index + 1) * 86400000).toISOString(), homeScore: home ? 2 : 1, awayScore: home ? 1 : 2,
    regulationOnly: true, scoreScope: 'regulation_90', descriptiveOnly: true, availabilityBasis: 'current-descriptive-observation', resultAvailableAt: at,
    source: { provider: 'ESPN', url: `https://site.api.espn.com/apis/site/v2/sports/${route}/teams/${teamId}/schedule`, fetchedAt: at }, ...changes };
}
const stats = (corners = '4', yellows = '0') => [{ name: 'wonCorners', displayValue: corners }, { name: 'yellowCards', displayValue: yellows },
  { name: 'redCards', displayValue: '2' }, { name: 'totalShots', displayValue: '12' }, { name: 'shotsOnTarget', displayValue: '5' }];
function summary(row = match()) {
  return { header: { id: row.sourceEventId, competitions: [{ id: row.sourceEventId, date: row.startTime, status: { type: { state: 'post', completed: true, name: 'STATUS_FULL_TIME' } },
    competitors: [{ id: row.homeId, team: { id: row.homeId }, homeAway: 'home', score: String(row.homeScore), linescores: [{ displayValue: '1' }, { displayValue: '1' }] },
      { id: row.awayId, team: { id: row.awayId }, homeAway: 'away', score: String(row.awayScore), linescores: [{ displayValue: '0' }, { displayValue: '1' }] }] }] },
    boxscore: { teams: [{ team: { id: row.homeId }, statistics: stats('0') }, { team: { id: row.awayId }, statistics: stats('3', '2') }] } };
}
function fixtures() {
  const shared = match('1', 0, { id: `${route}:333333`, sourceEventId: '333333', homeId: '1', awayId: '2', homeScore: 1, awayScore: 1 });
  const lists = Object.fromEntries(['1', '2'].map(teamId => [teamId, [
    { ...shared, source: { ...shared.source, url: `https://site.api.espn.com/apis/site/v2/sports/${route}/teams/${teamId}/schedule` } },
    ...Array.from({ length: 7 }, (_, i) => match(teamId, i + 1)),
  ]]));
  const rows = new Map(Object.values(lists).flat().map(row => [row.sourceEventId, row]));
  return { lists, rows };
}
function options(changes = {}) {
  const { lists, rows } = fixtures();
  return { clock: () => now,
    loadMatches: async (events, q) => ({ events: lists[q.teamId], coverage: { status: 'refreshed', fetchedAt: at, season: 2026 } }),
    fetchSummary: async url => ({ data: summary(rows.get(new URL(url).searchParams.get('event'))), observedAt: at }), ...changes };
}

test('canonical football metrics preserve real zeros and keep yellow cards separate from red cards and card points', () => {
  const result = extractFootballExtraStats(summary(), match());
  assert.deepEqual(result['1'], { corners: 0, yellowCards: 0, shots: 12, shotsOnTarget: 5 });
  assert.deepEqual(result['8'], { corners: 3, yellowCards: 2, shots: 12, shotsOnTarget: 5 });
  assert.equal(result['1'].redCards, undefined); assert.equal(result['1'].cardPoints, undefined);
  const noCorners = summary(); noCorners.boxscore.teams[0].statistics[0].name = 'cornerKicks';
  assert.equal(extractFootballExtraStats(noCorners, match())['1'].corners, undefined);
});

test('90-minute schedule proof and matching final summary identity prevent extra-time, shootout and wrong-fixture observations', () => {
  assert.equal(extractFootballExtraStats(summary(), { ...match(), regulationOnly: false }), null);
  for (const mutate of [d => d.header.id = '99999', d => d.header.competitions[0].date = at,
    d => d.header.competitions[0].competitors[0].id = '8', d => d.header.competitions[0].competitors[0].score = '9',
    d => d.header.competitions[0].status.period = 4, d => d.header.competitions[0].status.clock = 7200,
    d => d.header.competitions[0].status.type.name = 'STATUS_FULL_TIME_AET', d => d.header.competitions[0].competitors[0].shootoutScore = 4,
    d => d.header.competitions[0].competitors[0].linescores.push({ displayValue: '1' }),
    d => d.boxscore.teams[1].team.id = '1']) {
    const data = summary(); mutate(data); assert.equal(extractFootballExtraStats(data, match()), null);
  }
});

test('missing, contradictory and malformed stats stay absent rather than becoming zero or contaminating other metrics', () => {
  const data = summary();
  data.boxscore.teams[0].statistics.push({ name: 'wonCorners', displayValue: '7' });
  data.boxscore.teams[0].statistics[1].displayValue = '';
  data.boxscore.teams[0].statistics[4].displayValue = '15';
  const result = extractFootballExtraStats(data, match());
  assert.equal(result['1'].corners, undefined); assert.equal(result['1'].yellowCards, undefined);
  assert.equal(result['1'].shotsOnTarget, undefined); assert.equal(result['1'].shots, 12);
  const contradictory = summary(); contradictory.boxscore.teams[0].statistics[0].value = 9;
  assert.equal(extractFootballExtraStats(contradictory, match())['1'].corners, undefined);
});

test('service reads shared H2H only once, shares inflight/cache and reports exact metric coverage and original fetch times', async () => {
  const base = options(); let calls = 0;
  const service = createFootballExtraStatsService({ ...base, fetchSummary: async url => { calls++; return base.fetchSummary(url); } });
  const a = service(query), b = service(query); assert.equal(a, b);
  const data = await a; assert.equal(data.status, 'available'); assert.equal(calls, 15);
  assert.equal(data.teams.home.sample, 8); assert.equal(data.teams.away.sample, 8);
  assert.deepEqual(data.coverage.metrics.corners, { home: 8, away: 8 });
  assert.equal(data.teams.home.matches[0].stats.corners.own, 0);
  assert.equal(data.teams.home.matches[0].sourceFetchedAt, at); assert.equal(data.observedAt, at);
  assert.equal(data.modelExperimentEligible, false); assert.equal(data.currentDescriptive, true);
  assert.equal((await service(query)), data); assert.equal(calls, 15);
});

test('partial source failures and unknown metrics are explicit; source time before a match cannot become an observation', async () => {
  const base = options(); let clock = now, calls = 0;
  const service = createFootballExtraStatsService({ ...base, clock: () => clock, fetchSummary: async url => {
    calls++; const event = new URL(url).searchParams.get('event');
    if (event === '100001') throw new Error('offline');
    const body = await base.fetchSummary(url);
    if (event === '200001') body.observedAt = '2025-01-01T00:00:00.000Z';
    if (event === '100002') body.data.boxscore.teams[0].statistics = body.data.boxscore.teams[0].statistics.filter(s => s.name !== 'yellowCards');
    return body;
  } });
  const data = await service(query);
  assert.equal(data.status, 'partial'); assert.equal(data.teams.home.sample, 7); assert.equal(data.teams.away.sample, 7);
  assert.deepEqual(data.coverage.metrics.yellowCards, { home: 6, away: 7 });
  assert.equal(data.coverage.errors.length, 2);
  clock += 20000; assert.equal(await service(query), data); assert.equal(calls, 15);
  clock += 11000; assert.notEqual(await service(query), data); assert.equal(calls, 30);
});

test('overall work budget stops scheduling more summaries and leaves a labelled partial result', async () => {
  const base = options(); let clock = now, calls = 0;
  const service = createFootballExtraStatsService({ ...base, clock: () => clock, fetchSummary: async url => {
    calls++; clock += 3500; const data = await base.fetchSummary(url); return { ...data, observedAt: new Date(clock).toISOString() };
  } });
  const data = await service(query);
  assert.equal(data.status, 'partial'); assert.equal(data.coverage.budgetReached, true);
  assert.ok(calls < 15); assert.ok(clock - now <= 22000); assert.match(data.reason, /ograniczony czas/);
});

test('API rejects invalid bindings before source access and unsupported Ekstraklasa remains honest without network reads', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const future = new Date(Date.now() + 3600000).toISOString();
  for (const q of [{ ...query, sport: 'nba', fixtureStart: future }, { ...query, route: 'soccer/bad', fixtureStart: future }, { ...query, fixtureStart: new Date(Date.now() + 72 * 3600000).toISOString() }, { ...query, homeId: ['1'], fixtureStart: future }, { ...query, homeId: '2', fixtureStart: future }, { ...query, fixtureId: 'soccer/esp.1:999999', fixtureStart: future }, { ...query, fixtureStart: '2026-02-30T00:00:00Z' }]) {
    const res = response(); await handler({ method: 'GET', query: q }, res); assert.equal(res.statusCode, 400);
  }
  const post = response(); await handler({ method: 'POST', query }, post); assert.equal(post.statusCode, 405);
  const res = response(); await handler({ method: 'GET', query: { sport: 'football', route: 'soccer/pol.1', homeId: 'tsdb-1', awayId: 'tsdb-2', fixtureId: 'soccer/pol.1:tsdb-123456', fixtureStart: future } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.status, 'unavailable'); assert.match(res.body.reason, /Ekstraklasy/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('shared summary loader readiness does not enqueue supplemental reads behind active work', async () => {
  let finish;
  const loader = createSummaryLoader({ concurrency: 1, fetchImpl: async () => new Promise(resolve => { finish = resolve; }) });
  const pending = loader('https://example.test/summary?event=100001');
  assert.equal(loader.ready('https://example.test/other'), false);
  assert.equal(loader.ready('https://example.test/summary?event=100001'), true);
  const slot = loader.waitForSlot(); finish({}); await pending; await slot;
  assert.equal(loader.ready('https://example.test/other'), true);
});
