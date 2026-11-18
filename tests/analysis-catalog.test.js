import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/analysis-catalog.js';
import { buildAnalysisCatalog } from '../src/server/analysis-catalog.js';
import { liveEvents } from '../src/server/scores.js';

const make = (id, date, extra = {}) => ({ id: `basketball/nba:${id}`, sourceEventId: String(id), sport: 'nba', route: 'basketball/nba', league: 'nba', startTime: `${date}T12:00:00.000Z`, resultAvailableAt: `${date}T23:00:00.000Z`, homeId: '1', awayId: '2', home: 'Test A', away: 'Test B', homeScore: 100, awayScore: 90, ...extra });
const query = { sport: 'nba', routes: ['basketball/nba'], cutoff: '2026-01-10T00:00:00.000Z', limit: 2 };
test('archive uses latest available real results in the selected sport and routes, with explicit past dates', () => {
  const events = buildAnalysisCatalog([make(10001, '2026-01-01'), make(10002, '2026-01-09'), make(10003, '2026-01-08'), make(10004, '2026-01-11'), make(10005, '2026-01-09', { resultAvailableAt: query.cutoff }), make(10006, '2026-01-07', { sport: 'nhl', route: 'hockey/nhl', league: 'nhl' })], query);
  assert.deepEqual(events.map(e => e.sourceEventId), ['10002', '10003']);
  assert.ok(events.every(e => e.state === 'post' && e.date && e.forecast.status === 'withheld'));
  assert.deepEqual(buildAnalysisCatalog([], query), []);
});
test('archive rejects unknown dates and unbounded lists', () => {
  assert.throws(() => buildAnalysisCatalog([], { ...query, cutoff: 'bad' }));
  assert.throws(() => buildAnalysisCatalog([], { ...query, limit: 100 }));
});
async function request(query, method = 'GET') {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method, query }, res); return res;
}
test('archive validates IDs, source coverage and query boundaries before storage reads', async () => {
  assert.equal((await request({}, 'POST')).statusCode, 405);
  for (const invalid of [{ sport: 'bad' }, { sport: ['nba'] }, { sport: 'nba', limit: '25' }, { sport: 'nba', cutoff: '2999-01-01T00:00:00Z' }, { sport: 'football', league: 'bad' }]) assert.equal((await request(invalid)).statusCode, 400);
  for (const unavailable of [{ sport: 'cs2' }, { sport: 'football', league: 'pol.1' }]) {
    const res = await request(unavailable); assert.equal(res.statusCode, 200); assert.deepEqual(res.body.events, []); assert.equal(res.body.status, 'unavailable');
  }
});
test('live tennis tour identity agrees with the history used by the analysis', () => {
  const c = { id: '1234567', date: '2026-01-01T12:00:00Z', status: { type: { state: 'pre' } }, competitors: [{ id: '1', homeAway: 'home', athlete: { displayName: 'Test A' } }, { id: '2', homeAway: 'away', athlete: { displayName: 'Test B' } }] };
  const data = { events: [{ groupings: [{ grouping: { slug: 'womens-singles' }, competitions: [c] }] }] };
  assert.deepEqual(liveEvents(data, { sport: 'tennis', route: 'tennis/atp', date: '2026-01-01' }), []);
  assert.equal(liveEvents(data, { sport: 'tennis', route: 'tennis/wta', date: '2026-01-01' }).length, 1);
});
