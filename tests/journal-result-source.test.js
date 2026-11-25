import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractJournalResult, fetchJournalResult, journalSummaryURL } from '../src/server/journal-result-source.js';
import resultsHandler from '../api/journal-results.js';

const observedAt = '2026-11-19T12:00:00.000Z';
const fixtureId = 'basketball/nba:401900001';
function sample({ sport = 'nba', route = 'basketball/nba', sourceId = '401900001' } = {}) {
  return { header: { id: sourceId, competitions: [{ id: sourceId, date: '2026-11-18T00:00Z', neutralSite: false,
    status: { type: { state: 'post', completed: true, name: sport === 'football' ? 'STATUS_FULL_TIME' : 'STATUS_FINAL', detail: 'Final' } },
    competitors: [{ id: '1', homeAway: 'home', score: sport === 'football' ? '2' : '100', team: { id: '1', displayName: 'Test Home' } },
      { id: '2', homeAway: 'away', score: sport === 'football' ? '1' : '90', team: { id: '2', displayName: 'Test Away' } }] }] },
    boxscore: { players: [{ team: { id: '1' }, statistics: [{ labels: ['MIN', 'PTS', 'AST', 'REB'], athletes: [
      { athlete: { id: '101', displayName: 'Test Player' }, stats: ['30', '20', '6', '8'], didNotPlay: false },
      { athlete: { id: '102', displayName: 'Bench Player' }, stats: ['0', '0', '0', '0'], didNotPlay: true },
      { athlete: { id: '103', displayName: 'Unknown Minutes' }, stats: ['—', '0', '0', '0'], didNotPlay: false },
    ] }] }] } };
}
const extract = (data = sample(), extra = {}) => extractJournalResult(data, { sport: 'nba', fixtureId, observedAt, ...extra });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('final summary proves exact fixture and actual score; player values include only proved appearances', () => {
  const row = extract();
  assert.equal(row.id, fixtureId); assert.equal(row.scope, 'including_overtime');
  assert.equal(row.homeScore, 100); assert.equal(row.awayScore, 90);
  assert.equal(row.availabilityBasis, 'observed-result'); assert.equal(row.resultAvailableAt, observedAt);
  assert.equal(row.source.fetchedAt, observedAt); assert.equal(row.source.url, journalSummaryURL('nba', fixtureId));
  assert.deepEqual(row.playerStats.map(stat => [stat.playerId, stat.metric, stat.value]), [['101', 'PTS', 20], ['101', 'AST', 6], ['101', 'REB', 8]]);
  assert.ok(row.playerStats.every(stat => stat.teamId === '1' && stat.scope === 'including_overtime'));
  assert.equal(row.probability, undefined); assert.equal(row.odds, undefined);
});

test('unfinalized, future, wrong fixture, duplicated competition and inconsistent source identities never grade', () => {
  for (const mutate of [data => data.header.id = '401900002', data => data.header.competitions.push(structuredClone(data.header.competitions[0])),
    data => data.header.competitions[0].status.type.state = 'in', data => data.header.competitions[0].status.type.completed = false,
    data => data.header.competitions[0].status.type.name = 'STATUS_CANCELED', data => data.header.competitions[0].date = observedAt,
    data => data.header.competitions[0].competitors[0].team.id = '2', data => data.header.competitions[0].competitors[1].id = '1',
    data => data.header.competitions[0].competitors[0].score = { value: 100, displayValue: '99' },
    data => data.header.competitions[0].notes = [{ text: 'Match abandoned' }]]) {
    const data = sample(); mutate(data); assert.equal(extract(data), null);
  }
  assert.throws(() => journalSummaryURL('nba', 'basketball/nba:../12345'));
  assert.throws(() => journalSummaryURL('football', 'soccer/pol.1:tsdb-12345'));
});

