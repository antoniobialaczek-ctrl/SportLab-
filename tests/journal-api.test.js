import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import resultsHandler, { selectJournalResults } from '../api/journal-results.js';
import forecastHandler from '../api/forecast.js';
import { forecastReadiness, inspectVerifiedModelBoundary, verifyLiveFixture } from '../src/server/forecast.js';

const route = 'basketball/nba';
const now = Date.parse('2026-11-18T12:00:00.000Z');
const query = { sport: 'nba', route, id: `${route}:401234567`, homeId: '1', awayId: '2', startTime: '2026-11-19T12:00:00.000Z', market: 'winner', outcome: 'home' };
const historyRow = (overrides = {}) => ({ id: `${route}:401234567`, sourceEventId: '401234567', sport: 'nba', route, league: 'nba', season: '2026',
  homeId: '1', awayId: '2', home: 'Test A', away: 'Test B', homeScore: 100, awayScore: 90, neutralSite: false,
  startTime: '2026-11-16T12:00:00.000Z', resultAvailableAt: '2026-11-17T12:00:00.000Z', status: 'completed', availabilityBasis: 'conservative-24h',
  source: { provider: 'ESPN', url: `https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=20261116`, fetchedAt: '2026-11-17T13:00:00.000Z' }, ...overrides });
const scoreboard = () => ({ events: [{ id: '401234567', date: query.startTime, competitions: [{ id: '401234567', date: query.startTime,
  neutralSite: false, status: { type: { state: 'pre', completed: false } },
  competitors: [{ id: '1', homeAway: 'home' }, { id: '2', homeAway: 'away' }] }] }] });
function response() { return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; }
async function request(handler, params, method = 'GET') { const res = response(); await handler({ method, query: params }, res); return res; }
async function isolated(t, name, files) {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-journal-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([cp(new URL('../api/', import.meta.url), join(root, 'api'), { recursive: true }), cp(new URL('../src/', import.meta.url), join(root, 'src'), { recursive: true }), writeFile(join(root, 'package.json'), '{"type":"module"}')]);
  for (const [path, data] of Object.entries(files || {})) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), typeof data === 'string' ? data : JSON.stringify(data));
  }
  return (await import(pathToFileURL(join(root, 'api', `${name}.js`)))).default;
}

