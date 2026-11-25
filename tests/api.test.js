import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import scores from '../api/scores.js';
import details from '../api/details.js';
import model from '../api/model.js';
import analysis from '../api/analysis.js';
import { liveEvents } from '../src/server/scores.js';
import { analyzePlayers, summarizeParticipant } from '../src/server/analysis.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function request(handler, query = {}, method = 'GET') {
  const res = response();
  await handler({ method, query }, res);
  return res;
}

const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fixture = ({ id = '401234567', date = '2026-01-01T18:00:00Z', state = 'post' } = {}) => ({
  events: [{ id, date, status: { type: { state } }, competitions: [{
    id, date, status: { type: { state, detail: 'Final' } },
    competitors: [
      { id: '1', homeAway: 'home', score: '2', team: { displayName: 'Drużyna testowa A' } },
      { id: '2', homeAway: 'away', score: '1', team: { displayName: 'Drużyna testowa B' } },
    ],
  }] }],
});

async function isolatedAPI(t, name, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-api-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'public'), { recursive: true });
  await Promise.all([
    cp(new URL('../api/', import.meta.url), join(root, 'api'), { recursive: true }),
    cp(new URL('../src/', import.meta.url), join(root, 'src'), { recursive: true }),
    cp(new URL('../public/football-portraits.js', import.meta.url), join(root, 'public/football-portraits.js')),
    writeFile(join(root, 'package.json'), '{"type":"module"}'),
  ]);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return (await import(pathToFileURL(join(root, 'api', `${name}.js`)))).default;
}

