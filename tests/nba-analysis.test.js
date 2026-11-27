import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNBAAnalysis } from '../public/nba-analysis.js';

const now = Date.parse('2026-11-27T12:00:00.000Z'), DAY = 86400000, route = 'basketball/nba', cutoff = '2026-11-27T11:59:00.000Z';
function form(id, scores) {
  const recent = scores.map(([scoreFor, scoreAgainst], index) => ({ id: `${route}:${Number(id) * 100000 + index}`, route,
    date: new Date(now - (index + 1) * DAY).toISOString(), scoreFor, scoreAgainst, isHome: index % 2 === 0, opponent: `Opponent ${index}` }));
  const averageFor = recent.reduce((sum, r) => sum + r.scoreFor, 0) / recent.length, averageAgainst = recent.reduce((sum, r) => sum + r.scoreAgainst, 0) / recent.length;
  const wins = recent.filter(r => r.scoreFor > r.scoreAgainst).length;
  return { id, sample: recent.length, wins, losses: recent.length - wins, draws: 0,
    averageFor, averageAgainst, averageMargin: averageFor - averageAgainst, recent, lastMatchAt: recent[0].date };
}
function fixture(home = [...Array(8).fill([120, 110]), ...Array(2).fill([105, 115])], away = [...Array(3).fill([120, 110]), ...Array(7).fill([104, 120])]) {
  const event = { sport: 'nba', route, id: `${route}:999999`, homeId: '1', awayId: '2', home: 'Home', away: 'Away', state: 'pre', date: '2026-11-28T00:00:00.000Z' };
  const analysis = { sport: 'nba', route, fixtureId: event.id, status: 'available', cutoff, home: form('1', home), away: form('2', away) };
  return { event, analysis };
}
const build = (context = fixture(), options = {}) => buildNBAAnalysis(context.analysis, context.event, { now, ...options });
function odds(event, line = 240.5) {
  return { status: 'available', fixtureId: event.id, sport: 'nba', route, homeId: event.homeId, awayId: event.awayId, startTime: event.date, fetchedAt: cutoff,
    quotes: [{ market: 'total_points', scope: 'including_overtime', line, provider: 'Source', observedAt: cutoff, quotedAt: null, freshness: 'unverified',
      outcomes: [{ side: 'over', direction: 'over', line, decimal: 1.9 }, { side: 'under', direction: 'under', line, decimal: 1.85 }] },
    { market: 'winner', scope: 'including_overtime', line: null, provider: 'Source', observedAt: cutoff, quotedAt: null, freshness: 'unverified',
      outcomes: [{ side: 'home', decimal: 1.7 }, { side: 'away', decimal: 2.3 }] }] };
}

test('NBA analysis explains winner form and exact source totals independently of price screening', () => {
  const context = fixture(), result = build(context, { oddsData: odds(context.event), screening: { minOdds: 100 } });
  assert.equal(result.status, 'available'); assert.equal(result.scope, 'including_overtime');
  assert.equal(result.winnerLean.name, 'Home'); assert.equal(result.winnerLean.quote.decimal, 1.7);
  assert.equal(result.line, 240.5); assert.equal(result.lineOrigin, 'source');
  assert.equal(result.candidates.length, 4); assert.ok(result.candidates.every(p => p.reasons.length >= 3 && p.counterevidence.length >= 2));
  const under = result.candidates.find(p => p.direction === 'under');
  assert.equal(under.quote.decimal, 1.85); assert.equal(under.eligible, true);
  assert.deepEqual(under.support, { home: { hits: 10, sample: 10 }, away: { hits: 10, sample: 10 } });
  assert.ok(under.reasons.some(r => r.includes('Mediany'))); assert.ok(under.counterevidence.some(r => r.includes('Zakresy')));
  assert.ok(!/probability|expectedValue|modelProbability/.test(JSON.stringify(result)));
});

test('NBA metrics use chronological latest5, exact venue rows, volatility and observed start gaps', () => {
  const context = fixture(); context.analysis.home.recent.reverse();
  const result = build(context), home = result.teams.home;
  assert.equal(home.recent[0].date, '2026-11-26T12:00:00.000Z');
  assert.equal(home.overall.averageFor, 117); assert.equal(home.overall.averageAgainst, 111);
  assert.equal(home.overall.medianTotal, 230); assert.equal(home.overall.totalStdDev, 4);
  assert.equal(home.last5.wins, 5); assert.equal(home.last5.averageTotal, 230);
  assert.equal(home.venue.sample, 5); assert.equal(home.venue.wins, 4); assert.equal(result.teams.away.venue.wins, 1);
  assert.equal(home.restDays, 0); assert.ok(Math.abs(home.hoursSinceLatestStart - (24 - 1 / 60)) < 1e-8);
  assert.ok(result.winnerLean.counterevidence.some(text => text.includes('opisu terminarza') || text.includes('opis terminarza')));
});

