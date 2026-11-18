import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchPicks, matchPicksHTML } from '../public/match-picks.js';

const DAY = 86400000, now = Date.parse('2026-11-18T12:00:00.000Z');
const route = 'basketball/nba';
const event = { id: `${route}:999999`, sport: 'nba', route, homeId: '1', awayId: '2', home: 'Test A', away: 'Test B', state: 'pre', date: '2026-11-19T00:00:00.000Z' };
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function form(id, totals, wins = 5) {
  const recent = totals.map((total, index) => ({ id: `${route}:${id === '1' ? 100000 : 200000}${index}`,
    date: new Date(now - (index + 3) * DAY - 3600000).toISOString(), route, opponent: `Opponent ${index}`, isHome: index % 2 === 0,
    scoreFor: total / 2 + (index < wins ? 1 : -1), scoreAgainst: total / 2 - (index < wins ? 1 : -1) }));
  return fromRows(id, recent);
}
function fromRows(id, recent) {
  const wins = recent.filter(row => row.scoreFor > row.scoreAgainst).length, losses = recent.length - wins;
  const averageFor = average(recent.map(row => row.scoreFor)), averageAgainst = average(recent.map(row => row.scoreAgainst));
  const split = side => { const rows = recent.filter(row => row.isHome === (side === 'home')); const win = rows.filter(row => row.scoreFor > row.scoreAgainst).length;
    return { sample: rows.length, wins: win, draws: 0, losses: rows.length - win }; };
  return { id, sample: recent.length, wins, draws: 0, losses, averageFor, averageAgainst,
    averageMargin: averageFor - averageAgainst, recent, lastMatchAt: recent[0].date,
    restDays: Math.floor((Date.parse('2026-11-18T11:59:00.000Z') - Date.parse(recent[0].date)) / DAY),
    splits: { home: split('home'), away: split('away') } };
}
function analysis(homeTotals = [...Array(9).fill(200), 400], awayTotals = homeTotals, homeWins = 5, awayWins = 5) {
  const home = form('1', homeTotals, homeWins), away = form('2', awayTotals, awayWins);
  return { status: 'available', sport: 'nba', route, fixtureId: event.id, cutoff: '2026-11-18T11:59:00.000Z', home, away,
    comparison: { sampleComplete: home.sample === 10 && away.sample === 10, formWinsDifference: home.wins - away.wins, averageMarginDifference: home.averageMargin - away.averageMargin } };
}
const build = (data = analysis(), options = {}, fixture = event) => buildMatchPicks(data, fixture, { now, ...options });

test('automatic total line is anchored to mean once and actual high-tail history supports under', () => {
  const value = build();
  assert.equal(value.totals.referenceAverage, 220);
  assert.equal(value.totals.line, 220.5);
  assert.equal(value.totals.lineOrigin, 'analytical');
  assert.equal(value.best.kind, 'total'); assert.equal(value.best.direction, 'under');
  assert.equal(value.best.support.home.hits, 9); assert.equal(value.best.support.away.hits, 9);
  assert.equal(value.totals.uniqueSample, 20); assert.equal(value.best.support.uniqueHits, 18);
  assert.ok(!JSON.stringify(value).includes('probability'));
  assert.equal(value.expectedValue, undefined);
});

test('low-tail history can support over but balanced histories do not force a direction', () => {
  const over = build(analysis([...Array(9).fill(240), 100]));
  assert.equal(over.totals.line, 226.5); assert.equal(over.best.direction, 'over');
  const balanced = build(analysis(Array.from({ length: 10 }, (_, index) => index % 2 ? 230 : 210)));
  assert.equal(balanced.status, 'neutral'); assert.equal(balanced.best, null);
  assert.equal(balanced.totals.home.over, 5); assert.equal(balanced.totals.home.under, 5);
  assert.equal(balanced.totals.line, 220.5);
});

test('result and total rank by weaker-side historical support then the balanced pair', () => {
  const winnerBest = build(analysis(undefined, undefined, 9, 0));
  assert.equal(winnerBest.candidates.length, 2); assert.equal(winnerBest.best.kind, 'result');
  assert.deepEqual(winnerBest.best.support, { home: { hits: 9, sample: 10 }, away: { hits: 10, sample: 10 } });
  const totalsBest = build(analysis(undefined, undefined, 8, 2));
  assert.equal(totalsBest.candidates.length, 2); assert.equal(totalsBest.best.kind, 'total');
});

