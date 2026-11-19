import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPickQuote, pickOddsHTML, pickOddsContentHTML } from '../public/pick-odds.js';

const now = Date.parse('2026-11-18T20:00:00.000Z');
const event = { id: 'basketball/nba:401910007', sport: 'nba', route: 'basketball/nba', state: 'pre', date: '2026-11-19T00:00:00.000Z', homeId: '5', awayId: '29' };
const winner = { kind: 'result', market: 'winner', side: 'home', scope: 'including_overtime' };
const total = { kind: 'total', market: 'total_points', line: 235.5, direction: 'over', scope: 'including_overtime' };
const player = { kind: 'player', market: 'player_prop', metric: 'PTS', playerId: '3908809', teamId: '5', line: 24.5, direction: 'over', scope: 'including_overtime' };
function quote(market = 'winner', overrides = {}) {
  return { provider: 'Example source', providerId: '100', market, line: market === 'winner' ? null : market === 'total_points' ? 235.5 : 24.5,
    scope: 'including_overtime', observedAt: '2026-11-18T19:59:00.000Z', quotedAt: null, freshness: 'unverified', readOnly: true, usableForComparison: false,
    outcomes: market === 'winner' ? [{ side: 'home', decimal: 1.85 }, { side: 'away', decimal: 2.1 }] : [{ side: 'over', direction: 'over', decimal: 1.91 }, { side: 'under', direction: 'under', decimal: 1.95 }],
    ...overrides };
}
function data(quotes = [quote()]) { return { fixtureId: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId, startTime: event.date, status: 'available', fetchedAt: '2026-11-18T19:59:00.000Z', source: 'ESPN', quotes }; }
const match = (value = data(), pick = winner, fixture = event) => matchPickQuote(value, fixture, pick, { now });

test('a quote binds exactly to a selected winner and remains an informational observation', () => {
  const result = match();
  assert.equal(result.status, 'matched'); assert.equal(result.decimal, 1.85);
  assert.equal(result.freshness, 'unverified'); assert.equal(result.quotedAt, null);
  assert.equal(result.readOnly, true); assert.equal(result.usableForComparison, false);
  assert.equal(result.probability, undefined); assert.equal(result.expectedValue, undefined);
  assert.equal(match(data(), { ...winner, side: 'away' }).decimal, 2.1);
});

test('totals require the exact line, direction and overtime scope, with no nearby-line substitution', () => {
  const value = data([quote('total_points')]);
  assert.equal(match(value, total).decimal, 1.91);
  assert.equal(match(value, { ...total, direction: 'under' }).decimal, 1.95);
  for (const pick of [{ ...total, line: 234.5 }, { ...total, line: '235.5' }, { ...total, scope: 'regulation_90' }, { ...total, direction: 'home' }]) assert.equal(match(value, pick).status, 'unavailable');
  const unknown = data([quote('total_points', { scope: 'unknown' })]);
  assert.equal(match(unknown, total).status, 'unavailable');
  assert.equal(match(data(), total).status, 'unavailable');
});

test('wrong event, reversed teams, rescheduled dates and malformed timestamps fail closed', () => {
  for (const overrides of [{ fixtureId: 'basketball/nba:401910008' }, { sport: 'nhl' }, { route: 'hockey/nhl' }, { homeId: '29', awayId: '5' }, { startTime: '2026-11-19T01:00:00.000Z' }, { fetchedAt: '2026-02-30T19:59:00.000Z' }]) assert.equal(match({ ...data(), ...overrides }).status, 'unavailable');
  assert.equal(match(data(), winner, { ...event, state: 'post' }).status, 'closed');
  assert.equal(matchPickQuote(data(), event, winner, { now: Date.parse(event.date) }).status, 'closed');
});

