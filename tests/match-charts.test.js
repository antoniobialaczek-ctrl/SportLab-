import test from 'node:test';
import assert from 'node:assert/strict';
import { matchChartsHTML } from '../public/match-charts.js';

const event = { id: 'basketball/nba:999999', route: 'basketball/nba', sport: 'nba', date: '2026-02-01T00:00:00.000Z', homeId: '1', awayId: '2', home: 'Test A', away: 'Test B' };
const row = (id, day, scoreFor = 110, scoreAgainst = 100, changes = {}) => ({ id: `basketball/nba:${id}`, route: 'basketball/nba', date: `2026-01-${String(day).padStart(2, '0')}T12:00:00.000Z`, scoreFor, scoreAgainst, opponent: 'Test Rival', ...changes });
const analysis = (home = [row('100002', 2, 120, 100), row('100001', 1)], away = [row('200002', 3, 105, 100)]) => ({ sport: 'nba', route: event.route, fixtureId: event.id, cutoff: event.date, home: { id: '1', recent: home }, away: { id: '2', recent: away } });
const totals = html => [...html.matchAll(/data-total="(\d+)"/g)].map(match => Number(match[1]));

test('charts use actual combined final points in chronological order with a shared zero baseline', () => {
  const html = matchChartsHTML(analysis(), event, { line: 224.5 });
  assert.deepEqual(totals(html), [210, 220, 205]);
  assert.equal((html.match(/data-zero-baseline="true"/g) || []).length, 2);
  assert.equal((html.match(/>250<\/text>/g) || []).length, 2);
  assert.match(html, /Linia porównania: <b>224,5/);
  assert.match(html, /Średnia: <b>215/);
  assert.match(html, /role="img"/);
  assert.match(html, /110:100; suma 210 punktów/);
});

test('target, future, cutoff-equal and malformed scores never appear or turn into zero', () => {
  const records = [row('100001', 1), row('100002', 2, undefined, 100), row('100003', 3, -1, 100),
    row('100004', 4, 110, NaN), row('100005', 5, 101, 101), row('999999', 6),
    row('100006', 6, 100, 90, { date: event.date }), row('100007', 7, 100, 90, { date: '2026-02-02T00:00:00Z' }),
    row('100008', 8, 100, 90, { route: 'basketball/other' })];
  // Explicitly remove a score: default function arguments would otherwise replace undefined.
  delete records[1].scoreFor;
  assert.deepEqual(totals(matchChartsHTML(analysis(records, []), event)), [210]);
});

test('identical duplicate rows collapse and conflicting observations are omitted on both sides', () => {
  const first = row('100001', 1);
  const repeated = row('100002', 2, 120, 100);
  const shared = row('100003', 3, 110, 90);
  const home = [first, first, repeated, { ...repeated, scoreFor: 121 }, shared];
  const away = [{ ...shared, scoreFor: 115, scoreAgainst: 90 }, row('200001', 4, 130, 100)];
  assert.deepEqual(totals(matchChartsHTML(analysis(home, away), event)), [210, 230]);
});

test('a shared head-to-head result must reverse participant scores even when totals agree', () => {
  const shared = row('100001', 1, 110, 100);
  const reversed = { ...shared, scoreFor: 100, scoreAgainst: 110 };
  assert.deepEqual(totals(matchChartsHTML(analysis([shared], [reversed]), event)), [210, 210]);
  assert.deepEqual(totals(matchChartsHTML(analysis([shared], [{ ...shared }]), event)), []);
});

test('at most ten valid results per participant are drawn and compact charts retain exact facts', () => {
  const home = Array.from({ length: 14 }, (_, index) => row(String(100000 + index), index + 1, 110 + index, 100));
  const html = matchChartsHTML(analysis(home, []), event, { compact: true });
  assert.deepEqual(totals(html), [214, 215, 216, 217, 218, 219, 220, 221, 222, 223]);
  assert.match(html, /match-charts-compact/);
  assert.match(html, /10 wcześniejszych meczów/);
  assert.equal((html.match(/<figure /g) || []).length, 1);
});

test('wrong participant or league binding prevents charts and unsupported sports stay quiet', () => {
  for (const mutate of [value => value.home.id = '3', value => value.route = 'basketball/other', value => value.fixtureId = 'basketball/nba:123456', value => value.cutoff = '2999-01-01T00:00:00.000Z']) {
    const value = analysis(); mutate(value);
    assert.deepEqual(totals(matchChartsHTML(value, event)), []);
  }
  assert.equal(matchChartsHTML(analysis(), { ...event, sport: 'nhl' }), '');
});

test('source names and invalid reference lines cannot inject SVG or invented numbers', () => {
  const label = '<img src=x onerror=alert(1)>';
  const value = analysis([row('100001', 1, 110, 100, { opponent: label })], []);
  const html = matchChartsHTML(value, { ...event, home: label }, { line: '<script>999</script>' });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img/);
  assert.ok(!html.includes('chart-reference'));
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('probability'));
  assert.deepEqual(totals(html), [210]);
});
