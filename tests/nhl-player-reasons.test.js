import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerPickReasons, playerPickReasonsHTML } from '../public/player-pick-reasons.js';
import { buildPlayerPicks, evaluatePlayerLine, playerPicksHTML } from '../public/player-picks.js';
import { playerFormCardsHTML } from '../public/player-form-cards.js';

const now = Date.parse('2026-11-28T12:00:00.000Z'), route = 'hockey/nhl';
const event = { id: `${route}:999999`, sport: 'nhl', route, state: 'pre', date: '2026-11-28T22:00:00.000Z', homeId: '10', awayId: '20', home: 'Home Ice', away: 'Away Ice' };
const values = [5, 4, 3, 4, 6, 4, 2, 4, 5, 0];
function observations() { return values.map((value, index) => ({ matchId: `${route}:${100000 + index}`, date: new Date(now - (index + 1) * 86400000).toISOString(), value })); }
function pick() { return { playerId: '101', playerName: 'Test Skater', teamId: '10', kind: 'player', market: 'player_prop', metric: 'S', line: 3.5, direction: 'over', scope: 'including_overtime_excluding_shootout', sample: 10, hits: 7, observations: observations().reverse() }; }
function form() {
  const rows = observations(), sampledMatches = rows.map(row => ({ id: row.matchId, date: row.date }));
  return { sport: 'nhl', route, teamId: '10', status: 'available', cutoff: new Date(now - 60000).toISOString(), fetchedAt: new Date(now).toISOString(), sampledMatches, attemptedMatches: sampledMatches,
    players: [{ id: '101', name: 'Test Skater', metrics: { S: { sample: 10, observations: rows } }, minutes: { sample: 10, observations: rows.map((row, index) => ({ ...row, value: index < 5 ? 22 : 18 })) } }] };
}

test('NHL shot reasons use the exact goal-shot line and newest5, preserving misses and shootout exclusion', () => {
  const result = buildPlayerPickReasons(pick(), event, { now });
  assert.equal(result.status, 'available'); assert.equal(result.supported, true);
  assert.equal(result.stats.hits, 7); assert.equal(result.stats.recentHits, 4); assert.equal(result.stats.last5Average, 4.4);
  assert.equal(result.stats.median, 4); assert.equal(result.stats.minimum, 0); assert.equal(result.stats.maximum, 6);
  const html = playerPickReasonsHTML(pick(), event, { now, compact: false });
  assert.match(html, /7\/10/); assert.match(html, /4\/5/); assert.match(html, /0–6/);
  assert.match(html, /strzały na bramkę z dogrywką, bez serii karnych/);
  assert.match(html, /Nie są to wszystkie próby strzeleckie/); assert.match(html, /Brak pełnego czasu na lodzie/);
  assert.doesNotMatch(html, /gwarancj|pewniak|\d%|expectedValue|probability/);
});

test('NHL reasons reject the team-final scope, other metrics, wrong leagues, future and duplicated observations', () => {
  for (const mutate of [p => p.scope = 'including_overtime_shootout', p => p.scope = 'regulation_60', p => p.metric = 'G', p => p.metric = 'A',
    p => p.observations[0].matchId = 'basketball/nba:100000', p => p.observations[0].date = event.date,
    p => p.observations[0].matchId = p.observations[1].matchId, p => p.line = 2.5]) {
    const data = pick(); mutate(data); assert.equal(buildPlayerPickReasons(data, event, { now }).status, 'unavailable');
  }
  const under = pick(); under.line = 4.5; under.direction = 'under'; under.hits = 7;
  assert.equal(buildPlayerPickReasons(under, event, { now }).stats.hits, 7);
  assert.equal(buildPlayerPickReasons(pick(), { ...event, state: 'post' }, { now }).status, 'unavailable');
});

test('NHL cards and detail picks retain unpriced shot analysis and only matching actual ice time', () => {
  const data = form(), result = buildPlayerPicks(data, event, { now, analysisOnly: true }), selected = result.picks[0];
  assert.equal(selected.metric, 'S'); assert.equal(selected.line, 3.5); assert.equal(selected.minutes.sample, 10);
  assert.deepEqual(buildPlayerPickReasons(selected, event, { now }).stats.minutes, { sample: 10, average: 20, last5Average: 22 });
  const detail = playerPicksHTML(data, event, { now });
  assert.match(detail, /Co wspiera typ/); assert.match(detail, /średnio 20 min na lodzie, ostatnie 5: 22 min/);
  const cards = playerFormCardsHTML([{ event, pick: selected }], { sport: 'nhl', analysis: true, minOdds: 100, now });
  assert.match(cards, /data-analysis-only="true"/); assert.match(cards, /Co wspiera typ/); assert.match(cards, /7\/10/);
  assert.doesNotMatch(cards, /Kurs \d/);
  assert.equal(evaluatePlayerLine(data, event, '101', 'G', 0.5, { now }).status, 'unavailable');
  data.players[0].minutes.observations[0].date = '2026-11-27T11:00:00.000Z';
  const changed = buildPlayerPicks(data, event, { now, analysisOnly: true }).picks[0];
  assert.equal(changed.minutes, null); assert.equal(buildPlayerPickReasons(changed, event, { now }).stats.minutes, null);
  assert.doesNotMatch(playerPicksHTML(data, event, { now }), /20 min na lodzie/);
});
