import test from 'node:test';
import assert from 'node:assert/strict';
import { matchChartsHTML } from '../public/match-charts.js';

const event = { id: 'basketball/nba:999999', route: 'basketball/nba', sport: 'nba', date: '2026-02-01T00:00:00.000Z', homeId: '1', awayId: '2', home: 'Test A', away: 'Test B' };
const row = (id, day, scoreFor = 110, scoreAgainst = 100, changes = {}) => ({ id: `basketball/nba:${id}`, route: 'basketball/nba', date: `2026-01-${String(day).padStart(2, '0')}T12:00:00.000Z`, scoreFor, scoreAgainst, opponent: 'Test Rival', ...changes });
const analysis = (home = [row('100002', 2, 120, 100), row('100001', 1)], away = [row('200002', 3, 105, 100)]) => ({ sport: 'nba', route: event.route, fixtureId: event.id, cutoff: event.date, home: { id: '1', recent: home }, away: { id: '2', recent: away } });
const totals = html => [...html.matchAll(/data-total="(\d+)"/g)].map(match => Number(match[1]));

test('charts use actual combined final points in chronological order with a shared zero baseline', () => {
  const html = matchChartsHTML(analysis(), event, { line: 224.5 });
  assert.deepEqual(totals(html), [210, 220, 205]);
  assert.equal((html.match(/data-zero-baseline="true"/g) || []).length, 2);
  assert.equal((html.match(/>250<\/text>/g) || []).length, 2);
  assert.match(html, /Linia porównania: <b>224,5/);
  assert.match(html, /Średnia: <b>215/);
  assert.match(html, /role="img"/);
  assert.match(html, /110:100; suma 210 punktów/);
});

test('target, future, cutoff-equal and malformed scores never appear or turn into zero', () => {
  const records = [row('100001', 1), row('100002', 2, undefined, 100), row('100003', 3, -1, 100),
    row('100004', 4, 110, NaN), row('100005', 5, 101, 101), row('999999', 6),
    row('100006', 6, 100, 90, { date: event.date }), row('100007', 7, 100, 90, { date: '2026-02-02T00:00:00Z' }),
    row('100008', 8, 100, 90, { route: 'basketball/other' })];
  // Explicitly remove a score: default function arguments would otherwise replace undefined.
  delete records[1].scoreFor;
  assert.deepEqual(totals(matchChartsHTML(analysis(records, []), event)), [210]);
});

test('identical duplicate rows collapse and conflicting observations are omitted on both sides', () => {
  const first = row('100001', 1);
  const repeated = row('100002', 2, 120, 100);
  const shared = row('100003', 3, 110, 90);
  const home = [first, first, repeated, { ...repeated, scoreFor: 121 }, shared];
  const away = [{ ...shared, scoreFor: 115, scoreAgainst: 90 }, row('200001', 4, 130, 100)];
  assert.deepEqual(totals(matchChartsHTML(analysis(home, away), event)), [210, 230]);
});

test('a shared head-to-head result must reverse participant scores even when totals agree', () => {
  const shared = row('100001', 1, 110, 100);
  const reversed = { ...shared, scoreFor: 100, scoreAgainst: 110 };
  assert.deepEqual(totals(matchChartsHTML(analysis([shared], [reversed]), event)), [210, 210]);
  assert.deepEqual(totals(matchChartsHTML(analysis([shared], [{ ...shared }]), event)), []);
});

test('at most ten valid results per participant are drawn and compact charts retain exact facts', () => {
  const home = Array.from({ length: 14 }, (_, index) => row(String(100000 + index), index + 1, 110 + index, 100));
  const html = matchChartsHTML(analysis(home, []), event, { compact: true });
  assert.deepEqual(totals(html), [214, 215, 216, 217, 218, 219, 220, 221, 222, 223]);
  assert.match(html, /match-charts-compact/);
  assert.match(html, /10 wcześniejszych meczów/);
  assert.equal((html.match(/<figure /g) || []).length, 1);
});

test('wrong participant or league binding prevents charts and unsupported sports stay quiet', () => {
  for (const mutate of [value => value.home.id = '3', value => value.route = 'basketball/other', value => value.fixtureId = 'basketball/nba:123456', value => value.cutoff = '2999-01-01T00:00:00.000Z']) {
    const value = analysis(); mutate(value);
    assert.deepEqual(totals(matchChartsHTML(value, event)), []);
  }
  assert.equal(matchChartsHTML(analysis(), { ...event, sport: 'nhl' }), '');
});

