import test from 'node:test';
import assert from 'node:assert/strict';
import details from '../api/details.js';

const id = '401900001';
function source() {
  const start = new Date(Date.now() + 3 * 3600000).toISOString();
  return { header: { id, competitions: [{ id, date: start, status: { type: { state: 'pre', completed: false } }, competitors: [
    { id: '1', homeAway: 'home', team: { id: '1', displayName: 'Test Home' } },
    { id: '2', homeAway: 'away', team: { id: '2', displayName: 'Test Away' } },
  ] }] }, pickcenter: [{ provider: { id: '123', name: 'Example' }, homeTeamOdds: { teamId: '1', moneyLine: -200 }, awayTeamOdds: { teamId: '2', moneyLine: 170 },
    moneyline: { displayName: 'Moneyline including overtime', home: { close: { odds: '-200' } }, away: { close: { odds: '+170' } } },
    total: { displayName: 'Total (including overtime)', over: { close: { line: 'o230.5', odds: '-110' } }, under: { close: { line: 'u230.5', odds: '-110' } } },
  }] };
}
const response = () => ({ statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
async function call() { const res = response(); await details({ method: 'GET', query: { sport: 'nba', route: 'basketball/nba', id } }, res); return res; }

test('details reuses one source response for exact match odds and availability', async t => {
  const data = source();
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => data }));
  const res = await call();
  assert.equal(res.statusCode, 200); assert.equal(fetch.mock.callCount(), 1);
  assert.equal(res.body.odds.fixtureId, `basketball/nba:${id}`);
  assert.equal(res.body.odds.startTime, data.header.competitions[0].date);
  assert.equal(res.body.odds.fetchedAt, res.body.fetchedAt);
  assert.equal(res.body.odds.quotes.length, 2);
  assert.equal(res.body.odds.quotes[1].line, 230.5);
  assert.equal(res.body.odds.quotes[0].outcomes[0].decimal, 1.5);
  assert.equal(res.headers['Cache-Control'], 'public, s-maxage=60');
  assert.ok(!JSON.stringify(res.body.odds).includes('probability'));
});

test('details keeps anonymous or completed source results out of active price badges', async t => {
  let data = source(); delete data.header.competitions;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => data }));
  assert.equal((await call()).body.odds, null);
  data = source(); data.header.competitions[0].status.type = { state: 'post', completed: true };
  const closed = await call();
  assert.equal(closed.body.odds.status, 'closed');
  assert.deepEqual(closed.body.odds.quotes, []);
});