test('short histories keep a labelled preliminary winner while stale or conflicting forms cannot force a pick', () => {
  const short = build(fixture(Array(4).fill([120, 100]), Array(6).fill([100, 120])));
  assert.equal(short.status, 'limited'); assert.equal(short.best, null); assert.equal(short.winnerLean.status, 'lean');
  assert.equal(short.winnerLean.shortSample, true); assert.deepEqual(short.winnerLean.samples, { home: 4, away: 6 });
  assert.ok(short.candidates.every(p => p.eligible === false));
  const exactGap = build(fixture([...Array(6).fill([120, 100]), ...Array(4).fill([100, 120])], [...Array(4).fill([120, 100]), ...Array(6).fill([100, 120])]));
  assert.equal(exactGap.winnerLean.side, 'home');
  const equal = build(fixture([[120, 110], [110, 120], [120, 110], [110, 120]], [[120, 110], [110, 120], [120, 110], [110, 120]]));
  assert.equal(equal.winnerLean.status, 'balanced'); assert.equal(equal.winnerLean.side, null);
  const opposite = build(fixture([...Array(3).fill([100, 120]), ...Array(7).fill([120, 100])], [...Array(5).fill([120, 100]), ...Array(5).fill([100, 120])]));
  assert.equal(opposite.winnerLean.status, 'balanced');
  const stale = fixture();
  for (const side of ['home', 'away']) { stale.analysis[side].recent.forEach(r => r.date = new Date(Date.parse(r.date) - 20 * DAY).toISOString()); stale.analysis[side].lastMatchAt = stale.analysis[side].recent[0].date; }
  const old = build(stale); assert.equal(old.status, 'limited'); assert.equal(old.best, null); assert.equal(old.winnerLean.status, 'unavailable');
});

test('NBA lines never borrow another scope, side, market or threshold and analytical reference is not optimized', () => {
  const context = fixture(), original = odds(context.event);
  const manual = build(context, { oddsData: original, totalLine: 220.5, totalLineOrigin: 'source' });
  assert.equal(manual.lineOrigin, 'manual'); assert.ok(manual.candidates.filter(p => p.kind === 'total').every(p => p.quote.status === 'unavailable'));
  for (const mutate of [d => d.fixtureId = `${route}:888888`, d => d.quotes[0].scope = 'regulation_90', d => d.quotes[0].outcomes[1].line = 239.5, d => delete d.quotes[0].outcomes[1]]) {
    const data = structuredClone(original); mutate(data);
    assert.equal(build(context, { oddsData: data }).lineOrigin, 'analytical');
  }
  const reference = build(context);
  assert.equal(reference.line, Math.floor(reference.referenceAverage) + 0.5);
  assert.equal(new Set(reference.candidates.filter(p => p.kind === 'total').map(p => p.line)).size, 1);
  assert.equal(build(context, { totalLine: 230 }).status, 'unavailable');
});

test('wrong identity, future knowledge, ties, contradictory aggregates and duplicate rows fail closed', () => {
  for (const mutate of [c => c.event.homeId = c.event.awayId, c => c.analysis.fixtureId = `${route}:888888`,
    c => c.analysis.cutoff = '2026-11-27T12:01:00.000Z', c => c.analysis.cutoff = '2026-11-27T11:00:00.000Z',
    c => c.analysis.observedAt = '2026-11-27T12:01:00.000Z', c => c.analysis.home.recent[0].date = cutoff,
    c => c.analysis.home.recent[0].resultAvailableAt = '2026-11-27T12:01:00.000Z',
    c => c.analysis.home.recent[0].scoreScope = 'regulation_90', c => c.analysis.home.recent[0].status = 'in',
    c => c.analysis.home.recent[0].scoreFor = c.analysis.home.recent[0].scoreAgainst,
    c => c.analysis.home.recent[1].id = c.analysis.home.recent[0].id, c => c.analysis.home.wins++, c => c.analysis.home.averageMargin++]) {
    const context = fixture(); mutate(context); const result = build(context); assert.equal(result.status, 'unavailable'); assert.equal(result.best, null); assert.equal(result.teams, null);
  }
  const live = fixture(); live.event.state = 'in'; assert.equal(build(live).status, 'closed');
});

test('shared NBA head-to-head must mirror scores and roles and counts once in the reference line', () => {
  const context = fixture();
  context.analysis.home = form('1', Array(10).fill([120, 110]));
  context.analysis.away = form('2', Array(10).fill([110, 120]));
  context.analysis.away.recent[0].id = context.analysis.home.recent[0].id;
  context.analysis.away.recent[0].isHome = false;
  const result = build(context); assert.equal(result.status, 'available'); assert.equal(result.coverage.sharedMatches, 1);
  assert.equal(result.referenceAverage, 230);
  context.analysis.away.recent[0].scoreFor = 109;
  assert.equal(build(context).status, 'unavailable');
});
