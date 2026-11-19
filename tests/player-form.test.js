import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePlayerForm, buildPlayerForm, selectPreviousMatches, createSummaryLoader } from '../src/server/player-form.js';
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
const bound = (data, game) => ({ ...data, header: { id: game.sourceEventId, competitions: [{ id: game.sourceEventId, date: game.startTime, status: { type: { state: 'post', completed: true } }, competitors: [{ id: game.homeId, homeAway: 'home' }, { id: game.awayId, homeAway: 'away' }] }] } });
const record = (id, data) => ({ match: match(id, Number(id.slice(-1)) || 1), data, url: `https://site.api.espn.com/summary?event=${id}` });

test('player form selects only the latest two available completed games of the requested team and league', () => {
  const records = [match('100001', 1), match('100007', 7), match('100006', 6, { homeId: '3', awayId: '1' }),
    match('100009', 9), match('100011', 11), match('100008', 8, { route: 'hockey/nhl' }),
    match('100005', 5, { homeId: '8', awayId: '9' }), match('100004', 4, { status: 'in' }), match('100007', 7)];
  assert.deepEqual(selectPreviousMatches(records, query).map(e => e.sourceEventId), ['100007', '100006']);
  assert.equal(selectPreviousMatches(records, { ...query, count: 1 }).length, 1);
  assert.throws(() => selectPreviousMatches(records, { ...query, count: 11 }));
  assert.throws(() => selectPreviousMatches(records, { ...query, count: 0 }));
});

test('player averages have independent metric samples, retain actual zero and deduplicate repeated groups and games', () => {
  const first = category([athlete('10', 'Player A', ['20', '-', '0'])]);
  const records = [record('100007', summary([group('1', [first, first]), group('2', [category([athlete('90', 'Other Team', ['100', '9', '9'])])])])),
    record('100006', summary([group('1', [category([athlete('10', 'Player A', ['30', '5', '10'])])])]))];
  records.push(records[0]);
  const result = aggregatePlayerForm(records, query);
  assert.equal(result.players.length, 1);
  assert.equal(result.players[0].games, 2);
  assert.equal(result.players[0].metrics.PTS.average, 25);
  assert.equal(result.players[0].metrics.PTS.sample, 2);
  assert.equal(result.players[0].metrics.PTS.median, 25);
  assert.equal(result.players[0].metrics.PTS.last5Average, 25);
  assert.deepEqual(result.players[0].metrics.PTS.observations.map(row => row.value), [20, 30]);
  assert.equal(result.players[0].metrics.AST.average, 5);
  assert.equal(result.players[0].metrics.AST.sample, 1);
  assert.equal(result.players[0].metrics.REB.average, 5);
  assert.equal(result.players[0].metrics.REB.sample, 2);
  assert.equal(result.players[0].metrics.REB.minimum, 0);
  assert.equal(result.players[0].metrics.REB.maximum, 10);
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
  assert.equal(result.players[0].metrics.AST.average, 2);
  assert.equal(result.players[0].metrics.AST.sample, 1);
  const repeatedLabels = summary([group('1', [category([athlete('10', 'Player A', ['20', '21', '2'])], ['PTS', 'POINTS', 'AST'])])]);
  const conflict = aggregatePlayerForm([record('100007', repeatedLabels)], query);
  assert.equal(conflict.conflicts, 1);
  assert.equal(conflict.players[0].metrics.PTS, undefined);
});

test('each sport uses its own recognized metric definitions without inferring goals from saves', () => {
  const records = [record('100007', summary([group('1', [category([athlete('10', 'Player A', ['2', '1', '4'])], ['G', 'A', 'S'])])]))];
  const nhl = aggregatePlayerForm(records, { ...query, sport: 'nhl' });
  assert.equal(nhl.primaryMetric, 'G');
  assert.equal(nhl.players[0].metrics.S.average, 4);
  const football = aggregatePlayerForm([record('100008', summary([group('1', [category([athlete('10', 'Player A', ['0', '1', '3'])], ['G', 'A', 'SH'])])]))], { ...query, sport: 'football' });
  assert.equal(football.players[0].metrics.G.average, 0);
  assert.equal(football.players[0].metrics.SH.average, 3);
  const goalkeepers = aggregatePlayerForm([record('100008', summary([group('1', [category([athlete('10', 'Keeper', ['3', '4'])], ['GA', 'SV'])])]))], { ...query, sport: 'nhl' });
  assert.equal(goalkeepers.players.length, 0);
});

