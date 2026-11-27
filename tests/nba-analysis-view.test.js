import test from 'node:test';
import assert from 'node:assert/strict';
import { nbaAnalysisCardHTML, nbaAnalysisDetailHTML } from '../public/nba-analysis-view.js';

const now = Date.parse('2026-11-27T12:00:00.000Z');
const event = { id: 'basketball/nba:401999998', route: 'basketball/nba', sport: 'nba', homeId: '1', awayId: '2', home: 'Test Home', away: 'Test Away', state: 'pre', date: '2026-11-28T00:00:00.000Z' };
const stats = (sample = 10) => ({ sample, wins: 8, losses: 2, averageFor: 120, averageAgainst: 110, averageTotal: 230, averageMargin: 10, medianTotal: 229, totalStdDev: 14.2 });
function result() {
  const winnerLean = { status: 'lean', kind: 'result', market: 'winner', scope: 'including_overtime', side: 'home', name: event.home, label: 'Test Home — zwycięstwo z dogrywką', shortSample: false, samples: { home: 10, away: 10 }, reasons: ['Gospodarze wygrali 8 z 10 meczów.', 'Średnia różnica wyniku: +10 punktów.'], counterevidence: ['Dwie wcześniejsze porażki pokazują ryzyko.'] };
  const total = { kind: 'total', market: 'total_points', scope: 'including_overtime', direction: 'over', line: 224.5, label: 'Powyżej 224,5 punktu z dogrywką', eligible: true, signal: 'aligned', support: { home: { hits: 8, sample: 10 }, away: { hits: 7, sample: 10 } }, reasons: ['W obu próbach częściej przekraczano tę linię.'], counterevidence: ['Rozrzut sum punktów wynosi 14,2 punktu.'] };
  const team = () => ({ overall: stats(), last5: { ...stats(5), wins: 4, losses: 1 }, venue: { ...stats(5), wins: 4, losses: 1, reliable: true }, latestDate: '2026-11-25T00:00:00.000Z', hoursSinceLatestStart: 60, recent: [{ date: '2026-11-25T00:00:00.000Z', scoreFor: 123, scoreAgainst: 112, opponent: 'Test Rival' }] });
  return { sport: 'nba', route: event.route, fixtureId: event.id, status: 'available', winnerLean, best: total, candidates: [total], teams: { home: team(), away: team() }, notes: ['Brak potwierdzonych składów.'] };
}
function odds(market = 'winner') {
  return { status: 'available', fixtureId: event.id, sport: 'nba', route: event.route, homeId: event.homeId, awayId: event.awayId, startTime: event.date, fetchedAt: new Date(now).toISOString(), quotes: [{ provider: 'Test provider', market, scope: 'including_overtime', line: market === 'winner' ? null : 224.5, observedAt: new Date(now).toISOString(), freshness: 'unverified', quotedAt: null, outcomes: market === 'winner' ? [{ side: 'home', decimal: 1.85 }, { side: 'away', decimal: 2.2 }] : [{ side: 'over', decimal: 1.91 }, { side: 'under', decimal: 1.95 }] }] };
}

test('NBA explanation remains visible without prices or at a high minimum, with actual support and counterarguments', () => {
  const html = nbaAnalysisCardHTML(result(), event, { now, minOdds: 100 });
  assert.match(html, /Faworyt z formy/); assert.match(html, /Test Home — kierunek na zwycięstwo/);
  assert.match(html, /Co wspiera typ/); assert.match(html, /wygrali 8 z 10/); assert.match(html, /Co może przeszkodzić/);
  assert.match(html, /Sprawdź kurs na ten rynek/); assert.match(html, /8\/10/); assert.match(html, /7\/10/);
  assert.match(html, /data-bet-id="basketball\/nba:401999998"/); assert.doesNotMatch(html, /NaN|Infinity|goli|BTTS|90 minut/);
});

test('winner and point total prices remain attached only to the exact market', () => {
  const winner = nbaAnalysisCardHTML(result(), event, { now, oddsData: odds() });
  assert.match(winner.split('data-nba-verdict')[0], /Kurs 1,85/);
  const totalOnly = nbaAnalysisCardHTML(result(), event, { now, oddsData: odds('total_points') });
  assert.doesNotMatch(totalOnly.split('data-nba-verdict')[0], /Kurs 1,91/); assert.match(totalOnly, /Kurs 1,91/);
  const wrong = odds(); wrong.fixtureId = 'basketball/nba:999999';
  assert.doesNotMatch(nbaAnalysisCardHTML(result(), event, { now, oddsData: wrong }), /Kurs 1,85/);
});

test('NBA details retain recent results, real venue, variability, and collapsed comparisons without a duplicate modal button', () => {
  const html = nbaAnalysisDetailHTML(result(), event, { now });
  assert.match(html, /123:112/); assert.match(html, /U siebie/); assert.match(html, /Na wyjeździe/);
  assert.match(html, /rozrzut sum/); assert.match(html, /14,2/); assert.match(html, /Od początku ostatniego dostępnego meczu/);
  assert.match(html, /<details class="nba-market-comparison">/); assert.match(html, /data-nba-market="total_points"/);
  assert.doesNotMatch(html, /data-bet-id/);
});

test('short, balanced, stale or mismatched NBA data cannot invent a firm direction and prose is escaped', () => {
  const short = result(); short.status = 'limited'; short.best = null; short.winnerLean.shortSample = true; short.winnerLean.samples = { home: 4, away: 6 };
  assert.match(nbaAnalysisCardHTML(short, event, { now }), /wstępny kierunek/); assert.match(nbaAnalysisCardHTML(short, event, { now }), /Krótka próba/);
  const balanced = result(); balanced.best = null; balanced.winnerLean = { status: 'balanced', reasons: ['Ostatnie wyniki wskazują przeciwne kierunki.'] };
  assert.match(nbaAnalysisCardHTML(balanced, event, { now }), /Brak wyraźnego faworyta/);
  const stale = result(); stale.status = 'limited'; stale.best = null; stale.coverage = { stale: true };
  assert.doesNotMatch(nbaAnalysisCardHTML(stale, event, { now }), /Test Home — kierunek na zwycięstwo/);
  const invalid = result(); invalid.fixtureId = 'basketball/nba:999999';
  assert.doesNotMatch(nbaAnalysisCardHTML(invalid, event, { now }), /Faworyt z formy/);
  const attack = result(); attack.winnerLean.reasons = ['<img src=x onerror=alert(1)>'];
  const html = nbaAnalysisCardHTML(attack, { ...event, away: '<script>x</script>' }, { now });
  assert.doesNotMatch(html, /<img|<script/); assert.match(html, /&lt;img/); assert.match(html, /&lt;script/);
  assert.match(nbaAnalysisCardHTML({ status: 'loading' }, event, { now }), /Wczytywanie analizy/);
  assert.equal(nbaAnalysisCardHTML(result(), { ...event, sport: 'football' }), '');
});