test('source names and invalid reference lines cannot inject SVG or invented numbers', () => {
  const label = '<img src=x onerror=alert(1)>';
  const value = analysis([row('100001', 1, 110, 100, { opponent: label })], []);
  const html = matchChartsHTML(value, { ...event, home: label }, { line: '<script>999</script>' });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img/);
  assert.ok(!html.includes('chart-reference'));
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('probability'));
  assert.deepEqual(totals(html), [210]);
});

const nhlEvent = { ...event, id: 'hockey/nhl:999999', route: 'hockey/nhl', sport: 'nhl' };
const nhlRow = (id, date, scoreFor, scoreAgainst, extra = {}) => row(id, date, scoreFor, scoreAgainst, { id: `hockey/nhl:${id}`, route: 'hockey/nhl', ...extra });
const nhlAnalysis = (home, away = []) => ({ ...analysis(home, away), sport: 'nhl', route: nhlEvent.route, fixtureId: nhlEvent.id });

test('NHL charts show exact final-score goals on a shared goal scale, recent results and team averages', () => {
  const home = [nhlRow('100002', 2, 4, 3), nhlRow('100001', 1, 0, 2)];
  const away = [nhlRow('200001', 3, 5, 3)];
  const html = matchChartsHTML(nhlAnalysis(home, away), nhlEvent, { line: 5.5 });
  assert.deepEqual(totals(html), [2, 7, 8]);
  assert.equal((html.match(/>10<\/text>/g) || []).length, 2);
  assert.equal((html.match(/data-zero-baseline="true"/g) || []).length, 2);
  assert.match(html, /Sumy goli w ostatnich meczach/);
  assert.match(html, /4:3; suma 7 goli/);
  assert.match(html, /Linia porównania: 5,5 gola/);
  assert.match(html, /Gole zdobyte \/ mecz: <b>2<\/b>/);
  assert.match(html, /stracone \/ mecz: <b>2,5<\/b>/);
  assert.match(html, /<td>02\.01<\/td><td>Test Rival<\/td><td>4:3<\/td><td>7<\/td>/);
  assert.ok(html.indexOf('<td>02.01</td>') < html.indexOf('<td>01.01</td>'));
  assert.match(html, /data-score-scope="including_overtime_shootout"/);
  assert.match(html, /Wygrana w serii karnych dodaje jeden gol/);
  assert.match(html, /Nie są to wyniki po 60 minutach/);
  assert.ok(!html.includes('punktów'));
});

test('NHL chart excludes tied, missing, implausible, target and future scores rather than inventing a goal', () => {
  const rows = [nhlRow('100001', 1, 3, 2), nhlRow('100002', 2, 2, 2), nhlRow('100003', 3, 31, 2),
    nhlRow('100004', 4, 1, 2), nhlRow('999999', 5, 4, 3), nhlRow('100005', 6, 5, 2, { date: nhlEvent.date })];
  delete rows[3].scoreFor;
  assert.deepEqual(totals(matchChartsHTML(nhlAnalysis(rows), nhlEvent)), [5]);
});

test('NHL compact goal charts keep settlement visible and scale expands for high actual totals', () => {
  const value = nhlAnalysis([nhlRow('100001', 1, 8, 5)]);
  const html = matchChartsHTML(value, nhlEvent, { compact: true });
  assert.deepEqual(totals(html), [13]);
  assert.match(html, />14<\/text>/);
  assert.match(html, /Oficjalne wyniki końcowe z dogrywką i karnymi/);
  assert.ok(!html.includes('<table>'));
  assert.deepEqual(totals(matchChartsHTML(value, { ...nhlEvent, homeId: '3' })), []);
});

const footballEvent = { ...event, id: 'soccer/eng.1:999999', route: 'soccer/eng.1', sport: 'football' };
const footballRow = (id, at, scored, conceded, extra = {}) => row(id, at, scored, conceded, {
  id: `soccer/eng.1:${id}`, route: 'soccer/eng.1', scoreScope: 'regulation_90', regulationOnly: true, ...extra,
});
const footballAnalysis = (home, away = []) => ({ ...analysis(home, away), sport: 'football', route: footballEvent.route, fixtureId: footballEvent.id, resultScope: 'regulation_90' });