test('NHL shots use semantic source keys and never mistake shootout goals for a second shot count', () => {
  const skaters = { keys: ['goals', 'assists', 'shotsTotal', 'shootoutGoals', 'shotsMissed'],
    labels: ['G', 'A', 'S', 'SOG', 'SM'], athletes: [athlete('10', 'Skater', ['2', '1', '4', '0', '1'])] };
  const parse = categories => aggregatePlayerForm([record('100007', summary([group('1', categories)]))], { ...query, sport: 'nhl' });
  const result = parse([skaters]);
  assert.equal(result.conflicts, 0);
  assert.equal(result.players[0].metrics.S.average, 4);
  assert.equal(result.players[0].metrics.S.sample, 1);
  assert.equal(result.players[0].metrics.G.average, 2);
  const second = structuredClone(skaters); second.athletes[0].stats[2] = '5';
  const conflicting = parse([skaters, second]);
  assert.equal(conflicting.conflicts, 1);
  assert.equal(conflicting.players[0].metrics.S, undefined);
  assert.equal(conflicting.players[0].metrics.G.average, 2);
  for (const change of [{ keys: ['goals', 'assists', 'shootoutGoals'] }, {}, { keys: ['goals'] }]) {
    const ambiguous = { labels: ['G', 'A', 'SOG'], athletes: [athlete('10', 'Skater', ['2', '1', '4'])], ...change };
    assert.equal(parse([ambiguous]).players[0].metrics.S, undefined);
  }
  const explicit = { keys: ['goals', 'assists', 'shotsOnGoal'], labels: ['G', 'A', 'SOG'], athletes: [athlete('10', 'Skater', ['2', '1', '4'])] };
  assert.equal(parse([explicit]).players[0].metrics.S.average, 4);
});