test('source update time cannot be replaced by a fetch timestamp and old or future observations expire', () => {
  const fresh = data([quote('winner', { quotedAt: '2026-11-18T19:58:00.000Z', freshness: 'fresh' })]);
  assert.equal(match(fresh).freshness, 'fresh');
  for (const overrides of [{ observedAt: '2026-11-18T19:54:00.000Z' }, { observedAt: '2026-11-18T20:02:00.000Z' }, { quotedAt: '2026-11-18T20:00:00.000Z' }, { quotedAt: '2026-11-18T19:30:00.000Z' }, { quotedAt: 'bad' }, { freshness: 'stale' }, { observationValidUntil: '2026-11-18T19:59:59.000Z' }]) assert.equal(match(data([quote('winner', overrides)])).status, 'unavailable');
  assert.equal(match({ ...data(), fetchedAt: '2026-11-18T19:54:59.000Z' }).status, 'unavailable');
  assert.equal(match({ ...data(), observationValidUntil: '2026-11-19T00:00:00.000Z' }).status, 'unavailable');
});

test('player prices require an exact athlete, team, metric and stat line', () => {
  const value = data([quote('player_prop', { playerId: player.playerId, teamId: '5', metric: 'PTS' })]);
  assert.equal(match(value, player).decimal, 1.91);
  for (const overrides of [{ playerId: '10' }, { teamId: '29' }, { metric: 'AST' }, { line: 23.5 }, { scope: 'regulation_90' }]) assert.equal(match(value, { ...player, ...overrides }).status, 'unavailable');
  assert.equal(match(value, { ...player, teamId: undefined }).status, 'unavailable');
  assert.equal(matchPickQuote(value, event, { ...player, teamId: undefined }, { now, teamId: '5' }).status, 'matched');
  assert.equal(match(data(), player).status, 'unavailable');
});

test('a three-way result quote never becomes a double-chance price', () => {
  const football = { ...event, id: 'soccer/eng.1:1234567', sport: 'football', route: 'soccer/eng.1' };
  const value = { ...data([quote('winner', { scope: 'regulation_90', outcomes: [{ side: 'home', decimal: 1.8 }, { side: 'draw', decimal: 3.2 }, { side: 'away', decimal: 3.9 }] })]), fixtureId: football.id, sport: football.sport, route: football.route };
  assert.equal(match(value, { kind: 'result', market: 'winner', side: 'home', scope: 'regulation_90' }, football).status, 'matched');
  assert.equal(match(value, { kind: 'result', market: '1X', side: 'home', scope: 'regulation_90' }, football).status, 'unavailable');
});

test('duplicate source conflicts and invalid prices do not silently select a convenient quote', () => {
  const changed = quote('winner', { outcomes: [{ side: 'home', decimal: 1.9 }, { side: 'away', decimal: 2.1 }] });
  assert.equal(match(data([quote(), changed])).status, 'unavailable');
  assert.equal(match(data([quote(), quote()])).decimal, 1.85);
  for (const price of [0, 1, 1001, '1.85', Infinity, NaN]) assert.equal(match(data([quote('winner', { outcomes: [{ side: 'home', decimal: price }, { side: 'away', decimal: 2.1 }] })])).status, 'unavailable');
  const other = quote('winner', { provider: 'Other source', providerId: '200', quotedAt: '2026-11-18T19:58:00.000Z', freshness: 'fresh' });
  assert.equal(match(data([quote(), other])).provider, 'Other source');
});

test('HTML badges escape provenance and keep a bounded descriptor without history or user labels', () => {
  const value = data([quote('winner', { provider: '<img src=x onerror=1>' })]);
  const html = pickOddsHTML(value, event, { ...winner, observations: [{ secret: true }], label: 'unsafe <script>label</script>' }, { now });
  assert.match(html, /Kurs 1,85/); assert.match(html, /odczyt/); assert.match(html, /Świeżość kursu niepotwierdzona/);
  assert.ok(!html.includes('<img')); assert.match(html, /&lt;img/);
  assert.match(html, /data-pick-odds/); assert.match(html, /data-odds-event="basketball\/nba:401910007"/);
  assert.ok(!html.includes('secret')); assert.ok(!html.includes('unsafe'));
  assert.equal(pickOddsContentHTML(null, event, winner, { now }).includes('Kurs niedostępny'), true);
});
