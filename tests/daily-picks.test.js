import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDailyPicks, dailyPicksHTML } from '../public/daily-picks.js';

const now = Date.parse('2026-11-20T12:00:00.000Z');
const observedAt = '2026-11-20T11:59:00.000Z';
const route = 'basketball/nba';
function row(id = '401910007', hits = 8, price = 1.8) {
  const event = { id: `${route}:${id}`, route, sport: 'nba', homeId: '5', awayId: '29', home: 'Home', away: 'Away', league: 'NBA', state: 'pre', date: '2026-11-21T00:00:00.000Z' };
  const pick = { kind: 'result', market: 'winner', side: 'home', scope: 'including_overtime', label: 'Home — zwycięstwo', support: { home: { hits, sample: 10 }, away: { hits, sample: 10 } } };
  const oddsData = { fixtureId: event.id, route, sport: 'nba', homeId: '5', awayId: '29', startTime: event.date, status: 'available', source: 'ESPN', fetchedAt: observedAt,
    quotes: [{ provider: 'Example', market: 'winner', line: null, scope: pick.scope, observedAt, quotedAt: null, freshness: 'unverified', outcomes: [{ side: 'home', decimal: price }, { side: 'away', decimal: 2.1 }] }] };
  return { event, pick, oddsData };
}
const options = { sport: 'nba', now };

test('daily list keeps the exact matching price and reports historical counts without a probability', () => {
  const input = row(); const [selected] = selectDailyPicks([input], options);
  assert.equal(selected.event, input.event); assert.equal(selected.pick, input.pick);
  assert.equal(selected.quote.decimal, 1.8); assert.equal(selected.quote.freshness, 'unverified');
  assert.match(selected.rationale, /Home: 8\/10; Away: 8\/10/);
  for (const key of ['probability', 'confidence', 'expectedValue', 'risk', 'evidence']) assert.equal(selected[key], undefined);
  const html = dailyPicksHTML([input], options);
  assert.match(html, /Kurs 1,80/); assert.match(html, /21\.11\.2026/); assert.match(html, /01:00/);
  assert.match(html, /Szczegóły/); assert.ok(!html.includes('<svg')); assert.ok(!html.includes('data-journal-pick'));
});

test('unpriced, low, expired, started, distant, wrong-sport and inconsistent candidates stay absent', () => {
  const invalid = [row('100001', 10, 1.49), row('100002')]; delete invalid[1].oddsData;
  const changed = [
    value => value.oddsData.quotes[0].freshness = 'stale', value => value.event.state = 'in',
    value => value.event.date = '2026-11-20T11:00:00.000Z', value => value.event.date = '2026-11-23T00:00:00.000Z',
    value => value.event.sport = 'nhl', value => value.pick.support.home.hits = 11,
    value => value.pick.support.home.sample = 7, value => value.oddsData.fixtureId = 'basketball/nba:123456',
    value => value.pick.scope = 'regulation_90',
  ];
  changed.forEach((change, index) => { const value = row(String(200000 + index)); change(value); invalid.push(value); });
  assert.deepEqual(selectDailyPicks(invalid, options), []);
  assert.deepEqual(selectDailyPicks([row()], { ...options, now: now + 6 * 60000 }), []);
  assert.match(dailyPicksHTML(invalid, options), /Brak typów spełniających/);
});

test('ranking is deterministic from historical support, bounded to five distinct fixtures', () => {
  const rows = Array.from({ length: 8 }, (_, index) => row(String(100000 + index), index < 2 ? 10 : 9));
  const repeated = { ...rows[0], pick: { ...rows[0].pick, label: 'Repeated selection' } };
  const selection = selectDailyPicks([...rows, repeated], options);
  assert.equal(selection.length, 5); assert.equal(new Set(selection.map(row => row.event.id)).size, 5);
  assert.deepEqual(selection.map(row => row.event.id), selectDailyPicks([...rows].reverse(), options).map(row => row.event.id));
  assert.equal(selectDailyPicks(rows, { ...options, limit: 2 }).length, 2);
  assert.deepEqual(selectDailyPicks(rows, { ...options, limit: 6 }), []);
  const conflict = { ...rows[0], pick: { ...rows[0].pick, support: { home: { hits: 8, sample: 10 }, away: { hits: 8, sample: 10 } } } };
  assert.deepEqual(selectDailyPicks([rows[0], conflict], options), []);
});

test('player evidence needs actual distinct earlier observations and an exact athlete price', () => {
  const value = row();
  value.pick = { kind: 'player', market: 'player_prop', playerId: '10', teamId: '5', metric: 'PTS', scope: 'including_overtime', direction: 'over', line: 14.5,
    statement: 'Player — powyżej 14,5 punktu', hits: 8, sample: 8,
    observations: Array.from({ length: 8 }, (_, index) => ({ matchId: `${route}:${100000 + index}`, date: `2026-11-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`, value: 20 })) };
  Object.assign(value.oddsData.quotes[0], { market: 'player_prop', playerId: '10', teamId: '5', metric: 'PTS', line: 14.5, outcomes: [{ side: 'over', decimal: 1.9 }, { side: 'under', decimal: 1.9 }] });
  assert.equal(selectDailyPicks([value], options).length, 1);
  value.pick.observations[0].value = 10; assert.deepEqual(selectDailyPicks([value], options), []);
  value.pick.observations[0].value = 20; value.pick.observations[0].date = value.event.date; assert.deepEqual(selectDailyPicks([value], options), []);
});

test('price bands are respected and untrusted labels cannot inject markup', () => {
  const value = row('100001', 9, 2.1); value.event.home = '<img src=x>'; value.pick.label = '<script>alert(1)</script>';
  assert.deepEqual(selectDailyPicks([value], { ...options, band: 'lower' }), []);
  assert.equal(selectDailyPicks([value], { ...options, band: 'higher' }).length, 1);
  const html = dailyPicksHTML([value], options);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /pewniak|najpewniejsz|\d%/);
});
