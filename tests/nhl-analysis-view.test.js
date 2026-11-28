import test from 'node:test';
import assert from 'node:assert/strict';
import { nhlAnalysisCardHTML, nhlAnalysisDetailHTML, nhlPickReasonsHTML } from '../public/nhl-analysis-view.js';

const now = Date.parse('2026-11-28T12:00:00.000Z'), scope = 'including_overtime_shootout';
const event = { id: 'hockey/nhl:401999998', route: 'hockey/nhl', sport: 'nhl', homeId: '1', awayId: '2', home: 'Test Home', away: 'Test Away', state: 'pre', date: '2026-11-29T00:00:00.000Z' };
const stats = (sample = 10) => ({ sample, wins: 8, losses: 2, averageFor: 3.8, averageAgainst: 2.2, averageTotal: 6, averageMargin: 1.6, medianTotal: 5, totalStdDev: 2.1, shutouts: 2, failedToScore: 1 });
function result() {
  const winnerLean = { status: 'lean', kind: 'result', market: 'winner', scope, side: 'home', name: event.home, label: 'Test Home — zwycięstwo z dogrywką i karnymi', shortSample: false, samples: { home: 10, away: 10 }, reasons: ['Gospodarze wygrali 8 z 10 meczów.', 'Średnia różnica goli: +1,6.'], counterevidence: ['Dwie wcześniejsze porażki pokazują ryzyko.', 'Nie potwierdzono wyjściowych bramkarzy.'] };
  const total = { kind: 'total', market: 'total_goals', scope, direction: 'over', line: 5.5, label: 'Powyżej 5,5 gola w oficjalnym wyniku końcowym', eligible: true, signal: 'aligned', support: { home: { hits: 8, sample: 10 }, away: { hits: 7, sample: 10 } }, reasons: ['W obu próbach częściej przekraczano tę linię.'], counterevidence: ['Rozrzut sum goli wynosi 2,1 gola.'] };
  const team = () => ({ overall: stats(), last5: { ...stats(5), wins: 4, losses: 1 }, venue: { ...stats(5), wins: 4, losses: 1, reliable: true }, latestDate: '2026-11-26T00:00:00.000Z', hoursSinceLatestStart: 60, recent: [{ date: '2026-11-26T00:00:00.000Z', scoreFor: 4, scoreAgainst: 2, opponent: 'Test Rival' }] });
  return { sport: 'nhl', route: event.route, fixtureId: event.id, scope, status: 'available', winnerLean, best: total, candidates: [total], teams: { home: team(), away: team() }, notes: ['Brak potwierdzonych wyjściowych bramkarzy.'] };
}
function odds(market = 'winner') {
  return { status: 'available', fixtureId: event.id, sport: 'nhl', route: event.route, homeId: event.homeId, awayId: event.awayId, startTime: event.date, fetchedAt: new Date(now).toISOString(), quotes: [{ provider: 'Test provider', market, scope, line: market === 'winner' ? null : 5.5, observedAt: new Date(now).toISOString(), freshness: 'unverified', quotedAt: null, outcomes: market === 'winner' ? [{ side: 'home', decimal: 1.85 }, { side: 'away', decimal: 2.2 }] : [{ side: 'over', decimal: 1.91 }, { side: 'under', decimal: 1.95 }] }] };
}

test('NHL analysis stays visible unpriced and explains final-score support without promising a win', () => {
  const html = nhlAnalysisCardHTML(result(), event, { now, minOdds: 100 });
  assert.match(html, /Faworyt z formy/); assert.match(html, /Test Home — kierunek na zwycięstwo/);
  assert.match(html, /Co wspiera typ/); assert.match(html, /wygrali 8 z 10/); assert.match(html, /Co może przeszkodzić/);
  assert.match(html, /Sprawdź kurs na ten rynek/); assert.match(html, /8\/10/); assert.match(html, /7\/10/);
  assert.match(html, /z dogrywką i karnymi/); assert.match(html, /dodaje jeden gol/);
  assert.match(html, /data-bet-id="hockey\/nhl:401999998"/); assert.doesNotMatch(html, /NaN|Infinity|NBA|punktów|60 minut|pewny typ/);
});

