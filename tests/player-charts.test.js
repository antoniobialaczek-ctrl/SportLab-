import test from 'node:test';
import assert from 'node:assert/strict';
import { playerMetricChartHTML } from '../public/player-charts.js';

const now = Date.parse('2026-11-19T12:00:00.000Z');
const row = (matchId, day, value, changes = {}) => ({ matchId, date: `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`, value, ...changes });
const render = (observations, options = {}) => playerMetricChartHTML({ observations }, { now, label: 'Punkty', ...options });
const values = html => [...html.matchAll(/data-value="(\d+)"/g)].map(match => Number(match[1]));
const observationIDs = html => [...html.matchAll(/data-match-id="([^"]+)"/g)].map(match => match[1]);

test('player charts show actual counts chronologically with accessible exact values and a zero baseline', () => {
  const observations = [row('new', 18, 8), row('old', 15, 2), row('middle', 17, 5)];
  const before = structuredClone(observations);
  const html = render(observations, { line: 7.5 });
  assert.deepEqual(values(html), [2, 5, 8]);
  assert.deepEqual(observations, before);
  assert.match(html, /viewBox="0 0 520 190"/);
  assert.match(html, /role="img"/);
  assert.match(html, /data-zero-baseline="true"/);
  assert.match(html, /<title>15\.11\.2026 — Punkty: 2<\/title>/);
  assert.match(html, />15\.11<\/text>/);
  assert.match(html, /Średnia: <b>5<\/b>/);
  assert.match(html, /class="pc-mean"/);
  assert.match(html, /Linia porównania: <b>7,5<\/b>/);
  assert.ok(!html.includes('%'));
  assert.ok(!html.includes('probability'));
});

test('a true zero stays a zero-height bar and all-zero results retain a valid scale', () => {
  const html = render([row('one', 16, 0), row('two', 17, 0)]);
  assert.deepEqual(values(html), [0, 0]);
  assert.equal((html.match(/class="pc-bar"[^>]*height="0"/g) || []).length, 2);
  assert.match(html, /Średnia: <b>0<\/b>/);
  assert.ok(!/NaN|Infinity/.test(html));
});

test('the latest ten distinct matches are used and an identical duplicate is counted once', () => {
  const observations = Array.from({ length: 14 }, (_, index) => row(`m${index}`, index + 1, index));
  observations.push({ ...observations[13] });
  observations.reverse();
  const html = render(observations);
  assert.deepEqual(values(html), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(new Set(observationIDs(html)).size, 10);
  assert.match(html, /10 wcześniejszych meczów/);
  assert.match(html, /Średnia: <b>8,5<\/b>/);
});

test('missing history, invalid counts and invalid IDs show a human message without invented bars', () => {
  for (const observations of [undefined, null, [], {}, [row('', 17, 3)], [row(' ', 17, 3)],
    [row(123, 17, 3)], ...[undefined, null, '3', NaN, Infinity, -1, 1.5, 1001].map(value => [row('bad', 17, value)])]) {
    const html = render(observations);
    assert.deepEqual(values(html), []);
    assert.ok(!html.includes('<svg'));
    assert.match(html, /class="pc-unavailable"/);
    assert.ok(!/NaN|Infinity/.test(html));
  }
  assert.deepEqual(values(render([row('upper', 17, 1000)])), [1000]);
  assert.ok(!playerMetricChartHTML(null, { now }).includes('<svg'));
});

test('impossible, ambiguous and future dates suppress the chart, including incomplete mixed histories', () => {
  for (const date of ['bad', '2026-11-18', '2026-11-18T12:00:00', '2026-02-30T12:00:00.000Z',
    '2025-02-29T12:00:00Z', '2026-13-01T12:00:00Z', '2026-11-18T24:00:00Z',
    '2026-11-19T12:00:00.001Z']) {
    const html = render([row('valid', 16, 8), row('bad', 17, 3, { date })]);
    assert.ok(!html.includes('<svg'), date);
    assert.match(html, /nieprawidłowe wartości albo daty/);
  }
  assert.deepEqual(values(render([row('now', 19, 8)])), [8]);
  assert.deepEqual(values(render([row('leap', 1, 8, { date: '2024-02-29T12:00:00Z' })])), [8]);
  assert.deepEqual(values(render([row('offset', 18, 3, { date: '2026-11-18T13:00:00+01:00' })])), [3]);
  assert.ok(!render([row('one', 18, 3)], { now: NaN }).includes('<svg'));
});

test('conflicting duplicate match values or dates suppress the entire chart', () => {
  const first = row('same', 16, 3);
  for (const second of [{ ...first, value: 4 }, { ...first, date: row('same', 17, 3).date }]) {
    const html = render([first, row('other', 18, 8), second]);
    assert.ok(!html.includes('<svg'));
    assert.match(html, /Sprzeczne wyniki tego samego meczu/);
  }
});

test('comparison lines share the scale, include zero, and ignore invalid input', () => {
  const observations = [row('one', 17, 10)];
  const html = render(observations, { line: 29.5 });
  assert.match(html, />30<\/text>/);
  assert.match(html, /class="pc-bar"[^>]*height="43\.3333333333333\d*"/);
  assert.match(html, /class="pc-reference"><line[^>]*y1="28\.1666666666666\d*"/);
  assert.match(render(observations, { line: 0 }), /Linia porównania: <b>0<\/b>/);
  for (const line of [NaN, Infinity, -1, 1000.1, '29.5', '<script>']) {
    assert.ok(!render(observations, { line }).includes('pc-reference'));
  }
});

test('untrusted labels and match IDs are escaped without changing observed values', () => {
  const html = render([row('m"><script>alert(1)</script>', 17, 3)], { label: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img/);
  assert.match(html, /m&quot;&gt;&lt;script&gt;/);
  assert.deepEqual(values(html), [3]);
});