test('manual half-point line changes counts without pretending to be a bookmaker quote', () => {
  const result = build(analysis(), { totalLine: 190.5 });
  assert.equal(result.totals.lineOrigin, 'manual'); assert.equal(result.totals.line, 190.5);
  assert.equal(result.best.direction, 'over'); assert.equal(result.totals.home.over, 10);
  assert.equal(result.totals.referenceAverage, 220);
  for (const totalLine of [0, 1, 190, 600.5, NaN, '220.5']) {
    const rejected = build(analysis(), { totalLine });
    assert.equal(rejected.best, null); assert.equal(rejected.status, 'unavailable');
  }
});

test('shared head-to-head games count once and conflicting orientation fails closed', () => {
  const data = analysis();
  for (const index of [0, 1]) data.away.recent[index] = { ...data.home.recent[index], scoreFor: data.home.recent[index].scoreAgainst, scoreAgainst: data.home.recent[index].scoreFor };
  data.away = fromRows('2', data.away.recent);
  const value = build(data);
  assert.equal(value.totals.uniqueSample, 18);
  assert.equal(value.totals.uniqueObservations.filter(row => row.participants.length === 2).length, 2);
  const conflict = structuredClone(data); conflict.away.recent[0].scoreFor++; conflict.away.recent[0].scoreAgainst--;
  conflict.away = fromRows('2', conflict.away.recent);
  assert.equal(build(conflict).status, 'unavailable');
});

test('future, stale, duplicate, target and mismatched source rows never create active picks', () => {
  for (const mutate of [
    data => data.cutoff = '2026-11-18T12:01:00.000Z', data => data.cutoff = '2026-11-18T11:44:00.000Z',
    data => data.home.id = '9', data => data.route = 'hockey/nhl', data => data.fixtureId = `${route}:888888`,
    data => data.home.recent[0].date = data.cutoff, data => data.home.recent[0].id = event.id,
    data => data.home.recent[1].id = data.home.recent[0].id, data => data.away.recent[0].route = 'hockey/nhl',
    data => data.home.recent[0].scoreFor = NaN, data => data.home.recent[0].scoreFor = data.home.recent[0].scoreAgainst,
    data => data.home.wins = 10, data => data.home.averageFor += 40, data => data.home.lastMatchAt = '2026-10-01T00:00:00.000Z',
  ]) { const data = analysis(); mutate(data); assert.equal(build(data).best, null); }
  for (const fixture of [{ ...event, state: 'post' }, { ...event, state: 'in' }, { ...event, date: new Date(now).toISOString() }]) assert.equal(build(analysis(), {}, fixture).status, 'closed');
  assert.equal(build(analysis(), {}, { ...event, date: '2026-11-21T00:00:00.000Z' }).best, null);
});

test('eight available matches remain real and unequal windows are balanced without fake observations', () => {
  const data = analysis(); data.away = fromRows('2', data.away.recent.slice(0, 8));
  const value = build(data);
  assert.equal(value.totals.home.sample, 8); assert.equal(value.totals.away.sample, 8);
  assert.equal(value.totals.uniqueSample, 16);
  const missing = analysis(); missing.home = fromRows('1', missing.home.recent.slice(0, 7));
  assert.equal(build(missing).status, 'unavailable');
});

test('rendering highlights the chosen historical screen, labels analytical lines and escapes names', () => {
  const fixture = { ...event, home: '<img src=x onerror=alert(1)>' };
  const detail = matchPicksHTML(analysis(), fixture, { now });
  const compact = matchPicksHTML(analysis(), fixture, { now, compact: true });
  for (const html of [detail, compact]) {
    assert.match(html, /Najmocniejszy sygnał z historii/); assert.match(html, /220,5/);
    assert.ok(!html.includes('<img')); assert.match(html, /&lt;img/); assert.ok(!html.includes('%'));
  }
  assert.match(detail, /data-match-line/); assert.match(detail, /name="totalLine"/);
  assert.match(detail, /nie jest linią pobraną z oferty/); assert.match(detail, /Wynik czy suma punktów/);
  assert.match(matchPicksHTML(analysis(), { ...event, state: 'post' }, { now }), /betting-closed/);
});