test('NHL winner and total-goal quotes cannot be borrowed across markets, lines or 60-minute settlement', () => {
  const winner = nhlAnalysisCardHTML(result(), event, { now, oddsData: odds() });
  assert.match(winner.split('data-nhl-verdict')[0], /Kurs 1,85/);
  const totalOnly = nhlAnalysisCardHTML(result(), event, { now, oddsData: odds('total_goals') });
  assert.doesNotMatch(totalOnly.split('data-nhl-verdict')[0], /Kurs 1,91/); assert.match(totalOnly, /Kurs 1,91/);
  const wrongFixture = odds(); wrongFixture.fixtureId = 'hockey/nhl:999999';
  const wrongScope = odds(); wrongScope.quotes[0].scope = 'regulation_60';
  const wrongLine = odds('total_goals'); wrongLine.quotes[0].line = 6.5;
  for (const data of [wrongFixture, wrongScope]) assert.doesNotMatch(nhlAnalysisCardHTML(result(), event, { now, oddsData: data }), /Kurs 1,85/);
  assert.doesNotMatch(nhlAnalysisCardHTML(result(), event, { now, oddsData: wrongLine }), /Kurs 1,91/);
  assert.equal(nhlPickReasonsHTML({ market: 'total_goals', scope: 'regulation_60' }, event), '');
});

test('NHL details retain goal results, true venues and goalie uncertainty with collapsed market comparison', () => {
  const html = nhlAnalysisDetailHTML(result(), event, { now });
  assert.match(html, /4:2/); assert.match(html, /U siebie/); assert.match(html, /Na wyjeździe/);
  assert.match(html, /rozrzut sum/); assert.match(html, /2,1/); assert.match(html, /Od początku ostatniego dostępnego meczu/);
  assert.match(html, /Końcowy wynik ze stratą 0 goli/); assert.match(html, /2\/10/); assert.match(html, /To statystyka wyniku drużyny/);
  assert.match(html, /Brak potwierdzonych wyjściowych bramkarzy/);
  assert.match(html, /<details class="nhl-market-comparison">/); assert.match(html, /data-nhl-market="total_goals"/);
  assert.doesNotMatch(html, /data-bet-id/);
});

test('short, stale, balanced and mismatched NHL analyses cannot invent a confident favorite and prose is escaped', () => {
  const short = result(); short.status = 'limited'; short.best = null; short.winnerLean.shortSample = true; short.winnerLean.samples = { home: 4, away: 6 };
  assert.match(nhlAnalysisCardHTML(short, event, { now }), /wstępny kierunek/); assert.match(nhlAnalysisCardHTML(short, event, { now }), /Krótka próba/);
  const balanced = result(); balanced.best = null; balanced.winnerLean = { status: 'balanced', reasons: ['Ostatnie wyniki wskazują przeciwne kierunki.'] };
  assert.match(nhlAnalysisCardHTML(balanced, event, { now }), /Brak wyraźnego faworyta/);
  const stale = result(); stale.status = 'limited'; stale.best = null; stale.coverage = { stale: true };
  assert.doesNotMatch(nhlAnalysisCardHTML(stale, event, { now }), /Test Home — kierunek na zwycięstwo/);
  for (const changed of [{ fixtureId: 'hockey/nhl:999999' }, { scope: 'regulation_60' }]) assert.doesNotMatch(nhlAnalysisCardHTML({ ...result(), ...changed }, event, { now }), /Faworyt z formy/);
  const attack = result(); attack.winnerLean.reasons = ['<img src=x onerror=alert(1)>'];
  const html = nhlAnalysisCardHTML(attack, { ...event, away: '<script>x</script>' }, { now });
  assert.doesNotMatch(html, /<img|<script/); assert.match(html, /&lt;img/); assert.match(html, /&lt;script/);
  assert.match(nhlAnalysisCardHTML({ status: 'loading' }, event, { now }), /Wczytywanie analizy/);
  assert.equal(nhlAnalysisCardHTML(result(), { ...event, sport: 'nba' }), '');
});
