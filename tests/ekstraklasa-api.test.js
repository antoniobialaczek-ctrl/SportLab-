import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ekstraklasaDayURL, normalizeEkstraklasaResponse } from '../src/server/ekstraklasa-source.js';

const DAY = 86400000;
const response = () => ({ statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
async function call(handler, query) {
  const res = response();
  await handler({ method: 'GET', query }, res);
  return res;
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function sourceRow(date, extra = {}) {
  return { idEvent: '2490318', idLeague: '4422', strSport: 'Soccer', strHomeTeam: 'Test Home', strAwayTeam: 'Test Away',
    idHomeTeam: '135300', idAwayTeam: '135298', strTimestamp: date.replace('Z', ''), dateEvent: date.slice(0, 10),
    strTime: date.slice(11, 19), strStatus: 'NS', strPostponed: 'no', intHomeScore: null, intAwayScore: null, ...extra };
}
async function isolatedAPIs(t, files = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sportlab-ekstraklasa-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    cp(new URL('../api/', import.meta.url), join(directory, 'api'), { recursive: true }),
    cp(new URL('../src/', import.meta.url), join(directory, 'src'), { recursive: true }),
    writeFile(join(directory, 'package.json'), '{"type":"module"}'),
  ]);
  for (const [path, data] of Object.entries(files)) {
    const destination = join(directory, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, JSON.stringify(data));
  }
  const names = ['scores', 'details', 'player-form', 'match-analysis', 'analysis'];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, (await import(pathToFileURL(join(directory, 'api', `${name}.js`)))).default])));
}

test('Ekstraklasa scores, details and unsupported player statistics stay bound to TheSportsDB without ESPN requests', async t => {
  const api = await isolatedAPIs(t);
  let clock = Date.now();
  const kickoff = new Date(clock + 27 * 3600000);
  kickoff.setUTCMinutes(0, 0, 0);
  if (kickoff.getUTCHours() === 0) kickoff.setUTCHours(1);
  const date = kickoff.toISOString(), day = date.slice(0, 10), row = sourceRow(date);
  const requests = [];
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    requests.push(url.href);
    assert.equal(url.origin, 'https://www.thesportsdb.com');
    if (url.pathname.endsWith('/eventsday.php')) {
      assert.equal(url.searchParams.get('d'), day); assert.equal(url.searchParams.get('l'), '4422');
    } else {
      assert.ok(url.pathname.endsWith('/lookupevent.php')); assert.equal(url.searchParams.get('id'), row.idEvent);
    }
    return json({ events: [row] });
  });
  const scores = await call(api.scores, { sport: 'football', league: 'pol.1', date: day.replaceAll('-', '') });
  assert.equal(scores.statusCode, 200); assert.equal(scores.body.errors.length, 0);
  assert.equal(scores.body.events.length, 1); assert.equal(scores.body.source, 'TheSportsDB');
  const fixture = scores.body.events[0];
  assert.equal(fixture.id, 'soccer/pol.1:tsdb-2490318'); assert.equal(fixture.sourceEventId, 'tsdb-2490318');
  assert.equal(fixture.homeId, 'tsdb-135300'); assert.equal(fixture.awayId, 'tsdb-135298');
  assert.equal(fixture.date, date); assert.equal(fixture.forecast.status, 'withheld');
  assert.equal(scores.body.coverage['soccer/pol.1'].complete, false);

  // Advance the queue's clock instead of waiting through the production pacing.
  clock += 60000;
  const details = await call(api.details, { sport: 'football', route: fixture.route, id: fixture.sourceEventId });
  assert.equal(details.statusCode, 200); assert.equal(details.body.source, 'TheSportsDB');
  assert.equal(details.body.odds.fixtureId, fixture.id); assert.equal(details.body.odds.startTime, fixture.date);
  assert.equal(details.body.odds.status, 'unavailable'); assert.deepEqual(details.body.odds.quotes, []);
  assert.equal(details.body.availability.identityVerified, false); assert.deepEqual(details.body.players, []);

  const players = await call(api['player-form'], { sport: 'football', route: fixture.route, teamId: fixture.homeId, cutoff: new Date(clock - 60000).toISOString() });
  assert.equal(players.statusCode, 200); assert.equal(players.body.teamId, fixture.homeId);
  assert.equal(players.body.status, 'unavailable'); assert.deepEqual(players.body.players, []);
  assert.match(players.body.reason, /nie udostępnia statystyk zawodników/);
  assert.equal(requests.length, 2); assert.ok(requests.every(url => !url.includes('espn.com')));
});

