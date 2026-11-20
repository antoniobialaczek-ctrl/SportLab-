import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPricedPicks, screenPick } from '../public/pick-screening.js';

const now = Date.parse('2026-11-20T12:00:00.000Z');
const event = { id: 'basketball/nba:401910007', route: 'basketball/nba', sport: 'nba', state: 'pre', date: '2026-11-21T00:00:00.000Z', homeId: '5', awayId: '29' };
const winner = { kind: 'result', market: 'winner', side: 'home', scope: 'including_overtime' };
const player = { kind: 'player', market: 'player_prop', metric: 'PTS', playerId: '3908809', teamId: '5', line: 24.5, direction: 'over', scope: 'including_overtime' };
const observedAt = '2026-11-20T11:59:00.000Z';
function data(price = 1.75, prop = false) {
  return { fixtureId: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId, startTime: event.date,
    status: 'available', source: 'ESPN', fetchedAt: observedAt, quotes: [{ provider: 'Example source', providerId: '100',
      market: prop ? 'player_prop' : 'winner', line: prop ? player.line : null, scope: winner.scope, observedAt, quotedAt: null, freshness: 'unverified',
      ...(prop ? { playerId: player.playerId, teamId: player.teamId, metric: player.metric } : {}),
      outcomes: prop ? [{ side: 'over', decimal: price }, { side: 'under', decimal: 1.9 }] : [{ side: 'home', decimal: price }, { side: 'away', decimal: 2.1 }] }] };
}
const screen = (pick = winner, options = {}, fixture = event) => screenPick(pick, fixture, { oddsData: data(), now, ...options });

test('the default 1.50 minimum is inclusive and two price bands split exactly at 2.00', () => {
  assert.equal(screen(winner, { oddsData: data(1.49) }).status, 'below-minimum');
  for (const price of [1.5, 1.99, 1.999]) {
    const result = screen(winner, { oddsData: data(price) });
    assert.equal(result.eligible, true); assert.equal(result.band, 'lower');
  }
  const high = screen(winner, { oddsData: data(2) });
  assert.equal(high.eligible, true); assert.equal(high.band, 'higher');
  assert.equal(screen(winner, { oddsData: data(2), band: 'lower' }).status, 'outside-band');
  assert.equal(screen(winner, { band: 'higher' }).status, 'outside-band');
  assert.equal(screen(winner, { minOdds: 1.8 }).status, 'below-minimum');
});

test('price screening retains actual freshness and does not create a probability or risk rating', () => {
  const result = screen();
  assert.equal(result.quote.decimal, 1.75); assert.equal(result.quote.freshness, 'unverified');
  assert.equal(result.quote.quotedAt, null); assert.equal(result.quote.observedAt, observedAt);
  assert.equal(result.quote.readOnly, true); assert.equal(result.quote.usableForComparison, false);
  assert.match(result.label, /kurs/);
  for (const key of ['probability', 'confidence', 'risk', 'expectedValue']) assert.equal(result[key], undefined);
});

test('an athlete price must match the player, team, metric, line and settlement scope', () => {
  const oddsData = data(1.9, true);
  assert.equal(screen(player, { oddsData }).eligible, true);
  for (const change of [{ playerId: '3908810' }, { teamId: '29' }, { metric: 'AST' }, { line: 25.5 }, { scope: 'including_overtime_shootout' }]) {
    assert.equal(screen({ ...player, ...change }, { oddsData }).status, 'missing-price');
  }
  assert.equal(screen(winner, { oddsData: { ...data(), fixtureId: 'basketball/nba:401910008' } }).eligible, false);
});

test('missing, stale or closed prices cannot enter either group, even with a high historical hit count', () => {
  const pick = { ...winner, hits: 10, sample: 10 };
  assert.equal(screen(pick, { oddsData: undefined }).status, 'missing-price');
  const stale = data(); stale.quotes[0].freshness = 'stale';
  assert.equal(screen(pick, { oddsData: stale }).eligible, false);
  assert.equal(screen(pick, { now: now + 6 * 60000 }).eligible, false);
  assert.equal(screen(pick, {}, { ...event, state: 'in' }).eligible, false);
  assert.equal(screen(pick, { now: Date.parse(event.date) }).eligible, false);
});

test('invalid settings fail closed and filtering preserves descriptors and their original order', () => {
  for (const minOdds of [1, 1001, '1.50', null, NaN, Infinity]) assert.equal(screen(winner, { minOdds }).status, 'invalid-settings');
  assert.equal(screen(winner, { band: 'safe' }).status, 'invalid-settings');
  const other = { ...winner, side: 'away' }, picks = [other, winner];
  const selected = filterPricedPicks(picks, event, { oddsData: data(1.4), now });
  assert.deepEqual(selected, [other]); assert.equal(selected[0], other); assert.deepEqual(picks, [other, winner]);
  assert.deepEqual(filterPricedPicks(null, event), []);
});
