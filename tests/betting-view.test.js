import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBetting, bettingHTML, bettingDetailHTML } from '../public/betting-view.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const event = { id: 'basketball/nba:12345', state: 'pre', date: '2026-11-19T00:00:00Z', sport: 'nba', route: 'basketball/nba', homeId: '1', awayId: '2', home: 'Test A', away: 'Test B' };
function form(id, wins, averageFor, averageAgainst) {
  const recent = Array.from({ length: 10 }, (_, i) => ({ date: new Date(now - (i + 3) * 86400000 - 3600000).toISOString() }));
  return { id, sample: 10, wins, draws: 0, losses: 10 - wins, averageFor, averageAgainst,
    averageMargin: averageFor - averageAgainst, recent, lastMatchAt: recent[0].date, restDays: 3,
    splits: { home: { sample: 5, wins: 4, draws: 0, losses: 1 }, away: { sample: 5, wins: 3, draws: 0, losses: 2 } } };
}
function analysis() {
  return { status: 'available', sport: 'nba', route: event.route, cutoff: '2026-11-18T11:59:00Z', fixtureId: event.id,
    home: form('1', 8, 110, 100), away: form('2', 4, 99, 106),
    comparison: { sampleComplete: true, formWinsDifference: 4, averageMarginDifference: 17 } };
}
const assess = (data = analysis(), fixture = event) => assessBetting(data, fixture, { now });

test('strong descriptive form may suggest a market to check but never unlocks a bet or probability', () => {
  const result = assess();
  assert.equal(result.status, 'watch');
  assert.equal(result.candidate.label, 'Test A — zwycięstwo (z dogrywką)');
  assert.equal(result.verdict, 'Odpuść zakład — brak potwierdzonej przewagi');
  assert.ok(result.limitations.some(line => line.includes('aktualnego kursu')));
  assert.equal(result.probability, undefined);
  assert.equal(result.probabilities, undefined);
  assert.equal(result.expectedValue, undefined);
  assert.equal(result.stake, undefined);
});

test('started, live and archived matches never get hindsight markets', () => {
  for (const fixture of [{ ...event, state: 'post' }, { ...event, state: 'in' }, { ...event, date: new Date(now).toISOString() }, { ...event, date: '2026-11-17T00:00:00Z' }]) {
    assert.equal(assess(analysis(), fixture).status, 'closed');
    assert.equal(assess(analysis(), fixture).candidate, null);
  }
  assert.equal(assess(analysis(), { ...event, date: '2026-11-21T00:00:00Z' }).candidate, null);
});

test('future cutoffs, future history, wrong participants and cross-league data fail closed', () => {
  for (const mutate of [data => data.cutoff = '2026-11-18T13:00:00Z', data => data.route = 'basketball/other', data => data.sport = 'nhl',
    data => data.home.id = '9', data => data.away.id = '1', data => data.fixtureId = 'basketball/nba:99999',
    data => data.home.lastMatchAt = '2026-11-18T12:01:00Z', data => data.home.recent[9].date = '2026-11-18T11:59:00Z']) {
    const data = analysis(); mutate(data);
    assert.equal(assess(data).candidate, null);
  }
  assert.equal(assessBetting(analysis(), event, { now: NaN }).status, 'unavailable');
});

test('small, inconsistent, stale or directionally conflicting samples do not create candidates', () => {
  for (const mutate of [data => data.home.sample = 9, data => data.home.wins = 11, data => data.away.averageMargin = NaN,
    data => data.home.recent.pop(), data => data.comparison.formWinsDifference = -4,
    data => data.home.averageAgainst = 120, data => data.home.splits.home.sample = 2,
    data => data.away.splits.away = { sample: 2, wins: 1, draws: 0, losses: 1 },
    data => data.home.splits.home = { sample: 5, wins: 1, draws: 0, losses: 4 },
    data => data.home.restDays = 1, data => data.home.restDays = null,
    data => data.cutoff = '2026-11-18T11:44:00Z',
    data => { data.home.lastMatchAt = '2026-10-01T00:00:00Z'; data.home.recent.forEach((row, i) => row.date = new Date(Date.parse(data.home.lastMatchAt) - i * 86400000).toISOString()); }]) {
    const data = analysis(); mutate(data);
    assert.equal(assess(data).candidate, null);
  }
  const balanced = analysis(); balanced.home = form('1', 6, 110, 100); balanced.comparison.formWinsDifference = 2;
  assert.equal(assess(balanced).candidate, null);
});

test('away football form maps to X2 over 90 minutes and NHL specifies the settlement scope', () => {
  const data = analysis();
  data.sport = 'football'; data.route = 'soccer/eng.1'; data.fixtureId = 'soccer/eng.1:12345';
  data.home = form('1', 3, 1, 2); data.away = form('2', 8, 3, 1);
  data.comparison.formWinsDifference = -5; data.comparison.averageMarginDifference = -3;
  const football = { ...event, id: data.fixtureId, sport: data.sport, route: data.route };
  assert.equal(assess(data, football).candidate.label, 'Test B nie przegra — X2 (90 minut)');
  const nhl = analysis(); nhl.sport = 'nhl'; nhl.route = 'hockey/nhl'; nhl.fixtureId = 'hockey/nhl:12345';
  assert.match(assess(nhl, { ...event, id: nhl.fixtureId, sport: nhl.sport, route: nhl.route }).candidate.label, /z dogrywką i karnymi/);
});

test('tennis and missing histories explain why no market is selected', () => {
  const data = analysis(); data.sport = 'tennis'; data.route = 'tennis/atp'; data.fixtureId = 'tennis/atp:12345';
  const tennis = assess(data, { ...event, id: data.fixtureId, sport: 'tennis', route: data.route });
  assert.equal(tennis.candidate, null); assert.match(tennis.reasons[0], /nawierzchni/);
  assert.equal(assess(null).status, 'unavailable');
  assert.equal(assess({ ...analysis(), status: 'partial' }).candidate, null);
});

test('card and detail display the same verdict and escape participant names', () => {
  const fixture = { ...event, home: '<img src=x onerror=alert(1)>' };
  const card = bettingHTML(analysis(), fixture, { now });
  const detail = bettingDetailHTML(analysis(), fixture, { now });
  for (const html of [card, detail]) {
    assert.match(html, /Co warto obstawić/);
    assert.match(html, /Odpuść zakład — brak potwierdzonej przewagi/);
    assert.match(html, /Rynek do sprawdzenia/);
    assert.ok(!html.includes('<img'));
    assert.match(html, /&lt;img/);
    assert.ok(!html.includes('%'));
  }
  assert.match(detail, /bez potwierdzonej skuteczności/);
});
