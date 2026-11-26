import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFootballAnalysis } from '../public/football-analysis.js';

const now = Date.parse('2026-11-25T12:00:00.000Z'), DAY = 86400000, route = 'soccer/eng.2';
function form(id, scores) {
  const recent = scores.map(([scoreFor, scoreAgainst], index) => ({ id: `${route}:${Number(id) * 100000 + index}`, route,
    date: new Date(now - (index + 3) * DAY).toISOString(), scoreFor, scoreAgainst, opponent: `Rival ${index}`, isHome: index % 2 === 0,
    scoreScope: 'regulation_90', regulationOnly: true }));
  const averageFor = recent.reduce((sum, row) => sum + row.scoreFor, 0) / recent.length;
  const averageAgainst = recent.reduce((sum, row) => sum + row.scoreAgainst, 0) / recent.length;
  return { id, sample: recent.length, wins: recent.filter(r => r.scoreFor > r.scoreAgainst).length,
    draws: recent.filter(r => r.scoreFor === r.scoreAgainst).length, losses: recent.filter(r => r.scoreFor < r.scoreAgainst).length,
    averageFor, averageAgainst, averageMargin: averageFor - averageAgainst, lastMatchAt: recent[0].date, recent };
}
function fixture(home = [[2, 2], [4, 5], [1, 1], [0, 0], [1, 4], [1, 2], [2, 2], [4, 0], [1, 1], [1, 3]],
  away = [[0, 1], [2, 1], [3, 0], [3, 1], [0, 1], [2, 1], [3, 0], [1, 0], [2, 2], [2, 1]]) {
  const event = { sport: 'football', route, id: `${route}:999999`, homeId: '1', awayId: '2', home: 'Burnley', away: 'Birmingham City', state: 'pre', date: '2026-11-25T19:45:00.000Z' };
  const analysis = { sport: 'football', route, fixtureId: event.id, status: 'available', resultScope: 'regulation_90', cutoff: '2026-11-25T11:59:00.000Z', home: form('1', home), away: form('2', away) };
  return { event, analysis };
}
const build = (context = fixture(), options = {}) => buildFootballAnalysis(context.analysis, context.event, { now, ...options });
function odds(event, line = 3.5) {
  return { status: 'available', fixtureId: event.id, sport: 'football', route, homeId: event.homeId, awayId: event.awayId,
    startTime: event.date, fetchedAt: '2026-11-25T11:59:00.000Z', quotes: [{ market: 'total_goals', scope: 'regulation_90', line,
      provider: 'Test provider', observedAt: '2026-11-25T11:59:00.000Z', quotedAt: null, freshness: 'unverified',
      outcomes: [{ side: 'over', line, decimal: 1.9 }, { side: 'under', line, decimal: 1.85 }] },
    { market: 'winner', scope: 'regulation_90', line: null, provider: 'Test provider', observedAt: '2026-11-25T11:59:00.000Z', quotedAt: null, freshness: 'unverified',
      outcomes: [{ side: 'home', decimal: 2.95 }, { side: 'draw', decimal: 3.6 }, { side: 'away', decimal: 2.35 }] }] };
}

test('football analysis retains an unpriced X2 direction with reasons and real counterevidence', () => {
  const result = build();
  assert.equal(result.status, 'available'); assert.equal(result.best.market, 'X2'); assert.equal(result.best.side, 'away');
  assert.equal(result.best.eligible, true); assert.equal(result.best.quote.status, 'unavailable');
  assert.deepEqual(result.best.support, { home: { hits: 9, sample: 10 }, away: { hits: 8, sample: 10 } });
  assert.ok(result.best.reasons.length >= 3); assert.ok(result.best.counterevidence.some(text => text.includes('2/10')));
  const context = fixture(), priced = build(context, { oddsData: odds(context.event), screening: { minOdds: 100, band: 'higher' } });
  assert.equal(priced.best.market, 'X2'); assert.equal(priced.best.quote.status, 'unavailable');
  assert.equal(priced.candidates.find(c => c.market === 'winner' && c.side === 'away').quote.decimal, 2.35);
  assert.equal(result.best.quote.decimal, null); assert.equal(result.line, 2.5); assert.equal(result.lineOrigin, 'analytical');
  const winner = result.candidates.find(c => c.market === 'winner' && c.side === 'away');
  assert.deepEqual(winner.support, { home: { hits: 4, sample: 10 }, away: { hits: 7, sample: 10 } });
  assert.equal(winner.eligible, false);
  assert.ok(!/probability|expectedValue|modelProbability/.test(JSON.stringify(result)));
});

