import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchPicks } from '../public/match-picks.js';
import { matchPickQuote } from '../public/pick-odds.js';

const DAY = 86400000, now = Date.parse('2026-11-18T12:00:00.000Z');
const cutoff = '2026-11-18T11:59:00.000Z';
const routes = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'uefa.champions', 'uefa.europa', 'eng.2', 'ned.1', 'por.1'].map(league => `soccer/${league}`);
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function form(id, route, scores) {
  const recent = scores.map(([scoreFor, scoreAgainst], index) => ({
    id: `${route}:${id === '1' ? 100000 : 200000}${index}`, route,
    date: new Date(now - (index + 3) * DAY - 3600000).toISOString(),
    opponent: `Opponent ${index}`, isHome: index % 2 === 0,
    scoreFor, scoreAgainst, scoreScope: 'regulation_90', regulationOnly: true,
  }));
  const counts = rows => ({ sample: rows.length,
    wins: rows.filter(row => row.scoreFor > row.scoreAgainst).length,
    draws: rows.filter(row => row.scoreFor === row.scoreAgainst).length,
    losses: rows.filter(row => row.scoreFor < row.scoreAgainst).length });
  const averageFor = average(recent.map(row => row.scoreFor)), averageAgainst = average(recent.map(row => row.scoreAgainst));
  return { id, ...counts(recent), averageFor, averageAgainst, averageMargin: averageFor - averageAgainst,
    recent, lastMatchAt: recent[0].date, restDays: Math.floor((Date.parse(cutoff) - Date.parse(recent[0].date)) / DAY),
    splits: { home: counts(recent.filter(row => row.isHome)), away: counts(recent.filter(row => !row.isHome)) } };
}

function fixture(route = routes[0], homeScores = [...Array(8).fill([3, 1]), [2, 2], [0, 0]], awayScores = [...Array(8).fill([1, 3]), [2, 2], [0, 0]]) {
  const event = { id: `${route}:999999`, sport: 'football', route, homeId: '1', awayId: '2',
    home: 'Home FC', away: 'Away FC', state: 'pre', date: '2026-11-19T00:00:00.000Z' };
  const home = form('1', route, homeScores), away = form('2', route, awayScores);
  const analysis = { status: 'available', sport: event.sport, route, fixtureId: event.id, cutoff,
    resultScope: 'regulation_90', home, away,
    comparison: { sampleComplete: true, formWinsDifference: home.wins - away.wins, averageMarginDifference: home.averageMargin - away.averageMargin } };
  return { event, analysis };
}
const build = ({ event, analysis } = fixture(), options = {}) => buildMatchPicks(analysis, event, { now, ...options });
const winnerPick = { kind: 'result', market: 'winner', side: 'home', scope: 'regulation_90' };
const totalPick = { kind: 'total', market: 'total_goals', direction: 'over', line: 2.5, scope: 'regulation_90' };
function quote(market = 'winner', overrides = {}) {
  return { provider: 'DraftKings', providerId: '100', market, scope: 'regulation_90',
    line: market === 'winner' ? null : 2.5, observedAt: cutoff, quotedAt: null, freshness: 'unverified',
    readOnly: true, usableForComparison: false,
    outcomes: market === 'winner' ? [{ side: 'home', decimal: 1.85 }, { side: 'draw', decimal: 3.7 }, { side: 'away', decimal: 4.4 }]
      : [{ side: 'over', decimal: 1.9 }, { side: 'under', decimal: 1.95 }], ...overrides };
}
function odds(event, quotes = [quote(), quote('total_goals')]) {
  return { status: 'available', fixtureId: event.id, sport: event.sport, route: event.route,
    homeId: event.homeId, awayId: event.awayId, startTime: event.date, fetchedAt: cutoff, source: 'ESPN', quotes };
}
const match = (event, data, pick = totalPick) => matchPickQuote(data, event, pick, { now });

test('verified European football yields 90-minute goals and real three-way winners', () => {
  for (const route of routes) {
    const context = fixture(route), result = build(context);
    assert.equal(result.status, 'available', route);
    assert.equal(result.totals.market, 'total_goals');
    assert.equal(result.totals.scope, 'regulation_90');
    assert.equal(result.totals.line, 2.5); assert.equal(result.totals.lineOrigin, 'analytical');
    assert.equal(result.totals.home.under, 1); assert.equal(result.totals.home.over, 9);
    assert.equal(result.totals.home.observations.find(row => row.scoreFor === 0 && row.scoreAgainst === 0).total, 0);
    const winner = result.candidates.find(pick => pick.market === 'winner');
    assert.ok(winner, route); assert.equal(winner.side, 'home');
    assert.deepEqual(winner.support, { home: { hits: 8, sample: 10 }, away: { hits: 8, sample: 10 } });
    assert.equal(winner.scope, 'regulation_90');
    assert.equal(result.candidates.find(pick => pick.market === '1X').support.home.hits, 10);
    assert.equal(result.probability, undefined); assert.equal(winner.probability, undefined);
  }
});

