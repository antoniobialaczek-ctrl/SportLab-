import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdds } from '../src/server/odds.js';
import { matchPickQuote } from '../public/pick-odds.js';

const now = Date.parse('2026-11-28T12:00:00.000Z');
const fixture = { id: 'hockey/nhl:401892810', sport: 'nhl', route: 'hockey/nhl', homeId: '37', awayId: '10', startTime: '2026-11-28T21:00:00.000Z' };
function source() { return { header: { id: '401892810', competitions: [{ id: '401892810', date: fixture.startTime, status: { type: { state: 'pre', completed: false } }, competitors: [
  { id: '37', homeAway: 'home', team: { id: '37', displayName: 'Vegas' } }, { id: '10', homeAway: 'away', team: { id: '10', displayName: 'Montreal' } }] }] },
  pickcenter: [{ provider: { id: '100', name: 'DraftKings' }, header: { text: 'Game Odds' }, homeTeamOdds: { teamId: '37', moneyLine: -122 }, awayTeamOdds: { teamId: '10', moneyLine: 102 },
    moneyline: { displayName: 'Moneyline', home: { close: { odds: '-122' } }, away: { close: { odds: '+102' } } },
    total: { displayName: 'Total', over: { close: { line: 'o6.5', odds: '-105' } }, under: { close: { line: 'u6.5', odds: '-115' } } } }] }; }
const extract = data => extractOdds(data, fixture, { now });

test('documented full-game NHL prices bind the exact provider, two-way winner and both goal prices', () => {
  const result = extract(source());
  assert.equal(result.status, 'available');
  assert.deepEqual(result.quotes.map(q => [q.market, q.scope]), [['winner', 'including_overtime_shootout'], ['total_goals', 'including_overtime_shootout']]);
  assert.deepEqual(result.quotes[0].outcomes.map(q => [q.side, q.decimal]), [['home', 1.819672], ['away', 2.02]]);
  assert.deepEqual(result.quotes[1].outcomes.map(q => [q.side, q.line, q.decimal]), [['over', 6.5, 1.952381], ['under', 6.5, 1.869565]]);
  for (const quote of result.quotes) {
    assert.equal(quote.scopeBasis.kind, 'provider-rules'); assert.match(quote.scopeBasis.section, /Hockey.*115/);
    assert.equal(quote.quotedAt, null); assert.equal(quote.freshness, 'unverified'); assert.equal(quote.usableForComparison, false);
  }
  const event = { ...fixture, state: 'pre', date: fixture.startTime };
  assert.equal(matchPickQuote(result, event, { kind: 'total', market: 'total_goals', direction: 'over', line: 6.5, scope: 'including_overtime_shootout' }, { now }).status, 'matched');
  assert.equal(matchPickQuote(result, event, { kind: 'total', market: 'total_goals', direction: 'over', line: 5.5, scope: 'including_overtime_shootout' }, { now }).status, 'unavailable');
});

test('NHL provider rules cannot supply period, regulation, other-provider or expired scope', () => {
  for (const mutate of [r => r.provider.id = '999', r => r.provider.name = 'Other', r => r.header.text = 'Regulation Time', r => r.period = 1,
    r => { r.moneyline.displayName = 'Moneyline 60 minutes'; r.total.displayName = 'Total Excl OT'; },
    r => { r.moneyline.displayName = '1st Period Moneyline'; r.total.displayName = '1st Period Total'; }]) {
    const data = source(); mutate(data.pickcenter[0]); assert.equal(extract(data).quotes.length, 0);
  }
  for (const at of ['2026-11-28T00:00:00.000Z', '2027-01-01T12:00:00.000Z']) {
    const data = source(), startTime = '2027-01-02T21:00:00.000Z'; data.header.competitions[0].date = startTime;
    assert.equal(extractOdds(data, { ...fixture, startTime }, { now: Date.parse(at) }).quotes.length, 0);
  }
});

test('NHL totals reject wrong markets, incomplete lines and shootout exceptions without filling missing prices', () => {
  for (const mutate of [r => r.total.under.close.line = 'u5.5', r => delete r.total.over.close.odds,
    r => r.total.displayName = 'Total (including overtime excluding shootouts)',
    r => r.total.displayName = 'Total 60 minutes (including overtime and shootouts)',
    r => r.total.displayName = 'Total Shots (including overtime and shootouts)',
    r => r.total.period = 2,
    r => r.total.over.close.link = { tracking: { tags: { gameId: '999999', betSide: 'over' } } }]) {
    const data = source(); mutate(data.pickcenter[0]); assert.ok(!extract(data).quotes.some(q => q.market === 'total_goals'));
  }
  const threeWay = source(); threeWay.pickcenter[0].moneyline.draw = { close: { odds: '+300' } };
  assert.ok(!extract(threeWay).quotes.some(q => q.market === 'winner'));
  const noTotal = source(); delete noTotal.pickcenter[0].total;
  assert.equal(extract(noTotal).quotes.length, 1); assert.equal(extract(noTotal).quotes[0].market, 'winner');
});
