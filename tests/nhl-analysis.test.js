import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNHLAnalysis } from '../public/nhl-analysis.js';

const now = Date.parse('2026-11-28T12:00:00.000Z'), DAY = 86400000, route = 'hockey/nhl', scope = 'including_overtime_shootout', cutoff = '2026-11-28T11:59:00.000Z';
function form(id, scores) {
  const recent = scores.map(([scoreFor, scoreAgainst], index) => ({ id: `${route}:${Number(id) * 100000 + index}`, route,
    date: new Date(now - (index + 1) * DAY).toISOString(), scoreFor, scoreAgainst, isHome: index % 2 === 0, opponent: `Opponent ${index}` }));
  const averageFor = recent.reduce((sum, r) => sum + r.scoreFor, 0) / recent.length, averageAgainst = recent.reduce((sum, r) => sum + r.scoreAgainst, 0) / recent.length;
  const wins = recent.filter(r => r.scoreFor > r.scoreAgainst).length;
  return { id, sample: recent.length, wins, losses: recent.length - wins, draws: 0,
    averageFor, averageAgainst, averageMargin: averageFor - averageAgainst, recent, lastMatchAt: recent[0].date };
}
function fixture(home = [...Array(8).fill([4, 1]), ...Array(2).fill([1, 3])], away = [...Array(3).fill([4, 1]), ...Array(7).fill([1, 4])]) {
  const event = { sport: 'nhl', route, id: `${route}:999999`, homeId: '1', awayId: '2', home: 'Home', away: 'Away', state: 'pre', date: '2026-11-29T00:00:00.000Z' };
  const analysis = { sport: 'nhl', route, fixtureId: event.id, status: 'available', cutoff, home: form('1', home), away: form('2', away) };
  return { event, analysis };
}
const build = (context = fixture(), options = {}) => buildNHLAnalysis(context.analysis, context.event, { now, ...options });
function odds(event, line = 6.5) {
  return { status: 'available', fixtureId: event.id, sport: 'nhl', route, homeId: event.homeId, awayId: event.awayId, startTime: event.date, fetchedAt: cutoff,
    quotes: [{ market: 'total_goals', scope, line, provider: 'Source', observedAt: cutoff, quotedAt: null, freshness: 'unverified',
      outcomes: [{ side: 'over', direction: 'over', line, decimal: 1.9 }, { side: 'under', direction: 'under', line, decimal: 1.85 }] },
    { market: 'winner', scope, line: null, provider: 'Source', observedAt: cutoff, quotedAt: null, freshness: 'unverified',
      outcomes: [{ side: 'home', decimal: 1.7 }, { side: 'away', decimal: 2.3 }] }] };
}

test('NHL explains winner and exact full-game goal line independently of price filtering', () => {
  const context = fixture(), result = build(context, { oddsData: odds(context.event), screening: { minOdds: 100 } });
  assert.equal(result.status, 'available'); assert.equal(result.scope, scope);
  assert.equal(result.winnerLean.name, 'Home'); assert.equal(result.winnerLean.quote.decimal, 1.7);
  assert.equal(result.line, 6.5); assert.equal(result.lineOrigin, 'source');
  assert.equal(result.candidates.length, 4); assert.ok(result.candidates.every(p => p.reasons.length >= 3 && p.counterevidence.length >= 2));
  const under = result.candidates.find(p => p.direction === 'under');
  assert.equal(under.quote.decimal, 1.85); assert.equal(under.eligible, true);
  assert.deepEqual(under.support, { home: { hits: 10, sample: 10 }, away: { hits: 10, sample: 10 } });
  assert.ok(under.counterevidence.some(r => r.includes('bramkarza wyjściowego')));
  assert.ok(result.notes.some(r => r.includes('jeden gol')));
  assert.ok(!/probability|expectedValue|modelProbability/.test(JSON.stringify(result)));
});

test('NHL metrics preserve official score zeros, chronological latest5, true venues and observed goal variability', () => {
  const context = fixture(); context.analysis.home.recent.reverse();
  const home = build(context).teams.home;
  assert.equal(home.recent[0].date, '2026-11-27T12:00:00.000Z');
  assert.equal(home.overall.averageFor, 3.4); assert.equal(home.overall.averageAgainst, 1.4);
  assert.equal(home.overall.medianTotal, 5); assert.ok(Math.abs(home.overall.totalStdDev - 0.4) < 1e-10);
  assert.equal(home.last5.wins, 5); assert.equal(home.last5.averageTotal, 5);
  assert.equal(home.venue.sample, 5); assert.equal(home.venue.wins, 4);
  assert.equal(home.restDays, 0); assert.ok(Math.abs(home.hoursSinceLatestStart - (24 - 1 / 60)) < 1e-8);
  const zeros = build(fixture(Array(10).fill([3, 0]), Array(10).fill([0, 3])));
  assert.equal(zeros.teams.home.overall.shutouts, 10); assert.equal(zeros.teams.away.overall.failedToScore, 10);
});

