import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchPicks, matchPicksHTML } from '../public/match-picks.js';
import { buildPlayerPicks, evaluatePlayerLine, playerPicksHTML } from '../public/player-picks.js';

const now = Date.now(), DAY = 86400000, route = 'basketball/nba';
const event = { id: `${route}:999999`, sport: 'nba', route, homeId: '1', awayId: '2', home: 'Home', away: 'Away', state: 'pre', date: new Date(now + 6 * 3600000).toISOString() };
const cutoff = new Date(now - 60000).toISOString(), observedAt = new Date(now - 30000).toISOString();
const screening = { minOdds: 1.5, band: 'all' };
const options = oddsData => ({ now, screening, oddsData });
function form(id) {
  const recent = Array.from({ length: 10 }, (_, index) => {
    const total = index === 9 ? 400 : 200, margin = index < 5 ? 1 : -1;
    return { id: `${route}:${id}${10000 + index}`, route, date: new Date(now - (index + 3) * DAY).toISOString(), scoreFor: total / 2 + margin, scoreAgainst: total / 2 - margin, opponent: 'Rival', isHome: index % 2 === 0 };
  });
  return { id, sample: 10, wins: 5, draws: 0, losses: 5, recent, lastMatchAt: recent[0].date, averageFor: 110, averageAgainst: 110, averageMargin: 0,
    restDays: Math.floor((Date.parse(cutoff) - Date.parse(recent[0].date)) / DAY), splits: { home: { sample: 5, wins: 3, draws: 0, losses: 2 }, away: { sample: 5, wins: 2, draws: 0, losses: 3 } } };
}
const analysis = () => ({ status: 'available', sport: 'nba', route, fixtureId: event.id, cutoff, home: form('1'), away: form('2'), comparison: { sampleComplete: true, formWinsDifference: 0, averageMarginDifference: 0 } });
function quoted(market, decimal, changes = {}) {
  const quote = { market, line: market === 'player_prop' ? 14.5 : 220.5, scope: 'including_overtime', provider: 'Observed source', providerId: '100', observedAt, quotedAt: null, freshness: 'unverified', readOnly: true, usableForComparison: false,
    outcomes: [{ side: 'over', direction: 'over', decimal }, { side: 'under', direction: 'under', decimal }], ...changes };
  return { fixtureId: event.id, sport: event.sport, route, homeId: '1', awayId: '2', startTime: event.date, status: 'available', fetchedAt: observedAt, source: 'ESPN', quotes: [quote] };
}
function playerData() {
  const sampledMatches = Array.from({ length: 10 }, (_, index) => ({ id: `${route}:${300000 + index}`, date: new Date(now - (index + 1) * DAY).toISOString() }));
  return { status: 'available', sport: 'nba', route, teamId: '1', cutoff, fetchedAt: observedAt, sampledMatches, attemptedMatches: sampledMatches,
    players: [{ id: '101', name: 'Observed Player', metrics: { PTS: { sample: 10, observations: sampledMatches.map(row => ({ matchId: row.id, date: row.date, value: 25 })) } } }] };
}
const playerQuote = decimal => quoted('player_prop', decimal, { playerId: '101', teamId: '1', metric: 'PTS' });

test('screened match rendering hides low or missing prices while retaining totals and a manual comparison', () => {
  const data = analysis();
  for (const oddsData of [undefined, quoted('total_points', 1.25), quoted('total_points', 1.8, { line: 219.5 }), quoted('total_points', 1.8, { scope: 'regulation_90' })]) {
    const selected = buildMatchPicks(data, event, options(oddsData));
    assert.equal(selected.best, null); assert.deepEqual(selected.candidates, []);
    assert.equal(selected.totals.line, 220.5); assert.equal(selected.totals.home.under, 9);
    const html = matchPicksHTML(data, event, options(oddsData));
    assert.ok(!html.includes('class="match-best"')); assert.ok(!html.includes('data-journal-pick='));
    assert.match(html, /data-match-line/); assert.doesNotMatch(html, /Najmocniejszy sygnał|najpewniejsz|bezpieczn/);
  }
});

test('matched match price passes the minimum and a factual price band without assigning confidence', () => {
  const data = analysis(), value = quoted('total_points', 1.8), opts = options(value);
  assert.equal(buildMatchPicks(data, event, opts).best.direction, 'under');
  const html = matchPicksHTML(data, event, opts);
  assert.match(html, /class="match-best"/); assert.match(html, /data-price-band="lower"/);
  assert.match(html, /ryzyko niezweryfikowane/); assert.match(html, /data-journal-pick=/);
  const rejected = buildMatchPicks(data, event, { ...opts, screening: { minOdds: 1.5, band: 'higher' } });
  assert.equal(rejected.best, null); assert.equal(rejected.totals.home.under, 9);
});

test('player picks require an eligible exact athlete price and keep descriptors needed to match it', () => {
  const data = playerData();
  for (const oddsData of [undefined, playerQuote(1.25), quoted('player_prop', 1.8, { playerId: '999', teamId: '1', metric: 'PTS' }), quoted('player_prop', 1.8, { playerId: '101', teamId: '1', metric: 'PTS', scope: 'regulation_90' })]) {
    assert.equal(buildPlayerPicks(data, event, options(oddsData)).picks.length, 0);
    const html = playerPicksHTML(data, event, options(oddsData));
    assert.ok(!html.includes('data-journal-pick=')); assert.match(html, /filtr dopasowanego kursu/);
  }
  const selected = buildPlayerPicks(data, event, options(playerQuote(1.8))).picks;
  assert.equal(selected.length, 1); assert.equal(selected[0].playerId, '101'); assert.equal(selected[0].line, 14.5);
  assert.match(playerPicksHTML(data, event, options(playerQuote(1.8))), /data-price-band="lower"/);
});

test('a manually entered player line remains descriptive even when no automatic priced pick is eligible', () => {
  const data = playerData();
  assert.equal(buildPlayerPicks(data, event, options()).picks.length, 0);
  const html = playerPicksHTML(data, event, options());
  assert.match(html, /Porównaj własną linię — bez rekomendacji/); assert.match(html, /data-player-line/);
  assert.match(html, /name="line"[^>]*value=""/); assert.doesNotMatch(html, /data-journal-pick=/);
  const comparison = evaluatePlayerLine(data, event, '101', 'PTS', 24.5, options());
  assert.equal(comparison.status, 'available'); assert.equal(comparison.comparison.hits, 10);
  assert.equal(comparison.comparison.line, 24.5); assert.equal(comparison.comparison.probability, undefined);
});