test('mixed ESPN and TheSportsDB identifiers are rejected before any source access', async t => {
  const api = await isolatedAPIs(t);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Invalid namespace must not reach a source'); });
  for (const [handler, query] of [
    [api.details, { sport: 'football', route: 'soccer/pol.1', id: '2490318' }],
    [api.details, { sport: 'nba', route: 'basketball/nba', id: 'tsdb-2490318' }],
    [api['player-form'], { sport: 'football', route: 'soccer/pol.1', teamId: '135300' }],
    [api['player-form'], { sport: 'nba', route: 'basketball/nba', teamId: 'tsdb-135300' }],
    [api['match-analysis'], { sport: 'football', route: 'soccer/pol.1', homeId: 'tsdb-135300', awayId: '135298' }],
    [api['match-analysis'], { sport: 'football', route: 'soccer/pol.1', homeId: 'tsdb-135300', awayId: 'tsdb-135298', fixtureId: 'soccer/pol.1:2490318' }],
    [api.analysis, { sport: 'football', route: 'soccer/pol.1', participantId: '135300' }],
  ]) {
    const res = await call(handler, query);
    assert.equal(res.statusCode, 400, JSON.stringify(query)); assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('Ekstraklasa match analysis uses actual first observation and cannot backdate newly acquired results', async t => {
  const now = Date.now(), observedAt = new Date(now - 120000).toISOString();
  const kickoff = new Date(now - 10 * DAY); kickoff.setUTCHours(17, 0, 0, 0);
  const start = kickoff.toISOString(), day = start.slice(0, 10);
  const history = normalizeEkstraklasaResponse({ events: [sourceRow(start, { strStatus: 'FT', intHomeScore: '2', intAwayScore: '1' })] },
    { day, sourceURL: ekstraklasaDayURL(day), observedAt }).history;
  assert.equal(history[0].resultAvailableAt, observedAt);
  const snapshot = { schemaVersion: 1, kind: 'supplemental-descriptive-history', sport: 'football', route: 'soccer/pol.1',
    fetchedAt: observedAt, modelExperimentEligible: false, events: history, coverage: { complete: false } };
  const oldRemote = process.env.SPORTLAB_REMOTE_DATA;
  process.env.SPORTLAB_REMOTE_DATA = '0';
  t.after(() => { if (oldRemote === undefined) delete process.env.SPORTLAB_REMOTE_DATA; else process.env.SPORTLAB_REMOTE_DATA = oldRemote; });
  const api = await isolatedAPIs(t, { 'data/supplemental/ekstraklasa.json': snapshot });
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Isolated history must not request a source'); });
  const query = { sport: 'football', route: 'soccer/pol.1', homeId: 'tsdb-135300', awayId: 'tsdb-135298', fixtureId: 'soccer/pol.1:tsdb-2490999' };
  const current = await call(api['match-analysis'], { ...query, cutoff: new Date(now - 1000).toISOString() });
  assert.equal(current.statusCode, 200); assert.equal(current.body.status, 'available');
  assert.equal(current.body.home.sample, 1); assert.equal(current.body.away.sample, 1);
  assert.equal(current.body.home.recent[0].scoreFor, 2); assert.equal(current.body.away.recent[0].scoreFor, 1);
  assert.equal(current.body.source, 'TheSportsDB'); assert.equal(current.body.modelExperimentEligible, false);
  assert.equal(current.body.home.probability, undefined);

  // This cutoff is after the old match's conservative24h proxy but before
  // anyone in SportLab actually observed the newly connected source.
  const historical = await call(api['match-analysis'], { ...query, cutoff: new Date(kickoff.valueOf() + 2 * DAY).toISOString() });
  assert.equal(historical.statusCode, 200); assert.equal(historical.body.status, 'unavailable');
  assert.equal(historical.body.home.sample, 0); assert.equal(historical.body.away.sample, 0);
  assert.deepEqual(historical.body.home.recent, []); assert.deepEqual(historical.body.away.recent, []);
  assert.equal(fetch.mock.callCount(), 0);
});
