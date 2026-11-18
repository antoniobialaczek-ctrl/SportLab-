import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMatchAnalysis } from '../src/server/match-analysis.js';
import handler from '../api/match-analysis.js';

const route = 'basketball/nba', cutoff = '2026-02-01T00:00:00.000Z';
const query = { sport: 'nba', route, homeId: '1', awayId: '2', cutoff };
function event(number, overrides = {}) {
  const day = String(number).padStart(2, '0'), sourceEventId = String(1000 + number);
  return { id: `${route}:${sourceEventId}`, sourceEventId, sport: 'nba', league: 'nba', route, season: '2026',
    startTime: `2026-01-${day}T12:00:00.000Z`, resultAvailableAt: `2026-01-${String(number + 1).padStart(2, '0')}T12:00:00.000Z`,
    availabilityBasis: 'conservative-24h', homeId: '1', awayId: '2', home: 'Test A', away: 'Test B',
    homeScore: 110, awayScore: 90, neutralSite: false, status: 'completed',
    source: { provider: 'ESPN', url: `https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=20260101`, fetchedAt: cutoff }, ...overrides };
}
function response() {
  return { statusCode: 200, headers: {}, body: undefined,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}
async function request(api, params = query, method = 'GET') {
  const res = response(); await api({ method, query: params }, res); return res;
}
async function isolated(t, content) {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-match-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([cp(new URL('../api/', import.meta.url), join(root, 'api'), { recursive: true }), cp(new URL('../src/', import.meta.url), join(root, 'src'), { recursive: true }), writeFile(join(root, 'package.json'), '{"type":"module"}')]);
  if (content !== undefined) {
    await mkdir(join(root, 'data/history'), { recursive: true });
    await writeFile(join(root, 'data/history/nba.json'), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return (await import(pathToFileURL(join(root, 'api/match-analysis.js')))).default;
}

test('match analysis orients outcomes, margins and direct meetings toward the selected fixture', () => {
  const rows = [event(1), event(2, { homeId: '2', awayId: '1', home: 'Test B', away: 'Test A', homeScore: 80, awayScore: 100 })];
  const result = buildMatchAnalysis(rows, query);
  assert.equal(result.status, 'available');
  assert.equal(result.home.wins, 2);
  assert.equal(result.away.losses, 2);
  assert.equal(result.home.averageFor, 105);
  assert.equal(result.home.averageMargin, 20);
  assert.equal(result.away.averageMargin, -20);
  assert.deepEqual(result.home.streak, { outcome: 'W', count: 2 });
  assert.equal(result.home.splits.home.sample, 1);
  assert.equal(result.home.splits.away.sample, 1);
  assert.equal(result.headToHead.homeWins, 2);
  assert.equal(result.headToHead.recent[0].currentHomeScore, 100);
  assert.equal(result.headToHead.recent[0].homeScore, 80);
  assert.equal(result.comparison.formWinsDifference, 2);
  assert.ok(!JSON.stringify(result).includes('probabilities'));
});

test('a preview uses the last ten eligible matches and the last five direct meetings', () => {
  const result = buildMatchAnalysis(Array.from({ length: 15 }, (_, i) => event(i + 1)), query);
  assert.equal(result.home.sample, 10);
  assert.equal(result.home.recent[0].sourceEventId, '1015');
  assert.equal(result.home.recent.at(-1).sourceEventId, '1006');
  assert.equal(result.headToHead.sample, 5);
  assert.equal(result.headToHead.recent.at(-1).sourceEventId, '1011');
  assert.equal(result.home.restDays, 16);
  assert.equal(result.comparison.sampleComplete, true);
});

test('results at or after cutoff, a different sport/route and the selected fixture never enter preview features', () => {
  const rows = [event(1), event(2, { resultAvailableAt: cutoff }), event(3, { startTime: '2026-02-02T00:00:00.000Z' }),
    event(4, { route: 'basketball/other' }), event(5, { sport: 'nhl' }), event(6)];
  const result = buildMatchAnalysis(rows, { ...query, fixtureId: event(6).id });
  assert.equal(result.home.sample, 1);
  assert.equal(result.headToHead.sample, 1);
  assert.equal(result.historyRange.availableMatches, 1);
});

test('missing or unequal histories remain explicit instead of inventing balanced strength', () => {
  const empty = buildMatchAnalysis([], query);
  assert.equal(empty.status, 'unavailable');
  assert.equal(empty.home.averageFor, null);
  assert.equal(empty.home.restDays, null);
  assert.deepEqual(empty.home.streak, { outcome: null, count: 0 });
  assert.equal(empty.comparison.formWinsDifference, null);
  const partial = buildMatchAnalysis([event(1, { awayId: '3', away: 'Test C' })], query);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.away.sample, 0);
  assert.equal(partial.comparison.averageMarginDifference, null);
  assert.ok(partial.narrative.some(line => line.includes('brak wcześniejszych spotkań')));
  const unequal = buildMatchAnalysis([event(1), event(2, { awayId: '3', away: 'Test C' })], query);
  assert.equal(unequal.comparison.formWinsDifference, null);
  assert.ok(unequal.notes.some(line => line.includes('różną liczebność')));
});

test('actual football draws are counted and duplicate records are rejected', () => {
  const rows = [event(1, { sport: 'football', route: 'soccer/eng.1', league: 'eng.1', homeScore: 2, awayScore: 2 })];
  const result = buildMatchAnalysis(rows, { ...query, sport: 'football', route: 'soccer/eng.1' });
  assert.equal(result.home.draws, 1);
  assert.equal(result.headToHead.draws, 1);
  assert.match(result.narrative[0], /1 remis/);
  assert.throws(() => buildMatchAnalysis([event(1), event(1)], query), /Powielony/);
});

test('preview API rejects invalid method, arrays, identities and future or rollover cutoffs before accessing history', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected source access'); });
  assert.equal((await request(handler, {}, 'POST')).statusCode, 405);
  for (const invalid of [{ ...query, homeId: '2' }, { ...query, awayId: ['2'] }, { ...query, sport: 'football' },
    { ...query, cutoff: '2999-01-01T00:00:00Z' }, { ...query, cutoff: '2026-02-30T00:00:00Z' },
    { ...query, fixtureId: 'soccer/eng.1:12345' }, { ...query, fixtureId: `${route}:../12345` }]) {
    const res = await request(handler, invalid);
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('preview API returns real history coverage and useful prose from a single validated collection', async t => {
  const api = await isolated(t, { schemaVersion: 1, updatedAt: cutoff, events: [event(1)], exclusions: [], coverage: { lastFetch: { from: '2026-01-01', to: '2026-01-31' } } });
  const res = await request(api);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'available');
  assert.equal(res.body.historyAvailable, true);
  assert.equal(res.body.home.name, 'Test A');
  assert.equal(res.body.home.sample, 1);
  assert.equal(res.body.historyUpdatedAt, cutoff);
  assert.equal(res.body.coverage.lastFetch.from, '2026-01-01');
  assert.ok(res.body.narrative.length >= 3);
  assert.equal(res.headers['cache-control'], 'public, s-maxage=300');
});

test('missing history produces a noncached unavailable preview while corrupt history fails closed', async t => {
  const missing = await isolated(t);
  const res = await request(missing);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'unavailable');
  assert.equal(res.body.historyAvailable, false);
  assert.equal(res.headers['cache-control'], 'no-store');
  const corrupt = await isolated(t, '{broken');
  const failed = await request(corrupt);
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.headers['cache-control'], 'no-store');
});