test('journal and forecast API reject non-GET and malformed or oversized parameters before network access', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider access'); });
  for (const handler of [resultsHandler, forecastHandler]) assert.equal((await request(handler, {}, 'POST')).statusCode, 405);
  const resultQueries = [{ sport: 'cs2', ids: query.id }, { sport: 'nba', ids: '' }, { sport: 'nba', ids: [query.id] },
    { sport: 'nba', ids: 'soccer/eng.1:12345' }, { sport: 'nba', ids: `${query.id},${query.id}` },
    { sport: 'nba', ids: Array.from({ length: 51 }, (_, i) => `${route}:${10000 + i}`).join(',') }, { sport: 'nba', ids: `${route}:../12345` }];
  for (const params of resultQueries) assert.equal((await request(resultsHandler, params)).statusCode, 400);
  for (const params of [{ ...query, homeId: '2' }, { ...query, startTime: '2026-02-30T00:00:00.000Z' },
    { ...query, id: 'hockey/nhl:12345' }, { ...query, route: 'https://example.com' }, { ...query, market: 'result_90', outcome: 'draw' }, { ...query, outcome: ['home'] }]) {
    assert.equal((await request(forecastHandler, params)).statusCode, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('result selection returns only requested completed facts known at retrieval time and strips unexpected fields', () => {
  const row = historyRow(); row.privateForecast = [0.9, 0.1]; row.source.token = 'not-public';
  const future = historyRow({ id: `${route}:401234568`, resultAvailableAt: '2026-11-19T12:00:00.000Z' });
  const notObserved = historyRow({ id: `${route}:401234569`, source: { ...row.source, fetchedAt: '2026-11-19T00:00:00.000Z' } });
  const unrequested = historyRow({ id: `${route}:401234570` });
  const ids = [row.id, future.id, notObserved.id, `${route}:9999999`];
  const result = selectJournalResults({ events: [row, future, notObserved, unrequested] }, ids, { now });
  assert.deepEqual(result.rows.map(item => item.id), [row.id]);
  assert.equal(result.rows[0].privateForecast, undefined); assert.equal(result.rows[0].source.token, undefined);
  assert.deepEqual(result.missing, ids.slice(1));
});

test('results API preserves participants, actual scores and source provenance without publishing full history', async t => {
  const row = historyRow(); const other = historyRow({ id: `${route}:401234568`, sourceEventId: '401234568' });
  const handler = await isolated(t, 'journal-results', { 'data/history/nba.json': { schemaVersion: 1, updatedAt: row.source.fetchedAt, events: [row, other] } });
  const res = await request(handler, { sport: 'nba', ids: row.id });
  assert.equal(res.statusCode, 200); assert.equal(res.body.rows.length, 1);
  assert.equal(res.body.rows[0].homeId, '1'); assert.equal(res.body.rows[0].awayScore, 90);
  assert.equal(res.body.rows[0].availabilityBasis, 'conservative-24h');
  assert.equal(res.body.rows[0].source.provider, 'ESPN'); assert.deepEqual(res.body.missing, []);
  assert.equal(res.body.events, undefined);
});

test('missing result history stays explicitly pending while corrupt history cannot grade a journal', async t => {
  const missing = await isolated(t, 'journal-results');
  const res = await request(missing, { sport: 'nba', ids: query.id });
  assert.equal(res.body.historyAvailable, false); assert.deepEqual(res.body.rows, []); assert.deepEqual(res.body.missing, [query.id]);
  assert.equal(res.headers['cache-control'], 'no-store');
  const corrupt = await isolated(t, 'journal-results', { 'data/history/nba.json': '{bad' });
  assert.equal((await request(corrupt, { sport: 'nba', ids: query.id })).statusCode, 503);
});

test('forecast readiness rejects stale, future and missing reports and never repurposes historical accuracy', () => {
  const report = { generatedAt: new Date(now).toISOString(), sports: { nba: { metrics: { accuracy: 0.99 }, publication: { eligible: true }, status: 'validated' } } };
  for (const input of [null, { ...report, generatedAt: '2020-01-01T00:00:00.000Z' }, { ...report, generatedAt: '2026-11-19T00:00:00.000Z' }, report]) {
    const value = forecastReadiness(query, input, null, { now });
    assert.equal(value.status, 'withheld'); assert.equal(value.probability, null); assert.equal(value.probabilities, undefined);
  }
  assert.match(forecastReadiness({ ...query, startTime: new Date(now).toISOString() }, report, null, { now }).reason, /po rozpoczęciu/);
});

test('a completed test or forged eligible summary cannot unlock fixture probabilities before independent review', () => {
  const report = { generatedAt: new Date(now).toISOString(), sports: { nba: { status: 'validated', publication: { eligible: true }, provenance: { pointInTimeVerified: true } } } };
  const forward = { validation: { publication: { eligible: true }, leagues: [{ route, phase: 'completed-awaiting-review', publication: { eligible: true } }] } };
  const value = forecastReadiness(query, report, forward, { now });
  assert.equal(value.status, 'withheld'); assert.equal(value.publication.eligible, false); assert.equal(value.probability, null);
  assert.match(value.reason, /oczekuje przeglądu/);
});

test('live fixture verification binds exact identity, timestamp, neutral site and pre-match state', () => {
  const fixture = verifyLiveFixture(query, scoreboard(), { now });
  assert.equal(fixture.neutralSite, false); assert.equal(fixture.homeId, query.homeId);
  for (const mutate of [data => data.events[0].competitions[0].competitors.reverse().forEach((row, index) => row.homeAway = index ? 'away' : 'home'),
    data => data.events[0].competitions[0].date = '2026-11-19T13:00:00.000Z',
    data => data.events[0].competitions[0].status.type.state = 'in',
    data => delete data.events[0].competitions[0].neutralSite,
    data => data.events[0].competitions.push(structuredClone(data.events[0].competitions[0]))]) {
    const data = scoreboard(); mutate(data); assert.throws(() => verifyLiveFixture(query, data, { now }));
  }
});

test('existing model boundary is connected only after source binding and never returns research vectors', () => {
  const value = inspectVerifiedModelBoundary(query, scoreboard(), [], { sports: { nba: { status: 'research' } } }, { now });
  assert.equal(value.status, 'withheld'); assert.equal(value.probability, null); assert.equal(value.probabilities, undefined);
  assert.match(value.reason, /walidacji/);
});

test('public forecast API remains fail-closed without any provider request', async t => {
  const handler = await isolated(t, 'forecast', { 'data/reports/models.json': { schemaVersion: 1, generatedAt: new Date().toISOString(), sports: { nba: { sport: 'nba', status: 'research', metrics: null } } } });
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unneeded provider request'); });
  const res = await request(handler, { ...query, startTime: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(res.statusCode, 200); assert.equal(res.body.status, 'withheld'); assert.equal(res.body.probability, null);
  assert.equal(res.headers['cache-control'], 'no-store'); assert.equal(fetch.mock.callCount(), 0);
});