test('up to ten observed leaders are returned and names break score ties deterministically', () => {
  const players = Array.from({ length: 9 }, (_, index) => athlete(String(100 + index), `Player ${index}`, [String(index), '0', '0']));
  const result = aggregatePlayerForm([record('100007', summary([group('1', [category(players)])]))], query);
  assert.equal(result.players.length, 9);
  assert.deepEqual(result.players.map(p => p.metrics.PTS.average), [8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('partial upstream failure returns real available observations with explicit coverage and errors', async () => {
  const urls = [];
  const result = await buildPlayerForm([match('100007', 7), match('100006', 6), match('100005', 5)], query, {
    fetchSummary: async url => { urls.push(url); if (url.endsWith('100006')) throw new Error('upstream'); return bound(summary([group('1', [category([athlete('10', 'Player A', ['20', '2', '4'])])])]), match(new URL(url).searchParams.get('event'), Number(new URL(url).searchParams.get('event').slice(-1)))); },
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
  const result = await buildPlayerForm([match('100007', 7)], query, { fetchSummary: async () => bound(summary([group('2', [category([athlete('99', 'Wrong Team', ['70', '4', '3'])])])]), match('100007', 7)) });
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
  const result = await buildPlayerForm([match('100007', 7)], query, { fetchSummary: async () => bound(data, match('100007', 7)) });
  assert.equal(result.status, 'partial');
  assert.equal(result.players[0].metrics.PTS.average, 12);
  const missing = await buildPlayerForm([match('100007', 7)], query, { fetchSummary: async () => bound(summary([null]), match('100007', 7)) });
  assert.equal(missing.status, 'unavailable');
});

function response() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
test('player API rejects invalid input, future dates and non-GET before reading history', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network'); });
  for (const change of [{ route: 'https://other.example/' }, { teamId: ['1', '2'] }, { teamId: 'abc' }, { count: '11' }, { cutoff: '2099-01-01T00:00:00.000Z' }, { cutoff: '2026-02-30T00:00:00.000Z' }]) {
    const res = response(); await playerForm({ method: 'GET', query: { ...query, count: '2', ...change } }, res);
    assert.equal(res.statusCode, 400);
  }
  const res = response(); await playerForm({ method: 'POST', query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
  assert.equal(fetch.mock.callCount(), 0);
});


test('ten-game form exposes real observations and missing appearances stay missing', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => match(String(100000 + index), index + 1));
  const expanded = { ...query, cutoff: '2026-02-01T00:00:00.000Z' };
  delete expanded.count;
  const result = await buildPlayerForm(rows, expanded, {
    fetchSummary: async url => {
      const index = Number(new URL(url).searchParams.get('event')) - 100000;
      const main = athlete('10', 'Player A', [String(index), '2', '4', '32:30']);
      const second = athlete('11', 'Player B', ['10', '1', '1', index >= 10 ? '0:00' : '20:00']);
      return bound(summary([group('1', [category([main, second], ['PTS', 'AST', 'REB', 'MIN'])])]), rows[index]);
    },
  });
  assert.equal(result.requestedMatches, 10);
  assert.equal(result.successfulMatches, 10);
  assert.equal(result.attemptedMatches.length, 10);
  const main = result.players.find(player => player.id === '10');
  const metric = main.metrics.PTS;
  assert.equal(metric.sample, 10);
  assert.deepEqual(metric.observations.map(row => row.value), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal(metric.average, 6.5);
  assert.equal(metric.median, 6.5);
  assert.equal(metric.last5Average, 9);
  assert.equal(main.minutes.average, 32.5);
  assert.equal(main.minutes.sample, 10);
  assert.equal(result.players.find(player => player.id === '11').games, 8);
});

test('ten-game fetches remain bounded to three upstream requests at a time', async () => {
  let active = 0, maximum = 0;
  const rows = Array.from({ length: 10 }, (_, index) => match(String(110000 + index), index + 1));
  const result = await buildPlayerForm(rows, { ...query, count: 10, cutoff: '2026-02-01T00:00:00.000Z' }, {
    fetchSummary: async url => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return bound(summary([group('1', [category([athlete('10', 'Player A', ['20', '2', '4'])])])]), rows.find(row => row.sourceEventId === new URL(url).searchParams.get('event')));
    },
  });
  assert.equal(maximum, 3);
  assert.equal(result.successfulMatches, 10);
});

test('a source header cannot bind statistics from a different match, date or participant', async () => {
  const game = match('100007', 7);
  const valid = () => ({ ...summary([group('1', [category([athlete('10', 'Player A', ['20', '2', '4'])])])]),
    header: { id: game.sourceEventId, competitions: [{ id: game.sourceEventId, date: game.startTime,
      status: { type: { state: 'post', completed: true } }, competitors: [{ id: '1', homeAway: 'home' }, { id: '2', homeAway: 'away' }] }] } });
  const accepted = await buildPlayerForm([game], { ...query, count: 1 }, { fetchSummary: async () => valid() });
  assert.equal(accepted.status, 'available');
  for (const mutate of [
    value => value.header.id = '999999',
    value => value.header.competitions[0].date = '2026-01-08T12:00:00.000Z',
    value => value.header.competitions[0].competitors[1].id = '3',
    value => value.header.competitions[0].status.type.completed = false,
    value => value.header.competitions[0].competitors[0] = null,
    value => delete value.header.id,
    value => delete value.header.competitions[0].status,
    value => value.header.competitions.push(structuredClone(value.header.competitions[0])),
  ]) {
    const data = valid(); mutate(data);
    const result = await buildPlayerForm([game], { ...query, count: 1 }, { fetchSummary: async () => data });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.players.length, 0);
    assert.equal(result.errors.length, 1);
  }
});

test('shared boxscore loader coalesces duplicates, bounds requests and retries failures or expired data', async () => {
  let stamp = 0, calls = 0, active = 0, maximum = 0;
  const url = id => `https://site.api.espn.com/apis/site/v2/sports/${route}/summary?event=${id}`;
  const load = createSummaryLoader({ clock: () => stamp, ttl: 100, fetchImpl: async input => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    const id = new URL(input).searchParams.get('event');
    if (id === '100005' && calls < 7) throw new Error('temporary');
    return bound(summary([group('1', [category([athlete('10', 'Player A', ['20', '2', '4'])])])]), match(id, 1));
  } });
  await Promise.all([load(url('100001')), load(url('100001')), load(url('100002')), load(url('100003')), load(url('100004'))]);
  assert.equal(calls, 4);
  assert.equal(maximum, 3);
  await load(url('100001')); assert.equal(calls, 4);
  await assert.rejects(load(url('100005'))); await assert.rejects(load(url('100005')));
  await load(url('100005')); assert.equal(calls, 7);
  stamp = 101; await load(url('100001')); assert.equal(calls, 8);
  let empties = 0;
  const missing = createSummaryLoader({ fetchImpl: async () => { empties++; return {}; } });
  await missing('missing'); await missing('missing');
  assert.equal(empties, 2);
});

test('anonymous boxscores cannot become public player observations or cached source evidence', async () => {
  const game = match('100007', 7);
  const anonymous = summary([group('1', [category([athlete('10', 'Player A', ['20', '2', '4'])])])]);
  const result = await buildPlayerForm([game], { ...query, count: 1 }, { fetchSummary: async () => anonymous });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.successfulMatches, 0);
  assert.deepEqual(result.players, []);
  assert.equal(result.errors.length, 1);
  let calls = 0;
  const load = createSummaryLoader({ fetchImpl: async () => { calls++; return anonymous; } });
  await load('https://site.api.espn.com/summary?event=100007');
  await load('https://site.api.espn.com/summary?event=100007');
  assert.equal(calls, 2);
});


test('an explicit DNP vetoes statistics for the same player across duplicate source categories', () => {
  const played = category([athlete('10', 'Player A', ['20', '2', '4'])]);
  const didNotPlay = category([athlete('10', 'Player A', undefined, { didNotPlay: true })]);
  for (const categories of [[played, didNotPlay], [didNotPlay, played]]) {
    const result = aggregatePlayerForm([record('100007', summary([group('1', categories)]))], query);
    assert.deepEqual(result.players, []);
    assert.equal(result.sampledMatches.length, 0);
  }
  const wrongTeamDNP = category([athlete('10', 'Player A', undefined, { didNotPlay: true, athlete: { id: '10', displayName: 'Player A', team: { id: '2' } } })]);
  const bound = aggregatePlayerForm([record('100007', summary([group('1', [played, wrongTeamDNP]), group('2', [didNotPlay])]))], query);
  assert.equal(bound.players[0].games, 1);
  assert.equal(bound.players[0].metrics.PTS.average, 20);
});
