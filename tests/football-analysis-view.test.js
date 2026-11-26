import test from 'node:test';
import assert from 'node:assert/strict';
import { footballAnalysisCardHTML, footballAnalysisDetailHTML } from '../public/football-analysis-view.js';

const now = Date.parse('2026-11-25T17:00:00.000Z');
const event = { id: 'soccer/eng.2:401880139', route: 'soccer/eng.2', sport: 'football', homeId: '379', awayId: '392', home: 'Burnley', away: 'Birmingham City', league: 'Championship', state: 'pre', date: '2026-11-25T19:45:00.000Z' };
const stats = (sample = 10) => ({ sample, wins: 6, draws: 2, losses: 2, averageFor: 1.8, averageAgainst: 1.2, averageTotal: 3, btts: 7, cleanSheets: 2, failedToScore: 1 });
function result() {
  const best = { kind: 'result', market: 'X2', side: 'away', scope: 'regulation_90', label: 'Birmingham City nie przegra — X2 (90 minut)', eligible: true, signal: 'aligned', support: { home: { hits: 9, sample: 10 }, away: { hits: 8, sample: 10 } }, reasons: ['Dziewięć poprzednich meczów gospodarzy bez wygranej.', 'Goście pozostali bez porażki w ośmiu spotkaniach.'], counterevidence: ['Ostatnia porażka gości pokazuje ryzyko tego kierunku.'] };
  const team = id => ({ id, overall: stats(), last5: { ...stats(5), wins: 3, draws: 1, losses: 1, averageFor: 2, averageAgainst: 0.8, btts: 3 }, venue: { ...stats(5), wins: 3, draws: 1, losses: 1, reliable: true }, latestDate: '2026-11-22T12:00:00.000Z', recent: [{ date: '2026-11-22T12:00:00.000Z', scoreFor: 2, scoreAgainst: 2, opponent: 'Blackburn Rovers' }] });
  return { sport: 'football', route: event.route, fixtureId: event.id, status: 'available', best, candidates: [best], teams: { home: team(event.homeId), away: team(event.awayId) }, notes: ['Składy nie zostały potwierdzone.'] };
}
function odds(market = 'winner') {
  return { status: 'available', fixtureId: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId, startTime: event.date, fetchedAt: new Date(now).toISOString(), quotes: [{ provider: 'Source bookmaker', market, scope: 'regulation_90', line: null, observedAt: new Date(now).toISOString(), freshness: 'unverified', quotedAt: null, outcomes: market === 'winner' ? [{ side: 'home', decimal: 2.95 }, { side: 'draw', decimal: 3.6 }, { side: 'away', decimal: 2.35 }] : [{ side: 'home_draw', decimal: 1.7 }, { side: 'home_away', decimal: 1.3 }, { side: 'draw_away', decimal: 1.6 }] }] };
}

test('unpriced football direction stays visible with its factual support and counterevidence', () => {
  const html = footballAnalysisCardHTML(result(), event, { now, oddsData: odds(), minOdds: 100 });
  assert.match(html, /Birmingham City nie przegra/);
  assert.match(html, /9\/10/); assert.match(html, /8\/10/);
  assert.match(html, /Sprawdź kurs na ten rynek/);
  assert.match(html, /Ostatnia porażka gości/);
  assert.match(html, /Zdobyte/); assert.match(html, /Ostatnie 5/); assert.match(html, /22\.11/);
  assert.match(html, /data-bet-id="soccer\/eng\.2:401880139"/);
  assert.doesNotMatch(html, /Kurs 2,35|Kurs 2,95|probability|NaN|Infinity/);
});

test('only the exact complete double-chance price can appear beside its direction', () => {
  const matched = footballAnalysisCardHTML(result(), event, { now, oddsData: odds('double_chance_90') });
  assert.match(matched, /Kurs 1,60/); assert.match(matched, /Source bookmaker/);
  const wrong = odds('double_chance_90'); wrong.fixtureId = 'soccer/eng.2:999999';
  const stale = odds('double_chance_90'); stale.fetchedAt = '2026-11-25T16:00:00.000Z';
  for (const data of [wrong, stale]) assert.doesNotMatch(footballAnalysisCardHTML(result(), event, { now, oddsData: data }), /Kurs 1,60/);
});

