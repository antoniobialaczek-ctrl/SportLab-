import test from 'node:test';
import assert from 'node:assert/strict';
import { playerFormCardsHTML } from '../public/player-form-cards.js';

const now = Date.parse('2026-11-20T12:00:00.000Z'), observedAt = '2026-11-20T11:59:00.000Z', route = 'basketball/nba';
const options = { sport: 'nba', now };
function fixture(id = '401910007', playerId = '10', price = 1.85) {
  const event = { id: `${route}:${id}`, route, sport: 'nba', homeId: '5', awayId: '29', home: 'Home', away: 'Away', league: 'NBA', state: 'pre', date: '2026-11-21T00:00:00.000Z' };
  const pick = { kind: 'player', market: 'player_prop', playerId, playerName: 'Example Player', teamId: '5', metric: 'AST', label: 'Asysty', scope: 'including_overtime', direction: 'over', line: 6.5,
    statement: 'Example Player — powyżej 6,5 asysty', hits: 7, sample: 8, average: 999, median: 999, last5Average: 999,
    observations: [0, 7, 8, 9, 10, 11, 12, 13].map((value, index) => ({ matchId: `${route}:${100000 + index}`, date: `2026-11-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`, value })) };
  const oddsData = { fixtureId: event.id, sport: 'nba', route, homeId: event.homeId, awayId: event.awayId, startTime: event.date, status: 'available', source: 'ESPN', fetchedAt: observedAt,
    quotes: [{ provider: 'Example source', market: 'player_prop', playerId, teamId: '5', metric: 'AST', line: 6.5, scope: pick.scope, observedAt, quotedAt: null, freshness: 'unverified', outcomes: [{ side: 'over', decimal: price }, { side: 'under', decimal: 1.9 }] }] };
  return { event, pick, oddsData };
}
const renderedValues = html => [...html.matchAll(/data-value="(\d+)"/g)].map(row => Number(row[1]));

test('player cards show exact selection, price and genuine latest-first outings including zero', () => {
  const html = playerFormCardsHTML([fixture()], options);
  assert.match(html, /Example Player — powyżej 6,5 asysty/); assert.match(html, /Kurs 1,85/);
  assert.deepEqual(renderedValues(html), [13, 12, 11, 10, 9, 8, 7, 0]);
  assert.match(html, /08\.11\.2026/); assert.match(html, /Średnia <b>8,8/); assert.match(html, /Mediana <b>9,5/); assert.match(html, /Ostatnie 5 <b>11/);
  assert.ok(!html.includes('999')); assert.ok(!html.includes('<details')); assert.match(html, /7 z 8/);
  assert.equal((html.match(/class="pfc-observation is-hit"/g) || []).length, 7);
  assert.doesNotMatch(html, /pewniak|najpewniejsz|\d%/);
});

test('missing, future, duplicate and conflicting observations never become invented outings', () => {
  for (const mutate of [row => delete row.pick.observations[0].value,
    row => row.pick.observations[0].date = row.event.date,
    row => row.pick.observations[0].matchId = row.pick.observations[1].matchId,
    row => row.pick.hits = 8]) {
    const row = fixture(); mutate(row); assert.equal(playerFormCardsHTML([row], options), '');
  }
  const first = fixture(), changed = structuredClone(first); changed.pick.observations[1].value = 20;
  assert.equal(playerFormCardsHTML([first, changed], options), '');
});

test('current exact athlete, line, scope, price and sport are required', () => {
  for (const mutate of [row => row.oddsData.quotes[0].playerId = '99', row => row.oddsData.quotes[0].line = 7.5,
    row => row.oddsData.quotes[0].scope = 'regulation_90', row => row.oddsData.quotes[0].outcomes[0].decimal = 1.49,
    row => row.event.state = 'post', row => row.event.sport = 'nhl', row => delete row.oddsData]) {
    const row = fixture(); mutate(row); assert.equal(playerFormCardsHTML([row], options), '');
  }
  assert.equal(playerFormCardsHTML([fixture()], { ...options, now: now + 6 * 60000 }), '');
  assert.equal(playerFormCardsHTML([fixture()], { ...options, band: 'higher' }), '');
});

test('cards are bounded, deduplicated and cannot concentrate more than two on a fixture', () => {
  const rows = [fixture('200001', '10'), fixture('200001', '11'), fixture('200001', '12'), fixture('200002', '13'), fixture('200003', '14'), fixture('200004', '15')];
  const html = playerFormCardsHTML([...rows, rows[0]], options);
  assert.equal((html.match(/data-player-form-card/g) || []).length, 4);
  assert.equal((html.match(/data-fixture-id="basketball\/nba:200001"/g) || []).length, 2);
  assert.equal((playerFormCardsHTML(rows, { ...options, limit: 1 }).match(/data-player-form-card/g) || []).length, 1);
  assert.equal(playerFormCardsHTML(rows, { ...options, limit: 5 }), '');
});

test('untrusted names and statements are escaped, and photos use the exact athlete source', () => {
  const row = fixture(); row.event.home = '<script>alert(1)</script>'; row.pick.playerName = '<img src=x>';
  row.pick.statement = '<svg onload=alert(1)>'; row.pick.headshot = 'https://a.espncdn.com/i/headshots/nba/players/full/10.png';
  const html = playerFormCardsHTML([row], options);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<svg')); assert.match(html, /&lt;img/); assert.match(html, /&lt;svg/);
  assert.match(html, /headshots\/nba\/players\/full\/10.png/);
});