test('totals expose conflicting recent means and do not manufacture a stronger line', () => {
  const result = build(), over = result.candidates.find(c => c.market === 'total_goals' && c.direction === 'over');
  assert.equal(result.teams.home.overall.over, 7); assert.equal(result.teams.away.overall.over, 7);
  assert.equal(result.teams.away.last5.averageTotal, 2.4);
  assert.equal(over.line, 2.5); assert.equal(over.signal, 'mixed'); assert.equal(over.eligible, false);
  assert.ok(over.counterevidence.some(text => text.includes('średnia')));
  assert.equal(new Set(result.candidates.filter(c => c.kind === 'total').map(c => c.line)).size, 1);
  const source = fixture(), resultSource = build(source, { oddsData: odds(source.event) });
  assert.equal(resultSource.line, 3.5); assert.equal(resultSource.lineOrigin, 'source');
  assert.equal(resultSource.candidates.find(c => c.kind === 'total' && c.direction === 'under').quote.decimal, 1.85);
  const wrong = odds(source.event); wrong.fixtureId = `${route}:888888`;
  assert.equal(build(source, { oddsData: wrong }).line, 2.5);
  const manual = build(source, { totalLine: 4.5, totalLineOrigin: 'source', oddsData: odds(source.event) });
  assert.equal(manual.line, 4.5); assert.equal(manual.lineOrigin, 'manual');
  assert.equal(manual.candidates.find(c => c.kind === 'total').quote.status, 'unavailable');
});

test('metrics preserve 0:0, derive chronological latest5 and real home/away subsets', () => {
  const context = fixture(); context.analysis.home.recent.reverse();
  const result = build(context), home = result.teams.home;
  assert.equal(home.recent[0].date, '2026-11-22T12:00:00.000Z');
  assert.equal(home.overall.cleanSheets, 2); assert.equal(home.overall.failedToScore, 1);
  assert.equal(home.overall.btts, 8); assert.equal(home.overall.averageFor, 1.7);
  assert.equal(home.last5.sample, 5); assert.equal(home.last5.averageTotal, 4);
  assert.equal(home.venue.sample, 5); assert.equal(home.venue.reliable, true); assert.equal(home.venue.label, 'u siebie');
  assert.equal(result.teams.away.venue.label, 'na wyjeździe');
  const btts = result.candidates.filter(c => c.market === 'btts_90');
  assert.equal(btts.length, 2); assert.ok(btts.every(c => c.quote.status === 'unavailable' && c.quote.decimal === null));
});

test('draws never become wins and opposite venue evidence prevents the main direction', () => {
  const drawOnly = build(fixture(Array(10).fill([0, 0]), Array(10).fill([0, 0])));
  assert.ok(drawOnly.candidates.filter(c => c.market === 'winner' && c.side !== 'draw').every(c => c.support.home.hits === 0 && c.eligible === false));
  const original = fixture(), result = build(original);
  assert.equal(result.best.market, 'X2');
  original.analysis.away.recent.forEach((row, index) => row.isHome = [1, 4].includes(index));
  // The actual away subset is now rich in wins; small venue subsets are
  // disclosed rather than using the provider's aggregate split as evidence.
  const derived = build(original);
  assert.equal(derived.teams.away.venue.sample, 8); assert.equal(derived.teams.away.venue.losses, 1);
  const flipped = fixture([[2, 0], [2, 0], [2, 0], ...Array(7).fill([0, 2])], [[0, 2], [0, 2], [0, 2], ...Array(7).fill([2, 0])]);
  flipped.analysis.home.recent.forEach((row, index) => row.isHome = index < 3);
  flipped.analysis.away.recent.forEach((row, index) => row.isHome = index >= 3);
  assert.ok(build(flipped).candidates.filter(c => c.market === 'X2' || c.market === 'winner' && c.side === 'away').every(c => c.eligible === false));
});

test('small samples and stale histories retain factual metrics without a recommended selection', () => {
  const short = build(fixture(Array(4).fill([3, 1]), Array(6).fill([1, 3])));
  assert.equal(short.status, 'limited'); assert.equal(short.best, null); assert.equal(short.teams.home.sample, 4);
  assert.ok(short.candidates.every(c => c.eligible === false));
  const stale = fixture();
  for (const side of ['home', 'away']) {
    stale.analysis[side].recent.forEach(row => row.date = new Date(Date.parse(row.date) - 31 * DAY).toISOString());
    stale.analysis[side].lastMatchAt = stale.analysis[side].recent[0].date;
  }
  const result = build(stale); assert.equal(result.status, 'limited'); assert.equal(result.best, null); assert.equal(result.coverage.stale, true);
  const span = fixture(); for (const side of ['home', 'away']) span.analysis[side].recent.at(-1).date = '2026-01-01T12:00:00.000Z';
  assert.ok(build(span).notes.some(note => note.includes('120 dni')));
});