function historical(id, day, overrides = {}) {
  return {
    id: `basketball/nba:${id}`, sourceEventId: id, sport: 'nba', league: 'nba', route: 'basketball/nba', season: '2025',
    startTime: `2026-01-${day}T12:00:00.000Z`, resultAvailableAt: `2026-01-${String(Number(day) + 1).padStart(2, '0')}T12:00:00.000Z`,
    availabilityBasis: 'conservative-24h', homeId: '1', awayId: '2', home: 'Drużyna testowa A', away: 'Drużyna testowa B',
    homeScore: 100, awayScore: 90, neutralSite: false, status: 'completed',
    source: { provider: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20260101', fetchedAt: '2026-02-01T00:00:00.000Z' },
    ...overrides,
  };
}

test('każde API odrzuca metody inne niż GET przed dostępem do źródeł', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Źródło nie powinno być wywołane'); });
  for (const handler of [scores, details, model, analysis]) {
    const res = await request(handler, {}, 'POST');
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET');
    assert.match(res.body.error, /GET/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('nieprawidłowe daty, ligi, tablice parametrów i obce trasy kończą się 400 bez pobierania', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Niedozwolone pobranie'); });
  const invalid = [
    [scores, { sport: 'nba', date: '20260230' }],
    [scores, { sport: 'toString', date: '20260101' }],
    [scores, { sport: ['nba', 'nhl'], date: '20260101' }],
    [scores, { sport: 'nba', league: 'eng.1', date: '20260101' }],
    [details, { sport: 'nba', route: 'soccer/eng.1', id: '401234567' }],
    [details, { sport: 'nba', route: 'https://example.com', id: '401234567' }],
    [details, { sport: 'nba', id: '../401234567' }],
    [model, { sport: ['nba', 'football'] }],
    [model, { sport: 'unknown' }],
    [analysis, { sport: 'nba', route: 'basketball/nba', participantId: '../1' }],
    [analysis, { sport: 'nba', route: 'basketball/nba', participantId: '1', cutoff: '2999-01-01T00:00:00Z' }],
    [analysis, { sport: 'nba', route: 'basketball/nba', participantId: '1', cutoff: '2026-02-30T00:00:00Z' }],
    [analysis, { sport: 'nba', route: 'basketball/nba', participantId: '1', cutoff: '2026-01-01T00:00:00+02:00' }],
  ];
  for (const [handler, query] of invalid) {
    const res = await request(handler, query);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('brak wiarygodnego źródła CS2 jest jawny i nie uruchamia pobrań', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('CS2 nie ma źródła'); });
  const res = await request(scores, { sport: 'cs2', date: '20260101' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.events, []);
  assert.equal(res.body.source, 'none');
  assert.match(res.body.errors[0], /brak podłączonego/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('awaria wszystkich źródeł jest błędem 502, a nie pustą listą pozornie aktualnych meczów', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  const res = await request(scores, { sport: 'nba', date: '20260101' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.body.error, /niedostępne/);
  assert.equal(res.body.events, undefined);
});

test('częściowa awaria lig zachowuje wyniki i ostrzeżenie oraz wyłącza cache odpowiedzi częściowej', async t => {
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('/soccer/esp.1/')
    ? new Response('', { status: 404 }) : json(fixture()));
  const res = await request(scores, { sport: 'football', date: '20260101' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.events.length > 0);
  assert.equal(res.body.errors.length, 2);
  assert.ok(res.body.errors.some(error => /soccer\/esp\.1/.test(error)));
  assert.ok(res.body.errors.some(error => /soccer\/pol\.1/.test(error)));
  assert.equal(res.headers['cache-control'], 'no-store');
  for (const event of res.body.events) {
    assert.equal(event.forecast.status, 'withheld');
    assert.equal(event.forecast.probability, undefined);
    assert.notEqual(event.route, 'soccer/esp.1');
  }
});

test('normalizacja wyników zachowuje drużyny, trasę i niezależny identyfikator meczu', () => {
  const rows = liveEvents(fixture(), { sport: 'football', route: 'soccer/eng.1', date: '2026-01-01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'soccer/eng.1:401234567');
  assert.equal(rows[0].sourceEventId, '401234567');
  assert.equal(rows[0].home, 'Drużyna testowa A');
  assert.equal(rows[0].awayId, '2');
  assert.equal(rows[0].homeScore, '2');
  assert.equal(rows[0].forecast.status, 'withheld');
  assert.throws(() => liveEvents({}, { sport: 'nba', route: 'basketball/nba', date: '2026-01-01' }), /odpowiedź/);
  const malformed = fixture();
  malformed.events[0].competitions[0].date = 'invalid';
  assert.deepEqual(liveEvents(malformed, { sport: 'nba', route: 'basketball/nba', date: '2026-01-01' }), []);
});

test('tenis rozdziela pojedyncze mecze turnieju, pomija deble i daty spoza wskazanego dnia', () => {
  const match = fixture().events[0].competitions[0];
  for (const competitor of match.competitors) {
    competitor.athlete = { displayName: competitor.team.displayName }; delete competitor.team;
    competitor.linescores = [{ winner: true }, { winner: competitor.homeAway === 'home' }];
  }
  const data = { events: [{ groupings: [
    { grouping: { slug: 'mens-singles' }, competitions: [match, { ...match, id: '401234568', date: '2026-01-02T18:00:00Z' }] },
    { grouping: { slug: 'mens-doubles' }, competitions: [{ ...match, id: '401234569' }] },
  ] }] };
  const rows = liveEvents(data, { sport: 'tennis', route: 'tennis/atp', date: '2026-01-01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'tennis/atp:401234567');
  assert.equal(rows[0].homeScore, 2);
  assert.equal(rows[0].awayScore, 1);
});

test('niekompletne lub sprzeczne tożsamości uczestników i meczu są pomijane', () => {
  for (const mutate of [
    match => { delete match.id; },
    match => { match.id = 'undefined'; },
    match => { delete match.competitors[0].id; },
    match => { match.competitors[1].id = match.competitors[0].id; },
    match => { match.competitors.push({ ...match.competitors[0], id: '3' }); },
  ]) {
    const data = fixture(); mutate(data.events[0].competitions[0]);
    assert.deepEqual(liveEvents(data, { sport: 'nba', route: 'basketball/nba', date: '2026-01-01' }), []);
  }
});

test('brak wyników setowych tenisa pozostaje brakiem danych, nie zerem', () => {
  const match = fixture({ state: 'pre' }).events[0].competitions[0];
  const data = { events: [{ groupings: [{ grouping: { slug: 'mens-singles' }, competitions: [match] }] }] };
  const rows = liveEvents(data, { sport: 'tennis', route: 'tennis/atp', date: '2026-01-01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].homeScore, null);
  assert.equal(rows[0].awayScore, null);
});

test('szczegóły odróżniają brak meczu od awarii źródła', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}));
  const query = { sport: 'nba', id: '401234567' };
  assert.equal((await request(details, query)).statusCode, 404);
  fetch.mock.mockImplementation(async () => new Response('', { status: 404 }));
  const failed = await request(details, query);
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.headers['cache-control'], 'no-store');
});

test('analiza zawodników pomija niegrających, brak statystyki i duplikaty zamiast zastępować je zerem', () => {
  const players = [
    { id: '1', name: 'Test A', team: 'A', labels: ['PTS'], stats: ['20'], didNotPlay: false },
    { id: '1', name: 'Test A', team: 'A', labels: ['PTS'], stats: ['20'], didNotPlay: false },
    { id: '2', name: 'Test B', team: 'A', labels: ['PTS'], stats: ['99'], didNotPlay: true },
    { id: '3', name: 'Test C', team: 'B', labels: ['PTS'], stats: ['—'], didNotPlay: false },
  ];
  const metrics = analyzePlayers(players, 'nba');
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].sample, 1);
  assert.equal(metrics[0].leaders[0].value, 20);
});

test('analiza zawodników wymaga całej poprawnej liczby, nie parsuje części tekstu ani nieuzasadnionych zer', () => {
  const badValues = ['12abc', '', ' ', '—', 'Infinity', 'NaN', '-2', '3/4', null, undefined];
  const players = badValues.map((value, index) => ({ id: String(index), name: `Test ${index}`, team: 'A', labels: ['PTS'], stats: [value], didNotPlay: false }));
  assert.deepEqual(analyzePlayers(players, 'nba'), []);
  players.push({ id: '100', name: 'Test Zero', team: 'A', labels: ['PTS'], stats: ['0'], didNotPlay: false });
  const [metric] = analyzePlayers(players, 'nba');
  assert.equal(metric.sample, 1);
  assert.equal(metric.leaders[0].value, 0);
});

test('brak pliku raportu blokuje prognozy dla wszystkich sportów i nie zwraca starych stałych skuteczności', async t => {
  const handler = await isolatedAPI(t, 'model');
  const res = await request(handler);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.generatedAt, null);
  assert.equal(res.body.stale, true);
  assert.deepEqual(res.body.results, []);
  assert.equal(Object.keys(res.body.sports).length, 5);
  for (const entry of Object.values(res.body.sports)) {
    assert.equal(entry.status, 'unavailable');
    assert.equal(entry.metrics, null);
    assert.equal(entry.publication.eligible, false);
  }
});

test('uszkodzony raport modeli kończy się 503 i nie jest cacheowany', async t => {
  const handler = await isolatedAPI(t, 'model', { 'data/reports/models.json': '{uszkodzony' });
  const res = await request(handler);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('analiza historyczna nie używa wyniku dostępnego dopiero w chwili odcięcia ani przyszłego meczu', async t => {
  const cutoff = '2026-01-03T12:00:00.000Z';
  const events = [historical('10001', '01'), historical('10002', '02'), historical('10003', '04')];
  const handler = await isolatedAPI(t, 'analysis', { 'data/history/nba.json': { schemaVersion: 1, updatedAt: '2026-02-01T00:00:00Z', events } });
  const res = await request(handler, { sport: 'nba', route: 'basketball/nba', participantId: '1', cutoff });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.available, true);
  assert.equal(res.body.sample, 1);
  assert.equal(res.body.wins, 1);
  assert.deepEqual(res.body.recent.map(row => row.id), ['basketball/nba:10001']);
  const empty = summarizeParticipant(events, { participantId: '1', route: 'hockey/nhl', cutoff });
  assert.equal(empty.sample, 0);
  assert.equal(empty.averageFor, null);
});

test('brak historii analizy jest jawnym brakiem danych, a uszkodzony rekord kończy się 503', async t => {
  const query = { sport: 'nba', route: 'basketball/nba', participantId: '1', cutoff: '2026-01-03T12:00:00.000Z' };
  const missing = await request(await isolatedAPI(t, 'analysis'), query);
  assert.equal(missing.statusCode, 200);
  assert.equal(missing.body.available, false);
  assert.equal(missing.body.sample, 0);
  assert.equal(missing.body.averageAgainst, null);
  const corrupt = await isolatedAPI(t, 'analysis', { 'data/history/nba.json': { schemaVersion: 1, events: [historical('10001', '01', { homeScore: null })] } });
  assert.equal((await request(corrupt, query)).statusCode, 503);
});

test('forma uczestnika uwzględnia stronę meczu i tylko ostatnie dziesięć dostępnych spotkań danej ligi', () => {
  const events = Array.from({ length: 12 }, (_, index) => historical(String(20000 + index), String(index + 1).padStart(2, '0')));
  events.push({ ...historical('30000', '13'), route: 'hockey/nhl' });
  const summary = summarizeParticipant(events, { participantId: '2', route: 'basketball/nba', cutoff: '2026-02-01T00:00:00Z' });
  assert.equal(summary.sample, 10);
  assert.equal(summary.wins, 0);
  assert.equal(summary.losses, 10);
  assert.equal(summary.averageFor, 90);
  assert.equal(summary.averageAgainst, 100);
  assert.equal(summary.recent[0].id, 'basketball/nba:20011');
  assert.equal(summary.recent.at(-1).id, 'basketball/nba:20002');
});
