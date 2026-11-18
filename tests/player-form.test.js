import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePlayerForm, buildPlayerForm, selectPreviousMatches } from '../src/server/player-form.js';
import playerForm from '../api/player-form.js';

const route = 'basketball/nba', sport = 'nba', teamId = '1', cutoff = '2026-01-10T12:00:00.000Z';
const query = { route, sport, teamId, cutoff, count: 2 };
function match(id, day, changes = {}) {
  return { id: `${route}:${id}`, sourceEventId: id, route, sport, league: 'nba', status: 'completed',
    startTime: new Date(Date.UTC(2026, 0, day, 12)).toISOString(), resultAvailableAt: new Date(Date.UTC(2026, 0, day + 1, 12)).toISOString(),
    homeId: '1', awayId: '2', home: 'Test Home', away: 'Test Away', homeScore: 100, awayScore: 90, ...changes };
}
const athlete = (id, name, stats, changes = {}) => ({ athlete: { id, displayName: name }, stats, ...changes });
const category = (athletes, labels = ['PTS', 'AST', 'REB']) => ({ labels, athletes });
const group = (id, statistics) => ({ team: { id, displayName: id === '1' ? 'Test Home' : 'Test Away' }, statistics });
const summary = (groups) => ({ boxscore: { players: groups } });
const record = (id, data) => ({ match: match(id, Number(id.slice(-1)) || 1), data, url: `https://site.api.espn.com/summary?event=${id}` });

test('player form selects only the latest two available completed games of the requested team and league', () => {
  const records = [match('100001', 1), match('100007', 7), match('100006', 6, { homeId: '3', awayId: '1' }),
    match('100009', 9), match('100011', 11), match('100008', 8, { route: 'hockey/nhl' }),
    match('100005', 5, { homeId: '8', awayId: '9' }), match('100004', 4, { status: 'in' }), match('100007', 7)];
  assert.deepEqual(selectPreviousMatches(records, query).map(e => e.sourceEventId), ['100007', '100006']);
  assert.equal(selectPreviousMatches(records, { ...query, count: 1 }).length, 1);
  assert.throws(() => selectPreviousMatches(records, { ...query, count: 3 }));
});

test('player averages have independent metric samples, retain actual zero and deduplicate repeated groups and games', () => {
  const first = category([athlete('10', 'Player A', ['20', '-', '0'])]);
  const records = [record('100007', summary([group('1', [first, first]), group('2', [category([athlete('90', 'Other Team', ['100', '9', '9'])])])])),
    record('100006', summary([group('1', [category([athlete('10', 'Player A', ['30', '5', '10'])])])]))];
  records.push(records[0]);
  const result = aggregatePlayerForm(records, query);
  assert.equal(result.players.length, 1);
  assert.equal(result.players[0].games, 2);
  assert.deepEqual(result.players[0].metrics.PTS, { label: 'Punkty', average: 25, sample: 2 });
  assert.deepEqual(result.players[0].metrics.AST, { label: 'Asysty', average: 5, sample: 1 });
  assert.deepEqual(result.players[0].metrics.REB, { label: 'Zbiórki', average: 5, sample: 2 });
  assert.equal(result.sampledMatches.length, 2);
});

test('DNP, unstable identities, unknown labels and malformed numbers cannot become player observations', () => {
  const data = summary([group('1', [category([
    athlete('11', 'DNP Player', ['99', '99', '99'], { didNotPlay: true }),
    athlete('', 'No Stable ID', ['30', '1', '2']),
    athlete('12', 'Malformed Player', ['10 points', '', null]),
    athlete('13', 'Negative Player', ['-1', 'bad', undefined]),
    athlete('14', 'Unknown Labels', ['20', '4', '3']),
  ], ['UNKNOWN', 'UNKNOWN2', 'UNKNOWN3']), category([
    athlete('11', 'DNP Player', ['99', '99', '99'], { didNotPlay: true }),
    athlete('', 'No Stable ID', ['30', '1', '2']),
    athlete('12', 'Malformed Player', ['10 points', '', null]),
    athlete('13', 'Negative Player', ['-1', 'bad', undefined]),
  ])])]);
  assert.deepEqual(aggregatePlayerForm([record('100007', data)], query).players, []);
});

test('conflicting duplicate statistics are excluded instead of silently selecting a value', () => {
  const data = summary([group('1', [category([athlete('10', 'Player A', ['20', '2', '-'])]), category([athlete('10', 'Player A', ['21', '2', '-'])])])]);
  const result = aggregatePlayerForm([record('100007', data)], query);
  assert.equal(result.conflicts, 1);
  assert.equal(result.players[0].metrics.PTS, undefined);
  assert.deepEqual(result.players[0].metrics.AST, { label: 'Asysty', average: 2, sample: 1 });
});