test('limited or unavailable history cannot promote a supplied best pick but preserves available facts', () => {
  const data = result(); data.status = 'limited'; data.reason = 'Tylko cztery potwierdzone mecze.';
  data.teams.home.overall = { ...stats(4), wins: 1, draws: 2, losses: 1 };
  const html = footballAnalysisCardHTML(data, event, { now });
  assert.match(html, /Za krótka historia do wskazania typu/); assert.match(html, /Tylko cztery/); assert.match(html, /Ostatnie 4 meczów/);
  assert.doesNotMatch(html, /Najlepiej wsparty kierunek w historii/);
  const stale = result(); stale.status = 'limited'; stale.best = null; stale.coverage = { stale: true }; stale.reason = 'Ostatnie wyniki mają ponad 30 dni.';
  assert.match(footballAnalysisCardHTML(stale, event, { now }), /Historia wymaga odświeżenia/);
  const neutral = result(); neutral.best = null; neutral.candidates[0].signal = 'mixed'; neutral.candidates[0].eligible = false;
  assert.match(footballAnalysisDetailHTML(neutral, event, { now }), /Brak zgodnego kierunku/);
  assert.match(footballAnalysisDetailHTML(neutral, event, { now }), /Sygnały mieszane/);
});

test('detail view compares markets, home-away evidence and uncertainty without a duplicate open button', () => {
  const html = footballAnalysisDetailHTML(result(), event, { now });
  assert.match(html, /Wynik czy gole/); assert.match(html, /Argumenty przeciw/);
  assert.match(html, /Czyste konta/); assert.match(html, /Na wyjeździe/); assert.match(html, /2 zdobytych \/ 0,8 straconych|1,8 zdobytych \/ 1,2 straconych/);
  assert.match(html, /Składy nie zostały potwierdzone/);
  assert.doesNotMatch(html, /data-bet-id/);
});

test('unknown binding, loading and malicious text remain safe and do not invent a recommended direction', () => {
  const data = result(); data.fixtureId = 'soccer/eng.2:999999';
  const html = footballAnalysisCardHTML(data, event, { now });
  assert.match(html, /Nie można powiązać analizy/); assert.doesNotMatch(html, /Birmingham City nie przegra/);
  const loading = footballAnalysisCardHTML({ status: 'loading', reason: 'Sprawdzanie terminarza…' }, event, { now });
  assert.match(loading, /Wczytywanie analizy/); assert.match(loading, /Sprawdzanie terminarza/);
  const attack = result(); attack.best.label = '<script>alert(1)</script>'; attack.best.counterevidence = ['<img src=x onerror=alert(1)>'];
  const escaped = footballAnalysisCardHTML(attack, { ...event, home: '<img src=x>' }, { now });
  assert.doesNotMatch(escaped, /<script>|<img/); assert.match(escaped, /&lt;script&gt;/); assert.match(escaped, /&lt;img/);
  assert.equal(footballAnalysisCardHTML(result(), { ...event, sport: 'nba' }), '');
});

test('short verified form shows the winning team and why, without the old empty headline or a borrowed X2 price', () => {
  const data = result(); data.status = 'limited'; data.best = null;
  data.winnerLean = { status: 'lean', kind: 'result', market: 'winner', scope: 'regulation_90', side: 'away', name: event.away, shortSample: true, samples: { home: 4, away: 5 }, reasons: ['Birmingham City: 3 zwycięstwa w 5 meczach.', 'Średnia różnica goli gości jest wyższa.'], counterevidence: ['Krótka historia ogranicza ten wniosek.'] };
  const html = footballAnalysisCardHTML(data, event, { now, oddsData: odds() });
  assert.match(html, /Faworyt z formy/); assert.match(html, /Birmingham City — kierunek na zwycięstwo/);
  assert.match(html, /3 zwycięstwa w 5/); assert.match(html, /Krótka próba/); assert.match(html, /Kurs 2,35/);
  assert.doesNotMatch(html, /Za krótka historia do wskazania typu/);
  assert.doesNotMatch(footballAnalysisCardHTML(data, event, { now, oddsData: odds('double_chance_90') }).split('<div class="fa-teams">')[0], /Kurs 1,60/);
  data.winnerLean = { status: 'balanced', reasons: ['Obie drużyny mają po 1,5 punktu na mecz.'] };
  const balanced = footballAnalysisCardHTML(data, event, { now });
  assert.match(balanced, /Brak wyraźnego faworyta/); assert.match(balanced, /Obie drużyny mają po 1,5/);
  assert.doesNotMatch(balanced, /kierunek na zwycięstwo|Za krótka historia do wskazania typu/);
});
