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
function polandAnalysis(homeTotals = Array(10).fill(4), awayTotals = homeTotals, homeWins = 5, awayWins = 5) {
  const polRoute = 'soccer/pol.1';
  const fixture = { ...event, sport: 'football', route: polRoute, id: `${polRoute}:tsdb-999999`, sourceEventId: 'tsdb-999999', homeId: 'tsdb-1', awayId: 'tsdb-2' };
  const value = analysis(homeTotals, awayTotals, homeWins, awayWins);
  value.sport = 'football'; value.route = polRoute; value.fixtureId = fixture.id;
  for (const [side, id] of [['home', 'tsdb-1'], ['away', 'tsdb-2']]) {
    const rows = value[side].recent.map(row => {
      const sourceEventId = `tsdb-${row.id.slice(route.length + 1)}`;
      return { ...row, route: polRoute, id: `${polRoute}:${sourceEventId}`, sourceEventId };
    });
    value[side] = fromRows(id, rows);
  }
  return { value, fixture };
}

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

test('source line is labelled only for the exact observed two-sided market without changing historical ranking', () => {
  const fetchedAt = new Date(now - 60000).toISOString(), totalLine = 190.5;
  const oddsData = { status: 'available', fixtureId: event.id, sport: event.sport, route, homeId: event.homeId, awayId: event.awayId,
    startTime: event.date, fetchedAt, source: 'Test source', quotes: [{ provider: 'Test provider', providerId: '100', market: 'total_points',
      line: totalLine, scope: 'including_overtime', observedAt: fetchedAt, quotedAt: null,
      outcomes: [{ side: 'over', decimal: 1.9 }, { side: 'under', decimal: 1.95 }] }] };
  const options = { now, totalLine, totalLineOrigin: 'source', oddsData };
  const sourced = build(analysis(), options), manual = build(analysis(), { totalLine });
  assert.equal(sourced.totals.lineOrigin, 'source'); assert.equal(sourced.best.lineOrigin, 'source');
  assert.equal(sourced.best.direction, manual.best.direction);
  assert.deepEqual(sourced.best.support, manual.best.support);
  assert.equal(sourced.totals.referenceAverage, manual.totals.referenceAverage);
  assert.match(matchPicksHTML(analysis(), event, options), /dokładną linię z odczytu źródła/);
  assert.match(matchPicksHTML(analysis(), event, { ...options, compact: true }), /Linia ze źródła: 190,5/);
  for (const changed of [null, { ...oddsData, fetchedAt: new Date(now - 6 * 60000).toISOString() },
    { ...oddsData, quotes: [{ ...oddsData.quotes[0], line: totalLine + 1 }] },
    { ...oddsData, quotes: [{ ...oddsData.quotes[0], outcomes: [{ side: 'over', decimal: 1.9 }] }] }]) {
    const invalidOptions = { ...options, oddsData: changed };
    assert.equal(build(analysis(), invalidOptions).totals.lineOrigin, 'manual');
    assert.doesNotMatch(matchPicksHTML(analysis(), event, invalidOptions), /Porównujesz dokładną linię z odczytu źródła/);
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

test('Ekstraklasa descriptive picks require consistent TheSportsDB fixture, participant and history namespaces', () => {
  const { value, fixture } = polandAnalysis(undefined, undefined, 9, 0), polRoute = fixture.route;
  const valid = build(value, {}, fixture);
  const winner = valid.candidates.find(row => row.kind === 'result');
  assert.equal(valid.status, 'available'); assert.equal(winner.market, '1X');
  assert.deepEqual(winner.support, { home: { hits: 9, sample: 10 }, away: { hits: 10, sample: 10 } });
  assert.equal(valid.probability, undefined); assert.equal(valid.expectedValue, undefined);
  for (const changed of [
    { ...fixture, sourceEventId: '999999' }, { ...fixture, sourceEventId: 'tsdb-888888' },
    { ...fixture, id: `${polRoute}:999999` }, { ...fixture, homeId: '1' }, { ...fixture, awayId: 'espn-2' },
    { ...fixture, route: 'soccer/eng.1', id: 'soccer/eng.1:tsdb-999999' },
  ]) assert.equal(build(value, {}, changed).status, 'unavailable');
  for (const mutate of [
    data => data.home.recent[0].id = `${polRoute}:123456`,
    data => data.home.recent[0].sourceEventId = '123456',
    data => data.away.recent[0].sourceEventId = 'tsdb-888888',
    data => data.away.recent[0].route = 'soccer/eng.1',
    data => data.home.id = '1',
  ]) {
    const changed = structuredClone(value); mutate(changed);
    assert.equal(build(changed, {}, fixture).status, 'unavailable');
  }
});

test('Ekstraklasa uses fixed 2.5 regulation goals and requires both histories and pooled support', () => {
  for (const [goals, direction] of [[4, 'over'], [2, 'under']]) {
    const { value, fixture } = polandAnalysis(Array(10).fill(goals));
    const result = build(value, {}, fixture);
    assert.equal(result.status, 'available'); assert.equal(result.best.kind, 'total');
    assert.equal(result.best.direction, direction); assert.equal(result.best.market, 'total_goals');
    assert.equal(result.best.scope, 'regulation_90'); assert.equal(result.totals.unit, 'gola');
    assert.equal(result.totals.line, 2.5); assert.equal(result.totals.lineOrigin, 'analytical');
    assert.equal(result.totals.referenceAverage, goals); assert.equal(result.best.support.uniqueHits, 20);
    assert.match(result.best.label, /2,5 gola w meczu \(90 minut\)/);
    assert.equal(result.probability, undefined); assert.equal(result.expectedValue, undefined);
  }
  const opposite = polandAnalysis(Array(10).fill(4), Array(10).fill(2));
  const neutral = build(opposite.value, {}, opposite.fixture);
  assert.equal(neutral.status, 'neutral'); assert.equal(neutral.best, null);
  assert.equal(neutral.totals.line, 2.5); assert.equal(neutral.totals.over, 10); assert.equal(neutral.totals.under, 10);
  const belowThreshold = polandAnalysis([...Array(5).fill(4), ...Array(5).fill(2)], [...Array(6).fill(4), ...Array(4).fill(2)]);
  assert.equal(build(belowThreshold.value, {}, belowThreshold.fixture).best, null);
  const threshold = polandAnalysis([...Array(6).fill(4), ...Array(4).fill(2)]);
  assert.equal(build(threshold.value, {}, threshold.fixture).best.direction, 'over');
});

test('Ekstraklasa manual goal lines are bounded and stale or contradictory observations never create picks', () => {
  const { value, fixture } = polandAnalysis();
  for (const [totalLine, direction] of [[0.5, 'over'], [15.5, 'under']]) {
    const result = build(value, { totalLine }, fixture);
    assert.equal(result.totals.line, totalLine); assert.equal(result.totals.lineOrigin, 'manual');
    assert.equal(result.best.direction, direction);
  }
  for (const totalLine of [0, 1, 16.5, '2.5', NaN]) assert.equal(build(value, { totalLine }, fixture).status, 'unavailable');
  const stale = structuredClone(value); stale.cutoff = new Date(now - 16 * 60000).toISOString();
  assert.equal(build(stale, {}, fixture).best, null);
  const conflict = structuredClone(value);
  conflict.away.recent[0] = { ...conflict.home.recent[0], scoreFor: 4, scoreAgainst: 0 };
  conflict.away = fromRows(fixture.awayId, conflict.away.recent);
  assert.equal(build(conflict, {}, fixture).status, 'unavailable');
  assert.equal(build(value, {}, { ...fixture, state: 'post' }).status, 'closed');
  const detail = matchPicksHTML(value, fixture, { now }), compact = matchPicksHTML(value, fixture, { now, compact: true });
  assert.match(detail, /Wynik czy suma goli/); assert.match(detail, /Twoja linia sumy goli/);
  assert.match(detail, /Stała linia analityczna 2,5/); assert.match(detail, /90 minut, bez dogrywki i karnych/);
  assert.match(compact, /2,5 gola • 90 minut/); assert.match(detail, /Kurs niedostępny/);
  assert.doesNotMatch(detail, /Kurs \d|\d%|punktów|wynik końcowy NBA/);
});

test('unverified settlement sources in other football and NHL leagues do not acquire goal totals', () => {
  for (const [sport, alternativeRoute] of [['football', 'soccer/eng.1'], ['nhl', 'hockey/nhl']]) {
    const fixture = { ...event, sport, route: alternativeRoute, id: `${alternativeRoute}:999999` };
    const value = analysis(Array(10).fill(4));
    value.sport = sport; value.route = alternativeRoute; value.fixtureId = fixture.id;
    for (const side of ['home', 'away']) for (const row of value[side].recent) {
      row.id = `${alternativeRoute}:${row.id.slice(route.length + 1)}`; row.route = alternativeRoute;
    }
    const result = build(value, { totalLine: 2.5 }, fixture);
    assert.equal(result.totals, null); assert.equal(result.best, null);
  }
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