test('football goal charts keep 0:0 and 2:2, exact goal values and a shared zero-based goal scale', () => {
  const value = footballAnalysis([footballRow('100002', 2, 2, 2), footballRow('100001', 1, 0, 0)], [footballRow('200001', 3, 3, 1)]);
  const html = matchChartsHTML(value, footballEvent, { line: 2.5 });
  assert.deepEqual(totals(html), [0, 4, 4]);
  assert.equal((html.match(/data-zero-baseline="true"/g) || []).length, 2);
  assert.equal((html.match(/>6<\/text>/g) || []).length, 2);
  assert.match(html, /data-total="0"[^>]*><rect[^>]*height="0"/);
  assert.match(html, /0:0; suma 0 goli/);
  assert.match(html, /2:2; suma 4 goli/);
  assert.match(html, /Wynik po 90 minutach/);
  assert.match(html, /90 minutach z doliczonym czasem, bez dogrywki i karnych/);
  assert.match(html, /Gole zdobyte \/ mecz: <b>1<\/b>/);
  assert.match(html, /data-score-scope="regulation_90"/);
  assert.doesNotMatch(html, /punktów|Wygrana w serii karnych|po 60 minutach/);
});

test('football charts require verified 90-minute scope and ignore unknown, extra-time and future rows', () => {
  const valid = footballRow('100001', 1, 0, 0);
  const unknown = footballRow('100002', 2, 1, 1); delete unknown.scoreScope; delete unknown.regulationOnly;
  const records = [valid, unknown, footballRow('100003', 3, 2, 2, { scoreScope: 'including_overtime' }),
    footballRow('100004', 4, 3, 1, { regulationOnly: false }), footballRow('100005', 5, 31, 1),
    footballRow('999999', 6, 1, 0), footballRow('100006', 7, 2, 1, { date: footballEvent.date })];
  assert.deepEqual(totals(matchChartsHTML(footballAnalysis(records), footballEvent)), [0]);
  for (const scope of [undefined, 'including_overtime', 'including_overtime_shootout']) {
    assert.deepEqual(totals(matchChartsHTML({ ...footballAnalysis([valid]), resultScope: scope }, footballEvent)), []);
    assert.equal(matchChartsHTML({ ...footballAnalysis([valid]), resultScope: scope }, footballEvent, { compact: true }), '');
  }
  assert.equal(matchChartsHTML(footballAnalysis([valid]), { ...footballEvent, route: 'soccer/unknown' }), '');
});

test('football scope markers support proven MLS and separate-source Poland identities without inventing unknown results', () => {
  const fixture = { ...footballEvent, id: 'soccer/pol.1:tsdb-999999', route: 'soccer/pol.1', homeId: 'tsdb-1', awayId: 'tsdb-2' };
  const records = [footballRow('100001', 1, 0, 0, { id: 'soccer/pol.1:tsdb-100001', route: fixture.route }),
    footballRow('100002', 2, 2, 1, { id: 'soccer/pol.1:tsdb-100002', route: fixture.route })];
  for (const record of records) { delete record.scoreScope; delete record.regulationOnly; }
  const value = { ...footballAnalysis(records), route: fixture.route, fixtureId: fixture.id,
    home: { id: fixture.homeId, recent: records }, away: { id: fixture.awayId, recent: [] } };
  assert.deepEqual(totals(matchChartsHTML(value, fixture)), [0, 3]);
  assert.deepEqual(totals(matchChartsHTML({ ...value, resultScope: undefined }, fixture)), []);
  records[1].scoreScope = 'including_overtime';
  assert.deepEqual(totals(matchChartsHTML(value, fixture)), [0]);
  const mls = { ...footballEvent, id: 'soccer/usa.1:999999', route: 'soccer/usa.1' };
  const mlsRows = [footballRow('100001', 1, 1, 1, { id: 'soccer/usa.1:100001', route: mls.route })];
  delete mlsRows[0].scoreScope; delete mlsRows[0].regulationOnly;
  assert.deepEqual(totals(matchChartsHTML({ ...footballAnalysis(mlsRows), route: mls.route, fixtureId: mls.id }, mls)), [2]);
});