test('short NHL windows give a labelled preliminary winner while stale, equal or opposing recent forms do not force a lead', () => {
  const short = build(fixture(Array(4).fill([4, 1]), Array(6).fill([1, 4])));
  assert.equal(short.status, 'limited'); assert.equal(short.best, null); assert.equal(short.winnerLean.status, 'lean');
  assert.equal(short.winnerLean.shortSample, true); assert.deepEqual(short.winnerLean.samples, { home: 4, away: 6 });
  assert.ok(short.candidates.every(p => p.eligible === false));
  const gap = build(fixture([...Array(6).fill([4, 1]), ...Array(4).fill([1, 4])], [...Array(4).fill([4, 1]), ...Array(6).fill([1, 4])]));
  assert.equal(gap.winnerLean.side, 'home');
  const equal = build(fixture([[3, 1], [1, 3], [3, 1], [1, 3]], [[3, 1], [1, 3], [3, 1], [1, 3]]));
  assert.equal(equal.winnerLean.status, 'balanced'); assert.equal(equal.winnerLean.side, null);
  const opposite = build(fixture([...Array(3).fill([1, 4]), ...Array(7).fill([4, 1])], [...Array(5).fill([4, 1]), ...Array(5).fill([1, 4])]));
  assert.equal(opposite.winnerLean.status, 'balanced');
  const stale = fixture();
  for (const side of ['home', 'away']) { stale.analysis[side].recent.forEach(r => r.date = new Date(Date.parse(r.date) - 20 * DAY).toISOString()); stale.analysis[side].lastMatchAt = stale.analysis[side].recent[0].date; }
  const old = build(stale); assert.equal(old.status, 'limited'); assert.equal(old.best, null); assert.equal(old.winnerLean.status, 'unavailable');
});

test('NHL keeps the fixed5.5 reference and rejects borrowed60-minute, wrong-side, wrong-line or incomplete prices', () => {
  const context = fixture(), original = odds(context.event);
  const manual = build(context, { oddsData: original, totalLine: 5.5, totalLineOrigin: 'source' });
  assert.equal(manual.lineOrigin, 'manual'); assert.ok(manual.candidates.filter(p => p.kind === 'total').every(p => p.quote.status === 'unavailable'));
  for (const mutate of [d => d.fixtureId = `${route}:888888`, d => d.quotes[0].scope = 'regulation_60', d => d.quotes[0].outcomes[1].line = 5.5, d => delete d.quotes[0].outcomes[1]]) {
    const data = structuredClone(original); mutate(data);
    const result = build(context, { oddsData: data }); assert.equal(result.lineOrigin, 'analytical'); assert.equal(result.line, 5.5);
  }
  const highTotals = build(fixture(Array(10).fill([7, 4]), Array(10).fill([4, 7])));
  assert.equal(highTotals.referenceAverage, 11); assert.equal(highTotals.line, 5.5);
  assert.equal(new Set(highTotals.candidates.filter(p => p.kind === 'total').map(p => p.line)).size, 1);
  for (const totalLine of [0, 5, 26.5, '5.5']) assert.equal(build(context, { totalLine }).status, 'unavailable');
});

test('wrong identities, future knowledge, ties, regulation scopes and inconsistent NHL results fail closed', () => {
  for (const mutate of [c => c.event.homeId = c.event.awayId, c => c.analysis.fixtureId = `${route}:888888`,
    c => c.analysis.cutoff = '2026-11-28T12:01:00.000Z', c => c.analysis.cutoff = '2026-11-28T11:00:00.000Z',
    c => c.analysis.observedAt = '2026-11-28T12:01:00.000Z', c => c.analysis.home.recent[0].date = cutoff,
    c => c.analysis.home.recent[0].resultAvailableAt = '2026-11-28T12:01:00.000Z', c => c.analysis.resultScope = 'regulation_60',
    c => c.analysis.home.recent[0].scoreScope = 'including_overtime', c => c.analysis.home.recent[0].scope = 'regulation_60',
    c => c.analysis.home.recent[0].regulationOnly = true, c => c.analysis.home.recent[0].status = 'in',
    c => c.analysis.home.recent[0].scoreFor = c.analysis.home.recent[0].scoreAgainst, c => c.analysis.home.recent[0].scoreAgainst = 31,
    c => c.analysis.home.recent[1].id = c.analysis.home.recent[0].id, c => c.analysis.home.wins++, c => c.analysis.home.averageMargin++]) {
    const context = fixture(); mutate(context); const result = build(context); assert.equal(result.status, 'unavailable'); assert.equal(result.best, null); assert.equal(result.teams, null);
  }
  const live = fixture(); live.event.state = 'in'; assert.equal(build(live).status, 'closed');
});

test('NHL official shootout final3:2 stays total5, and shared head-to-head must mirror scores and roles', () => {
  const context = fixture();
  context.analysis.home = form('1', Array(10).fill([3, 2]));
  context.analysis.away = form('2', Array(10).fill([2, 3]));
  context.analysis.home.recent[0].shootoutScore = 4;
  context.analysis.away.recent[0].shootoutScore = 3;
  context.analysis.away.recent[0].id = context.analysis.home.recent[0].id;
  context.analysis.away.recent[0].isHome = false;
  const result = build(context); assert.equal(result.status, 'available'); assert.equal(result.coverage.sharedMatches, 1);
  assert.equal(result.referenceAverage, 5); assert.equal(result.teams.home.recent[0].total, 5);
  context.analysis.away.recent[0].scoreFor = 1;
  assert.equal(build(context).status, 'unavailable');
});
