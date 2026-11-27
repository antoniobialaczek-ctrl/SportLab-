import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerPickReasons, playerPickReasonsHTML } from '../public/player-pick-reasons.js';

const now = Date.parse('2026-11-27T12:00:00.000Z');
const event = { id: 'basketball/nba:999999', sport: 'nba', route: 'basketball/nba', state: 'pre', date: '2026-11-28T00:00:00.000Z' };
function pick() {
  const values = [8, 9, 0, 10, 11, 12, 7, 8];
  return { metric: 'AST', line: 6.5, direction: 'over', scope: 'including_overtime', sample: 8, hits: 7,
    average: 999, median: 999, last5Average: 999,
    observations: values.map((value, index) => ({ matchId: `basketball/nba:${100000 + index}`, date: new Date(now - (index + 1) * 86400000).toISOString(), value })).reverse() };
}

test('player explanations recompute the exact line from newest observations, preserving misses and zero', () => {
  const result = buildPlayerPickReasons(pick(), event, { now });
  assert.equal(result.status, 'available'); assert.equal(result.supported, true);
  assert.equal(result.stats.hits, 7); assert.equal(result.stats.recentHits, 4); assert.equal(result.stats.last5Average, 7.6);
  assert.equal(result.stats.latestValue, 8); assert.equal(result.stats.minimum, 0); assert.equal(result.stats.maximum, 12);
  assert.equal(result.stats.median, 8.5); assert.equal(result.stats.minutes, null);
  const html = playerPickReasonsHTML(pick(), event, { now, compact: false });
  assert.match(html, /Co wspiera typ/); assert.match(html, /Co może przeszkodzić/);
  assert.match(html, /7\/8/); assert.match(html, /4\/5/); assert.match(html, /0–12/); assert.match(html, /Brak pełnych minut/);
  assert.doesNotMatch(html, /999|probability|expectedValue|pewniak|gwarancj|\d%/);
});

test('a different line cannot borrow previous hit counts; future, duplicated or foreign observations have no explanation', () => {
  for (const mutate of [p => p.line = 9.5, p => p.observations[0].date = event.date,
    p => p.observations[0].matchId = p.observations[1].matchId,
    p => p.observations[0].matchId = 'soccer/eng.1:12345', p => p.scope = 'regulation_90']) {
    const data = pick(); mutate(data); assert.equal(buildPlayerPickReasons(data, event, { now }).status, 'unavailable');
    assert.equal(playerPickReasonsHTML(data, event, { now }), '');
  }
  const under = pick(); under.direction = 'under'; under.line = 9.5; under.hits = 5;
  const result = buildPlayerPickReasons(under, event, { now });
  assert.equal(result.stats.hits, 5); assert.equal(result.supported, false);
  assert.match(playerPickReasonsHTML(under, event, { now }), /Co pokazuje historia/);
  assert.equal(playerPickReasonsHTML(pick(), { ...event, sport: 'nhl', route: 'hockey/nhl' }, { now }), '');
});

test('minutes contribute only from all the same athlete outings and actual matching timestamps', () => {
  const data = pick(); data.minutes = { observations: data.observations.map(row => ({ ...row, value: 30 })) };
  const result = buildPlayerPickReasons(data, event, { now });
  assert.deepEqual(result.stats.minutes, { sample: 8, average: 30, last5Average: 30 });
  assert.match(playerPickReasonsHTML(data, event, { now }), /30 min gry/);
  for (const mutate of [p => p.minutes.observations[0].date = '2026-11-20T01:00:00.000Z',
    p => p.minutes.observations[0].matchId = 'basketball/nba:555555',
    p => p.minutes.observations[0].value = null, p => p.minutes.observations.pop()]) {
    const changed = structuredClone(data); mutate(changed);
    assert.equal(buildPlayerPickReasons(changed, event, { now }).stats.minutes, null);
    assert.doesNotMatch(playerPickReasonsHTML(changed, event, { now }), /30 min gry/);
  }
});