test('NHL journal shots use shotsTotal, not the distinct shootoutGoals statistic', () => {
  const data = sample({ sport: 'nhl', route: 'hockey/nhl' });
  data.boxscore.players[0].statistics = [{ labels: ['TOI', 'S', 'SOG'], keys: ['timeOnIce', 'shotsTotal', 'shootoutGoals'], athletes: [
    { athlete: { id: '101', displayName: 'Skater' }, stats: ['15:20', '4', '0'], didNotPlay: false },
  ] }];
  const row = extract(data, { sport: 'nhl', fixtureId: 'hockey/nhl:401900001' });
  assert.equal(row.scope, 'including_overtime_shootout');
  assert.deepEqual(row.playerStats, [{ playerId: '101', teamId: '1', metric: 'S', value: 4, scope: 'including_overtime_excluding_shootout' }]);
  data.boxscore.players[0].statistics[0].keys = ['timeOnIce', 'shootoutGoals', 'shootoutGoals'];
  assert.deepEqual(extract(data, { sport: 'nhl', fixtureId: 'hockey/nhl:401900001' }).playerStats, []);
});

test('football extra time or shootouts cannot settle 90-minute selections', () => {
  for (const mutate of [data => data.header.competitions[0].status.period = 4,
    data => data.header.competitions[0].status.type.detail = 'After Extra Time',
    data => data.header.competitions[0].competitors[0].shootoutScore = 3,
    data => data.header.competitions[0].competitors[0].linescores = [{}, {}, {}]]) {
    const data = sample({ sport: 'football', route: 'soccer/eng.1' }); mutate(data);
    assert.equal(extract(data, { sport: 'football', fixtureId: 'soccer/eng.1:401900001' }), null);
  }
});

test('fetch timestamps are assigned after source observation and network failures are not invented results', async () => {
  let clock = Date.parse(observedAt);
  const row = await fetchJournalResult('nba', fixtureId, { clock: () => clock, fetchImpl: async url => {
    assert.equal(url, journalSummaryURL('nba', fixtureId)); clock += 1234; return json(sample());
  } });
  assert.equal(row.source.fetchedAt, '2026-11-19T12:00:01.234Z');
  await assert.rejects(fetchJournalResult('nba', fixtureId, { fetchImpl: async () => new Response('', { status: 502 }) }));
});

function response() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
async function call(handler, query) { const res = response(); await handler({ method: 'GET', query }, res); return res; }
async function isolated(t, files = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sportlab-result-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'public'), { recursive: true });
  await Promise.all([cp(new URL('../api/', import.meta.url), join(directory, 'api'), { recursive: true }), cp(new URL('../src/', import.meta.url), join(directory, 'src'), { recursive: true }), cp(new URL('../public/football-portraits.js', import.meta.url), join(directory, 'public/football-portraits.js')), writeFile(join(directory, 'package.json'), '{"type":"module"}')]);
  for (const [path, data] of Object.entries(files)) { await mkdir(join(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), JSON.stringify(data)); }
  return (await import(pathToFileURL(join(directory, 'api/journal-results.js')))).default;
}

test('journal detail mode validates a two-fixture bound and source namespaces before reading providers', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unwanted source'); });
  for (const query of [{ sport: 'nba', details: '1', ids: [1, 2, 3].map(id => `basketball/nba:40190000${id}`).join(',') },
    { sport: 'nba', details: 'yes', ids: fixtureId }, { sport: 'football', ids: 'soccer/pol.1:401900001' },
    { sport: 'nba', ids: 'basketball/nba:tsdb-401900001' }, { sport: 'tennis', ids: 'tennis/atp:401900001', details: '1' }]) {
    assert.equal((await call(resultsHandler, query)).statusCode, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('detail mode returns current final facts without historical delay and never exposes arbitrary summary fields', async t => {
  const handler = await isolated(t);
  const data = sample(); data.privateToken = 'never-return'; data.forecast = { probability: 0.99 };
  const fetch = t.mock.method(globalThis, 'fetch', async url => { assert.match(String(url), /summary\?event=401900001$/); return json(data); });
  const res = await call(handler, { sport: 'nba', ids: fixtureId, details: '1' });
  assert.equal(res.statusCode, 200); assert.equal(fetch.mock.callCount(), 1);
  assert.equal(res.body.rows.length, 1); assert.equal(res.body.rows[0].playerStats.length, 3);
  assert.equal(res.body.detailsRequested, true); assert.deepEqual(res.body.missing, []);
  assert.ok(!JSON.stringify(res.body).includes('never-return')); assert.ok(!JSON.stringify(res.body).includes('probability'));
});