test('each sport uses its own recognized metric definitions without inferring goals from saves', () => {
  const records = [record('100007', summary([group('1', [category([athlete('10', 'Player A', ['2', '1', '4'])], ['G', 'A', 'SOG'])])]))];
  const nhl = aggregatePlayerForm(records, { ...query, sport: 'nhl' });
  assert.equal(nhl.primaryMetric, 'G');
  assert.equal(nhl.players[0].metrics.S.average, 4);
  const football = aggregatePlayerForm([record('100008', summary([group('1', [category([athlete('10', 'Player A', ['0', '1', '3'])], ['G', 'A', 'SH'])])]))], { ...query, sport: 'football' });
  assert.equal(football.players[0].metrics.G.average, 0);
  assert.equal(football.players[0].metrics.SH.average, 3);
  const goalkeepers = aggregatePlayerForm([record('100008', summary([group('1', [category([athlete('10', 'Keeper', ['3', '4'])], ['GA', 'SV'])])]))], { ...query, sport: 'nhl' });
  assert.equal(goalkeepers.players.length, 0);
});

test('only five observed leaders are returned and names break score ties deterministically', () => {
  const players = Array.from({ length: 9 }, (_, index) => athlete(String(100 + index), `Player ${index}`, [String(index), '0', '0']));
  const result = aggregatePlayerForm([record('100007', summary([group('1', [category(players)])]))], query);
  assert.equal(result.players.length, 5);
  assert.deepEqual(result.players.map(p => p.metrics.PTS.average), [8, 7, 6, 5, 4]);
});

test('partial upstream failure returns real available observations with explicit coverage and errors', async () => {
  const urls = [];
  const result = await buildPlayerForm([match('100007', 7), match('100006', 6), match('100005', 5)], query, {
    fetchSummary: async url => { urls.push(url); if (url.endsWith('100006')) throw new Error('upstream'); return summary([group('1', [category([athlete('10', 'Player A', ['20', '2', '4'])])])]); },
  });
  assert.equal(urls.length, 2);
  assert.equal(result.status, 'partial');
  assert.equal(result.successfulMatches, 1);
  assert.equal(result.players[0].games, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.attemptedMatches.length, 2);
  assert.match(result.note, /nie potwierdzają przyszłego składu/);
});

test('missing boxscores or the wrong team remain unavailable rather than using another roster or fake zero averages', async () => {
  const result = await buildPlayerForm([match('100007', 7)], query, { fetchSummary: async () => summary([group('2', [category([athlete('99', 'Wrong Team', ['70', '4', '3'])])])]) });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.successfulMatches, 0);
  assert.deepEqual(result.players, []);
  assert.equal(result.errors.length, 1);
});

test('empty history and tennis do not make needless boxscore requests', async () => {
  let calls = 0;
  const options = { fetchSummary: async () => { calls++; throw new Error('Should not fetch'); } };
  assert.equal((await buildPlayerForm([], query, options)).status, 'unavailable');
  const tennis = await buildPlayerForm([], { ...query, sport: 'tennis', route: 'tennis/atp' }, options);
  assert.equal(tennis.status, 'unavailable');
  assert.match(tennis.reason, /tenisistów/);
  assert.equal(calls, 0);
});

test('partially malformed nested boxscores stay an honest lack of comparable data', async () => {
  const data = summary([null, group('1', [null, { labels: ['PTS'], athletes: [null, {}, athlete('10', 'Player A', ['12'])] }])]);
  const result = await buildPlayerForm([match('100007', 7)], query, { fetchSummary: async () => data });
  assert.equal(result.status, 'partial');
  assert.equal(result.players[0].metrics.PTS.average, 12);
  const missing = await buildPlayerForm([match('100007', 7)], query, { fetchSummary: async () => summary([null]) });
  assert.equal(missing.status, 'unavailable');
});

function response() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
test('player API rejects invalid input, future dates and non-GET before reading history', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network'); });
  for (const change of [{ route: 'https://other.example/' }, { teamId: ['1', '2'] }, { teamId: 'abc' }, { count: '3' }, { cutoff: '2099-01-01T00:00:00.000Z' }, { cutoff: '2026-02-30T00:00:00.000Z' }]) {
    const res = response(); await playerForm({ method: 'GET', query: { ...query, count: '2', ...change } }, res);
    assert.equal(res.statusCode, 400);
  }
  const res = response(); await playerForm({ method: 'POST', query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
  assert.equal(fetch.mock.callCount(), 0);
});