test('away winners count actual away wins and home losses, while draw-heavy forms do not create wins', () => {
  const awayFavoured = fixture(routes[0], [...Array(8).fill([1, 3]), [2, 2], [0, 0]], [...Array(8).fill([3, 1]), [2, 2], [0, 0]]);
  const winner = build(awayFavoured).candidates.find(pick => pick.market === 'winner');
  assert.equal(winner.side, 'away');
  assert.deepEqual(winner.support, { home: { hits: 8, sample: 10 }, away: { hits: 8, sample: 10 } });
  const draws = fixture(routes[0], [...Array(5).fill([3, 1]), ...Array(5).fill([2, 2])], [...Array(5).fill([1, 3]), ...Array(5).fill([2, 2])]);
  assert.ok(build(draws).candidates.some(pick => pick.market === '1X'));
  assert.ok(!build(draws).candidates.some(pick => pick.market === 'winner'));
});

test('unknown global or row settlement scope blocks European picks', () => {
  for (const scope of [undefined, 'unknown', 'including_overtime', 'including_overtime_shootout']) {
    const context = fixture(); context.analysis.resultScope = scope;
    assert.equal(build(context).status, 'unavailable'); assert.equal(build(context).totals, null);
    const rows = fixture(); rows.analysis.home.recent[0].scoreScope = scope;
    assert.equal(build(rows).status, 'unavailable');
  }
  const context = fixture(); context.analysis.away.recent[0].regulationOnly = false;
  assert.equal(build(context).status, 'unavailable');
});

test('football prices match all three winner sides and both exact goal-total directions', () => {
  const { event } = fixture(), data = odds(event);
  for (const [side, decimal] of [['home', 1.85], ['draw', 3.7], ['away', 4.4]]) {
    const result = match(event, data, { ...winnerPick, side });
    assert.equal(result.status, 'matched'); assert.equal(result.decimal, decimal);
    assert.equal(result.scope, 'regulation_90'); assert.equal(result.usableForComparison, false);
  }
  assert.equal(match(event, data).decimal, 1.9);
  assert.equal(match(event, data, { ...totalPick, direction: 'under' }).decimal, 1.95);
  assert.equal(match(event, data, { ...winnerPick, market: '1X' }).status, 'unavailable');
});

test('goal prices require the same market, numerical line, direction and 90-minute scope', () => {
  const { event } = fixture(), data = odds(event);
  for (const changed of [{ market: 'total_points' }, { line: 3.5 }, { line: '2.5' }, { direction: 'home' }, { scope: 'unknown' }, { scope: 'including_overtime' }]) {
    assert.equal(match(event, data, { ...totalPick, ...changed }).status, 'unavailable');
  }
  for (const changed of [{ market: 'total_points' }, { line: 1.5 }, { scope: 'unknown' }, { outcomes: [{ side: 'over', decimal: 1.9 }] }]) {
    assert.equal(match(event, odds(event, [quote('total_goals', changed)])).status, 'unavailable');
  }
  assert.equal(match(event, odds(event, [quote('winner', { outcomes: [{ side: 'home', decimal: 1.85 }, { side: 'away', decimal: 4.4 }] })]), winnerPick).status, 'unavailable');
});

test('football prices fail closed for another fixture, teams, date or stale observation', () => {
  const { event } = fixture(), data = odds(event);
  for (const changed of [{ fixtureId: 'soccer/eng.1:999998' }, { route: 'soccer/esp.1' }, { homeId: '2', awayId: '1' },
    { startTime: '2026-11-19T01:00:00.000Z' }, { fetchedAt: '2026-11-18T11:54:00.000Z' }]) {
    assert.equal(match(event, { ...data, ...changed }).status, 'unavailable');
  }
  for (const observedAt of ['2026-11-18T11:54:00.000Z', '2026-11-18T12:02:00.000Z']) {
    assert.equal(match(event, odds(event, [quote('total_goals', { observedAt })])).status, 'unavailable');
  }
  assert.equal(match({ ...event, state: 'post' }, data).status, 'closed');
});

test('daily price filtering retains the real winner and goal total without borrowing a double-chance price', () => {
  const context = fixture(), data = odds(context.event);
  const result = build(context, { oddsData: data, screening: { minOdds: 1.5, band: 'all' } });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.candidates.map(pick => pick.market).sort(), ['total_goals', 'winner']);
  for (const pick of result.candidates) assert.equal(match(context.event, data, pick).status, 'matched');
  const noPrices = build(context, { oddsData: odds(context.event, []), screening: { minOdds: 1.5, band: 'all' } });
  assert.equal(noPrices.status, 'neutral'); assert.deepEqual(noPrices.candidates, []);
});
