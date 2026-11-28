import test from 'node:test';
import assert from 'node:assert/strict';
import { footballExtraCardHTML, footballExtraDetailHTML } from '../public/football-extra-view.js';

const event = { sport: 'football', route: 'soccer/eng.1', id: 'soccer/eng.1:401000999', homeId: '1', awayId: '2', home: 'Home FC', away: 'Away FC', state: 'pre', date: '2026-11-29T15:00:00.000Z' };
const configs = { corners: ['Rzuty rożne', 'total_corners_90', 9.5], yellowCards: ['Żółte kartki', 'total_yellow_cards_90', 3.5], shots: ['Strzały', 'total_shots_90', 23.5], shotsOnTarget: ['Strzały celne', 'total_shots_on_target_90', 7.5] };
function metric(key = 'corners', sample = 8) {
  const [label, market, line] = configs[key];
  const recent = Array.from({ length: sample }, (_, i) => ({ matchId: `soccer/eng.1:${100000 + i}`, date: new Date(Date.parse('2026-11-26T15:00:00.000Z') - i * 86400000).toISOString(), own: i === 0 ? 0 : 6, against: i === 0 ? 0 : 5, total: i === 0 ? 0 : 11, opponent: `Rival ${i}`, isHome: i % 2 === 0 }));
  const stats = { sample, averageOwn: 5.25, averageAgainst: 4.375, averageTotal: 9.625, medianTotal: 11, totalStdDev: 3.6, last5: { sample: 5, averageTotal: 8.8, over: 4, under: 1 }, recent };
  const best = { kind: 'total', market, scope: 'regulation_90', direction: 'over', line, label: `Powyżej ${String(line).replace('.', ',')} — ${label}`, eligible: true, signal: 'aligned', support: { home: { hits: 7, sample }, away: { hits: 7, sample } }, reasons: ['Siedem wcześniejszych sum było powyżej progu.'], counterevidence: ['Ostatnia suma wyniosła zero.'] };
  return { key, label, market, line, lineOrigin: 'analytical', status: sample >= 8 ? 'available' : 'limited', best: sample >= 8 ? best : null, candidates: [best, { ...best, direction: 'under', label: `Poniżej ${line}`, signal: 'weak', eligible: false }], home: { ...stats }, away: { ...stats }, coverage: { homeSample: sample, awaySample: sample } };
}
const result = (metrics = [metric(), metric('yellowCards')]) => ({ sport: 'football', route: event.route, fixtureId: event.id, scope: 'regulation_90', status: 'available', metrics, notes: ['To jest opis dostępnej historii.'] });

test('football extra cards retain an analytical direction and explicit yellow-card settlement distinction without invented prices', () => {
  const html = footballExtraCardHTML(result(), event);
  assert.match(html, /Rzuty rożne/); assert.match(html, /Żółte kartki/);
  assert.match(html, /Stała linia analityczna.*9,5/); assert.match(html, /suma obu drużyn po 90 minutach/);
  assert.match(html, /7\/8/); assert.match(html, /Ostatnia suma wyniosła zero/);
  assert.match(html, /licznik żółtych kartek ESPN/); assert.match(html, /drugiej żółtej, czerwonych kartek i punktów kartkowych/);
  assert.match(html, /Sprawdź kurs i zasady dokładnie tego rynku/);
  assert.doesNotMatch(html, /Kurs \d|expectedValue|probability|\d%/);
  assert.match(html, /data-football-extra-line data-fixture-id="soccer\/eng\.1:401000999" data-metric="corners"/);
});

test('null extra statistics stay missing while genuine zero observations remain on a zero-baseline chart', () => {
  const data = result(); data.metrics[0].home.averageOwn = null;
  data.metrics[0].away.recent[1] = { ...data.metrics[0].away.recent[1], own: null, against: null, total: null };
  const html = footballExtraDetailHTML(data, event);
  assert.match(html, /<td>—<\/td>/); assert.match(html, /data-total="0"/); assert.match(html, /data-zero-baseline="true"/);
  assert.equal((html.match(/data-total="0"/g) || []).length, 4);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /sumę statystyki obu drużyn/);
});

test('short or incomplete windows retain descriptive comparison without promoting a supplied main pick', () => {
  const short = metric('corners', 4); short.best = { ...metric().best };
  const data = result([short]); data.status = 'limited';
  const html = footballExtraCardHTML(data, event);
  assert.match(html, /Dostępna krótka próba/); assert.match(html, /name="line"/);
  assert.doesNotMatch(html, /data-extra-best|readonly|disabled/);
  const missing = metric('yellowCards'); missing.status = 'unavailable'; missing.home = null; missing.away = null; missing.coverage.reason = 'Źródło nie podało tej statystyki.';
  const absent = footballExtraCardHTML(result([missing]), event);
  assert.match(absent, /Źródło nie podało/); assert.doesNotMatch(absent, /data-extra-best|name="line"|<table/);
  const unavailable = { ...result(), status: 'unavailable', reason: 'Ekstraklasa: źródło nie podaje szczegółowych statystyk.', metrics: [] };
  assert.match(footballExtraCardHTML(unavailable, { ...event, route: event.route }), /Ekstraklasa: źródło nie podaje/);
});

test('detail exposes all available markets and custom lines; compact card folds later metrics and preserves its open action', () => {
  const data = result(Object.keys(configs).map(key => metric(key))); data.metrics[0].lineOrigin = 'manual';
  const compact = footballExtraCardHTML(data, event);
  assert.match(compact, /fex-more-metrics/); assert.match(compact, /Strzały, Strzały celne/);
  assert.match(compact, /Twoja linia.*9,5/); assert.match(compact, /data-bet-id/);
  const detail = footballExtraDetailHTML(data, event);
  assert.equal((detail.match(/data-extra-metric=/g) || []).length, 4); assert.doesNotMatch(detail, /fex-more-metrics|data-bet-id/);
  const fullCard = footballExtraCardHTML(data, event, { compact: false });
  assert.match(fullCard, /data-football-extra-card/); assert.match(fullCard, /data-bet-id/); assert.doesNotMatch(fullCard, /fex-more-metrics/);
});

test('mismatched identities, loading data and malicious source prose cannot invent or inject a market analysis', () => {
  const mismatched = { ...result(), fixtureId: 'soccer/eng.1:999999' };
  const blocked = footballExtraCardHTML(mismatched, event);
  assert.match(blocked, /Nie można powiązać/); assert.doesNotMatch(blocked, /data-extra-best/);
  const loading = footballExtraCardHTML({ status: 'loading', reason: 'Wczytywanie narożników…' }, event);
  assert.match(loading, /Pobieranie statystyk/); assert.match(loading, /Wczytywanie narożników/);
  const attack = result(); attack.metrics[0].best.label = '<script>alert(1)</script>'; attack.notes = ['<img src=x onerror=alert(1)>'];
  const html = footballExtraDetailHTML(attack, { ...event, home: '<img src=x>' });
  assert.doesNotMatch(html, /<script>|<img/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/);
  assert.equal(footballExtraCardHTML(result(), { ...event, sport: 'nba' }), '');
});
