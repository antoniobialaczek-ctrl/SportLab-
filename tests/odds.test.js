import test from 'node:test';
import assert from 'node:assert/strict';
import { americanToDecimal, extractOdds } from '../src/server/odds.js';
import { oddsHTML } from '../public/odds-view.js';
import handler from '../api/odds.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const fixture = { sport: 'nba', route: 'basketball/nba', id: 'basketball/nba:401910007', homeId: '5', awayId: '29', startTime: '2026-11-19T00:00:00.000Z' };
function source() {
  return { header: { id: '401910007', competitions: [{ id: '401910007', date: fixture.startTime, status: { type: { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' } }, competitors: [{ id: '5', homeAway: 'home', team: { id: '5', displayName: 'Test A' } }, { id: '29', homeAway: 'away', team: { id: '29', displayName: 'Test B' } }] }] },
    pickcenter: [{ provider: { id: '100', name: 'Test provider' }, homeTeamOdds: { teamId: '5', moneyLine: -197 }, awayTeamOdds: { teamId: '29', moneyLine: 164 }, moneyline: { displayName: 'Moneyline', home: { close: { odds: '-197' }, open: { odds: '-190' } }, away: { close: { odds: '+164' } } } }] };
}
const extract = value => extractOdds(value, fixture, { now });
function response() { return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
async function request(query, method = 'GET') { const res = response(); await handler({ query, method }, res); return res; }

test('American conversion accepts explicit moneyline values without treating them as probabilities or decimal odds', () => {
  assert.deepEqual(americanToDecimal('+164'), { american: 164, decimal: 2.64 });
  assert.deepEqual(americanToDecimal(-200), { american: -200, decimal: 1.5 });
  assert.deepEqual(americanToDecimal('+100'), { american: 100, decimal: 2 });
  for (const value of [0, 1.8, '1.8', '2/1', 'EVEN', null, undefined, NaN, Infinity, true, ' 164', '-99', 100000]) assert.equal(americanToDecimal(value), null);
});

test('real ESPN-shaped moneyline remains read-only when freshness and overtime rules are unknown', () => {
  const result = extract(source());
  assert.equal(result.status, 'available');
  assert.equal(result.quotes[0].provider, 'Test provider');
  assert.equal(result.quotes[0].scope, 'unknown');
  assert.equal(result.quotes[0].freshness, 'unverified');
  assert.equal(result.quotes[0].quotedAt, null);
  assert.equal(result.quotes[0].observedAt, new Date(now).toISOString());
  assert.equal(result.quotes[0].usableForComparison, false);
  assert.equal(result.quotes[0].readOnly, true);
  assert.equal(result.quotes[0].outcomes[0].american, -197);
  assert.equal(result.quotes[0].outcomes[0].decimal, 1.507614);
  assert.ok(!JSON.stringify(result).includes('probability'));
});

test('wrong identity, ambiguous header, team-bound prices and conflicting prices cannot expose a quote', () => {
  for (const mutate of [data => data.header.id = '99999', data => data.header.competitions.push(structuredClone(data.header.competitions[0])),
    data => data.header.competitions[0].date = '2026-11-19T01:00:00Z', data => data.header.competitions[0].competitors[0].id = '29',
    data => data.header.competitions[0].competitors[0].team.id = '99', data => data.pickcenter[0].homeTeamOdds.teamId = '29',
    data => data.pickcenter[0].homeTeamOdds.moneyLine = -250, data => delete data.pickcenter[0].provider.name,
    data => delete data.pickcenter[0].moneyline.away.close, data => data.pickcenter[0].moneyline.home.close.odds = '1.5']) {
    const data = source(); mutate(data); assert.equal(extract(data).quotes.length, 0);
  }
  const conflict = source(); conflict.pickcenter.push(structuredClone(conflict.pickcenter[0]));
  conflict.pickcenter[1].moneyline.home.close.odds = '-250'; conflict.pickcenter[1].homeTeamOdds.moneyLine = -250;
  assert.equal(extract(conflict).quotes.length, 0);
});

test('started, completed, postponed and past fixtures never expose prematch quotes', () => {
  for (const status of [{ state: 'in', completed: false }, { state: 'post', completed: true }, { state: 'pre', completed: false, name: 'STATUS_POSTPONED' }]) {
    const data = source(); data.header.competitions[0].status.type = status;
    assert.equal(extract(data).status, 'closed'); assert.equal(extract(data).quotes.length, 0);
  }
  assert.equal(extractOdds(source(), fixture, { now: Date.parse(fixture.startTime) }).status, 'closed');
});

test('only source timestamps affect freshness; fetched time, future or malformed timestamps never certify it', () => {
  const data = source(); data.pickcenter[0].lastUpdated = '2026-11-18T11:55Z';
  assert.equal(extract(data).quotes[0].freshness, 'fresh');
  assert.equal(extract(data).quotes[0].quotedAt, '2026-11-18T11:55:00.000Z');
  data.pickcenter[0].lastUpdated = '2026-11-18T11:00:00Z';
  assert.equal(extract(data).quotes[0].freshness, 'stale');
  for (const value of ['2026-11-18T12:01:00Z', '2026-02-30T11:55:00Z', now, '18/11/2026']) {
    data.pickcenter[0].lastUpdated = value; assert.equal(extract(data).quotes[0].freshness, 'unverified');
    assert.equal(extract(data).quotes[0].quotedAt, null);
  }
});

test('football and NHL cannot silently reinterpret two-way prices as a 90-minute or full-match market', () => {
  for (const sport of ['football', 'nhl']) assert.equal(extractOdds(source(), { ...fixture, sport }, { now }).quotes.length, 0);
  const football = source(); football.pickcenter[0].moneyline.displayName = 'Moneyline (90 minutes)'; football.pickcenter[0].moneyline.draw = { close: { odds: '+250' } };
  const result = extractOdds(football, { ...fixture, sport: 'football' }, { now });
  assert.equal(result.quotes[0].scope, 'regulation_90'); assert.equal(result.quotes[0].outcomes.length, 3);
  const nhl = source(); nhl.pickcenter[0].moneyline.displayName = 'Moneyline including overtime and shootouts';
  assert.equal(extractOdds(nhl, { ...fixture, sport: 'nhl' }, { now }).quotes[0].scope, 'including_overtime_shootout');
});

test('view escapes source names and explicitly labels unknown scope and update time', () => {
  const data = source(); data.pickcenter[0].provider.name = '<img src=x onerror=1>';
  const result = extract(data), event = { ...fixture, home: 'Test A', away: 'Test B' };
  const html = oddsHTML(result, event);
  assert.ok(!html.includes('<img')); assert.match(html, /&lt;img/);
  assert.match(html, /Świeżość niepotwierdzona/); assert.match(html, /nie potwierdza zasad/);
  assert.match(html, /Aktualizacja kursu w źródle: niepodany/);
  assert.ok(!oddsHTML(result, { ...event, id: 'wrong' }).includes('<table>'));
});

test('odds API validates all bindings before source access and handles missing source without fabricating prices', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({}) }));
  assert.equal((await request({}, 'POST')).statusCode, 405);
  for (const query of [{ ...fixture, homeId: ['5'] }, { ...fixture, homeId: '29' }, { ...fixture, id: 'soccer/eng.1:401910007' }, { ...fixture, startTime: '2026-02-30T00:00:00Z' }]) assert.equal((await request(query)).statusCode, 400);
  assert.equal(fetch.mock.callCount(), 0);
  const future = { ...fixture, startTime: new Date(Date.now() + 86400000).toISOString() };
  const unavailable = await request(future);
  assert.equal(unavailable.statusCode, 200); assert.equal(unavailable.body.status, 'unavailable');
  assert.deepEqual(unavailable.body.quotes, []); assert.equal(unavailable.headers['Cache-Control'], 'no-store');
  assert.equal(fetch.mock.callCount(), 1);
});
