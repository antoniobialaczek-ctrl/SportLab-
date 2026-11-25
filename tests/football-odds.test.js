import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdds } from '../src/server/odds.js';
import { createRecord, appendRecord, emptyJournal, settleJournal } from '../public/journal-core.js';

const now = Date.parse('2026-11-25T14:00:00.000Z');
const fixture = { sport: 'football', route: 'soccer/eng.2', id: 'soccer/eng.2:401880139', homeId: '379', awayId: '392', startTime: '2026-11-25T19:45:00.000Z' };
function source() {
  return { header: { id: '401880139', competitions: [{ id: '401880139', date: fixture.startTime, status: { type: { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' } },
    competitors: [{ id: '379', homeAway: 'home', team: { id: '379' } }, { id: '392', homeAway: 'away', team: { id: '392' } }] }] },
  pickcenter: [{ header: { text: 'Game Odds' }, provider: { id: '100', name: 'DraftKings' }, homeTeamOdds: { teamId: '379', moneyLine: 180 }, awayTeamOdds: { teamId: '392', moneyLine: 140 },
    moneyline: { displayName: 'Moneyline', home: { close: { odds: '+180' } }, draw: { close: { odds: '+260' } }, away: { close: { odds: '+140' } } },
    total: { displayName: 'Total', over: { close: { line: 'o2.5', odds: '-130' } }, under: { close: { line: 'u2.5', odds: '+105' } } } }] };
}
const extract = data => extractOdds(data, fixture, { now });

test('documented football full-time markets retain a three-way result and both exact goal prices', () => {
  const result = extract(source());
  assert.equal(result.status, 'available');
  assert.deepEqual(result.quotes.map(q => [q.market, q.scope]), [['winner', 'regulation_90'], ['total_goals', 'regulation_90']]);
  assert.deepEqual(result.quotes[0].outcomes.map(q => [q.side, q.decimal]), [['home', 2.8], ['draw', 3.6], ['away', 2.4]]);
  assert.deepEqual(result.quotes[1].outcomes.map(q => [q.side, q.line, q.decimal]), [['over', 2.5, 1.769231], ['under', 2.5, 2.05]]);
  for (const quote of result.quotes) {
    assert.equal(quote.scopeBasis.kind, 'provider-rules'); assert.match(quote.scopeBasis.url, /^https:\/\/support\.draftkings\.com\//);
    assert.equal(quote.freshness, 'unverified'); assert.equal(quote.quotedAt, null); assert.equal(quote.usableForComparison, false);
  }
  assert.ok(!JSON.stringify(result).includes('probability'));
});

test('football provider default requires the exact documented full-match identity and current rules', () => {
  for (const mutate of [r => r.provider.id = '101', r => r.provider.name = 'Other', r => r.header.text = 'First Half Odds', r => r.period = 1,
    r => { r.moneyline.displayName = 'To Advance'; r.total.displayName = 'Total including extra time'; }]) {
    const data = source(); mutate(data.pickcenter[0]); assert.equal(extract(data).quotes.length, 0);
  }
  for (const date of ['2026-11-25T13:00:00.000Z', '2026-12-27T14:00:00.000Z']) {
    const data = source(), startTime = '2026-12-28T19:45:00.000Z'; data.header.competitions[0].date = startTime;
    assert.equal(extractOdds(data, { ...fixture, startTime }, { now: Date.parse(date) }).quotes.length, 0);
  }
});

test('football totals reject partial markets, changed lines, extra-time scope and mismatched selection identities', () => {
  for (const mutate of [r => delete r.total.under.close.odds, r => r.total.under.close.line = 'u3.5', r => r.total.over.close.line = 'u2.5',
    r => r.total.displayName = 'Total 90 minutes including extra time', r => r.total.displayName = 'Total corners 90 minutes',
    r => r.total.displayName = '1st Half Total 90 minutes', r => r.total.period = 1,
    r => r.total.over.close.line = r.total.under.close.line = 16.5,
    r => r.total.over.close.link = { tracking: { tags: { gameId: '999999' } } },
    r => r.total.over.close.link = { tracking: { tags: { betSide: 'under' } } }]) {
    const data = source(); mutate(data.pickcenter[0]); assert.ok(!extract(data).quotes.some(q => q.market === 'total_goals'));
  }
  const incomplete = source(); delete incomplete.pickcenter[0].moneyline.draw;
  assert.ok(!extract(incomplete).quotes.some(q => q.market === 'winner'));
});

test('European goal journal settles only the exact 90-minute result and preserves half-goal scope', () => {
  const event = { ...fixture, date: fixture.startTime, state: 'pre', home: 'Home', away: 'Away' };
  const record = createRecord(event, { market: 'total_goals', outcome: 'over', line: 2.5, scope: 'regulation_90', odds: 1.77, stake: 1 }, { now: new Date(now).toISOString(), id: 'football-goals-01' });
  const journal = appendRecord(emptyJournal(), record);
  const result = { ...fixture, status: 'completed', scope: 'regulation_90', homeScore: 2, awayScore: 1, resultAvailableAt: '2026-11-26T22:00:00.000Z', availabilityBasis: 'conservative-24h',
    source: { provider: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.2/scoreboard?dates=20261125', fetchedAt: '2026-11-26T22:01:00.000Z' } };
  const settled = settleJournal(journal, [result], { now: '2026-11-26T23:00:00.000Z' }).records[0];
  assert.equal(settled.status, 'won'); assert.equal(settled.settlement.value, 3); assert.equal(settled.settlement.scope, 'regulation_90');
  for (const changes of [{ scope: 'including_overtime' }, { scope: undefined }, { homeId: '392' }]) assert.equal(settleJournal(journal, [{ ...result, ...changes }], { now: '2026-11-26T23:00:00.000Z' }).records[0].status, 'pending');
});
