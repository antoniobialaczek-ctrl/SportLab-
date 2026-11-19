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

function withTotals() {
  const data = source(), row = data.pickcenter[0];
  row.header = { text: 'Game Odds' }; row.provider = { id: '100', name: 'DraftKings' };
  row.overUnder = 238.5; row.overOdds = -110; row.underOdds = -110;
  row.total = { displayName: 'Total', over: { close: { line: 'o238.5', odds: '-110' }, open: { line: 'o236.5', odds: '-105' } }, under: { close: { line: 'u238.5', odds: '-110' } } };
  return data;
}

test('NBA full-game source totals retain exact lines and both actual prices, independently of winner prices', () => {
  const result = extract(withTotals()), total = result.quotes.find(row => row.market === 'total_points');
  assert.equal(result.quotes.find(row => row.market === 'winner').line, null);
  assert.equal(total.line, 238.5); assert.equal(total.scope, 'including_overtime');
  assert.deepEqual(total.outcomes.map(row => [row.direction, row.line, row.american, row.decimal]), [['over', 238.5, -110, 1.909091], ['under', 238.5, -110, 1.909091]]);
  assert.equal(total.scopeBasis.kind, 'provider-rules');
  assert.equal(total.scopeBasis.provider, 'DraftKings');
  assert.ok(total.scopeBasis.url.startsWith('https://boothillcasino.com/'));
  assert.equal(total.usableForComparison, false);
  assert.equal(total.freshness, 'unverified'); assert.equal(total.quotedAt, null);
  assert.equal(total.maxObservationAgeMs, 300000);
  assert.equal(Date.parse(total.observationValidUntil) - now, 300000);
  assert.equal(result.unavailableMarkets.find(row => row.market === 'player_prop').market, 'player_prop');
});

test('totals never use a different line, opening price, spread or default price to fill missing data', () => {
  for (const mutate of [row => row.total.under.close.line = 'u237.5', row => row.total.over.close.line = 'u238.5',
    row => row.total.over.close.line = 'o238', row => row.overUnder = 236.5,
    row => delete row.total.under.close.odds, row => row.total.over.close.odds = '1.91',
    row => row.overOdds = -115, row => row.total.displayName = '1st Half Total',
    row => row.total.period = 1]) {
    const data = withTotals(); mutate(data.pickcenter[0]);
    assert.equal(extract(data).quotes.some(row => row.market === 'total_points'), false);
    assert.equal(extract(data).quotes.some(row => row.market === 'winner'), true);
  }
  const noWinner = withTotals(); delete noWinner.pickcenter[0].moneyline;
  assert.equal(extract(noWinner).quotes[0].market, 'total_points');
  const wrongFixture = withTotals(); wrongFixture.pickcenter[0].total.over.close.link = { tracking: { tags: { gameId: '99999', betSide: 'over', league: 'nba' } } };
  assert.equal(extract(wrongFixture).quotes.some(row => row.market === 'total_points'), false);
  const wrongDirection = withTotals(); wrongDirection.pickcenter[0].total.over.close.link = { tracking: { tags: { gameId: '401910007', betSide: 'under', league: 'nba' } } };
  assert.equal(extract(wrongDirection).quotes.some(row => row.market === 'total_points'), false);
});

test('provider overtime rule is limited to documented provider identity and full-game markets, with expiring evidence', () => {
  const valid = extract(withTotals());
  assert.ok(valid.quotes.every(row => row.scope === 'including_overtime'));
  for (const mutate of [row => row.provider.id = '101', row => row.provider.name = 'Other provider', row => row.header.text = 'First Half Odds', row => delete row.header]) {
    const data = withTotals(); mutate(data.pickcenter[0]);
    assert.ok(extract(data).quotes.every(row => row.scope === 'unknown'));
  }
  const laterSource = withTotals(); laterSource.header.competitions[0].date = '2027-01-01T00:00:00Z';
  const expired = extractOdds(laterSource, { ...fixture, startTime: '2027-01-01T00:00:00Z' }, { now: Date.parse('2026-12-20T00:00:00Z') });
  assert.ok(expired.quotes.every(row => row.scope === 'unknown'));
  const quarter = withTotals(); quarter.pickcenter[0].moneyline.displayName = '1st Quarter Moneyline including overtime';
  assert.equal(extract(quarter).quotes.some(row => row.market === 'winner'), false);
});

test('wrong identity, ambiguous header, team-bound prices and conflicting prices cannot expose a quote', () => {
  for (const mutate of [data => data.header.id = '99999', data => data.header.competitions.push(structuredClone(data.header.competitions[0])),
    data => data.header.competitions[0].date = '2026-11-19T01:00:00Z', data => data.header.competitions[0].competitors[0].id = '29',
    data => data.header.competitions[0].competitors[0].team.id = '99', data => data.pickcenter[0].homeTeamOdds.teamId = '29',
    data => data.pickcenter[0].homeTeamOdds.moneyLine = -250, data => delete data.pickcenter[0].provider.name,
    data => delete data.pickcenter[0].moneyline.away.close, data => data.pickcenter[0].moneyline.home.close.odds = '1.5',
    data => data.pickcenter[0].moneyline.home.close.link = { tracking: { tags: { gameId: '99999' } } }]) {
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