test('wrong scope, fixture identity, future observations, bad counts and duplicate results fail closed', () => {
  for (const mutate of [c => c.analysis.resultScope = 'unknown', c => c.analysis.fixtureId = `${route}:888888`,
    c => c.analysis.home.recent[0].scoreScope = 'including_overtime', c => c.analysis.home.recent[0].regulationOnly = false,
    c => c.analysis.home.recent[0].date = c.analysis.cutoff, c => c.analysis.home.recent[0].route = 'soccer/eng.1',
    c => c.analysis.home.wins++, c => c.analysis.home.averageFor++, c => c.analysis.home.recent[1].id = c.analysis.home.recent[0].id,
    c => c.analysis.cutoff = '2026-11-25T12:01:00.000Z', c => c.analysis.cutoff = '2026-11-25T11:00:00.000Z',
    c => c.event.homeId = c.event.awayId]) {
    const context = fixture(); mutate(context); const result = build(context);
    assert.equal(result.status, 'unavailable'); assert.equal(result.best, null); assert.equal(result.teams, null);
  }
  assert.equal(build(fixture(), { totalLine: 3 }).status, 'unavailable');
  const live = fixture(); live.event.state = 'in'; assert.equal(build(live).status, 'closed');
});

test('a duplicated head-to-head must agree in date, mirrored score and opposite home/away roles', () => {
  const bad = fixture(); bad.analysis.away.recent[0].id = bad.analysis.home.recent[0].id;
  assert.equal(build(bad).status, 'unavailable');
  const valid = fixture(Array(10).fill([3, 1]), Array(10).fill([1, 3]));
  valid.analysis.away.recent[0].id = valid.analysis.home.recent[0].id;
  valid.analysis.away.recent[0].isHome = !valid.analysis.home.recent[0].isHome;
  assert.equal(build(valid).status, 'available');
  valid.analysis.away.recent[0].isHome = valid.analysis.home.recent[0].isHome;
  assert.equal(build(valid).status, 'unavailable');
});

test('short verified histories can name a form favourite without unlocking the strict market recommendation', () => {
  const context = fixture(Array(4).fill([3, 1]), Array(6).fill([1, 3]));
  const result = build(context), lean = result.winnerLean;
  assert.equal(result.status, 'limited'); assert.equal(result.best, null);
  assert.ok(result.candidates.every(candidate => candidate.eligible === false));
  assert.equal(lean.status, 'lean'); assert.equal(lean.name, 'Burnley'); assert.equal(lean.side, 'home');
  assert.equal(lean.market, 'winner'); assert.equal(lean.scope, 'regulation_90'); assert.equal(lean.shortSample, true);
  assert.deepEqual(lean.samples, { home: 4, away: 6 });
  assert.ok(lean.reasons.some(reason => reason.includes('3 wobec 0')));
  assert.ok(lean.counterevidence.some(reason => reason.includes('Krótka próba: 4 i 6')));
  assert.deepEqual(lean.support, { home: { hits: 4, sample: 4 }, away: { hits: 6, sample: 6 } });
  assert.equal(lean.quote.status, 'unavailable');
  assert.ok(!/probability|expectedValue|confidence/.test(JSON.stringify(lean)));
});

test('equal form and conflicting latest results cannot force a named winning team', () => {
  const equal = build(fixture(Array(4).fill([1, 1]), Array(7).fill([1, 1]))).winnerLean;
  assert.equal(equal.status, 'balanced'); assert.equal(equal.side, null); assert.equal(equal.name, null);
  assert.ok(equal.reasons.some(reason => reason.includes('Punkty na mecz: 1 i 1')));
  const reversed = fixture([...Array(3).fill([0, 1]), ...Array(7).fill([3, 0])], [...Array(3).fill([3, 0]), ...Array(7).fill([0, 1])]);
  const disagreement = build(reversed).winnerLean;
  assert.equal(disagreement.status, 'balanced'); assert.equal(disagreement.side, null);
  assert.ok(disagreement.counterevidence.some(reason => reason.includes('Najnowsza forma')));
});

test('winner favourite uses only its exact three-way price and stale or invalid results never supply it', () => {
  const context = fixture(Array(4).fill([3, 1]), Array(6).fill([1, 3]));
  const source = odds(context.event);
  assert.equal(build(context, { oddsData: source }).winnerLean.quote.decimal, 2.95);
  source.quotes = [{ ...source.quotes[1], market: 'double_chance_90', outcomes: [
    { side: 'home_draw', decimal: 1.3 }, { side: 'home_away', decimal: 1.2 }, { side: 'draw_away', decimal: 3.5 },
  ] }];
  assert.equal(build(context, { oddsData: source }).winnerLean.quote.status, 'unavailable');
  for (const side of ['home', 'away']) {
    context.analysis[side].recent.forEach(row => row.date = new Date(Date.parse(row.date) - 31 * DAY).toISOString());
    context.analysis[side].lastMatchAt = context.analysis[side].recent[0].date;
  }
  const stale = build(context).winnerLean;
  assert.equal(stale.status, 'unavailable'); assert.equal(stale.side, null); assert.equal(stale.quote.decimal, null);
  context.analysis.resultScope = 'unknown'; assert.equal(build(context).winnerLean, null);
});
