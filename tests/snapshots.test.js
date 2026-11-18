import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureSnapshots, fetchObservedSnapshot, upcomingFixtures } from '../src/data/snapshots.js';

const route = 'basketball/nba', sport = 'nba', day = '2026-01-02';
function board(completed = false) {
  return { events: [{ id: '1234567', season: { year: 2026 }, competitions: [{
    id: '1234567', date: '2026-01-02T12:00:00Z', neutralSite: false,
    status: { type: { state: completed ? 'post' : 'pre', name: completed ? 'STATUS_FINAL' : 'STATUS_SCHEDULED', completed } },
    competitors: [{ id: '1', homeAway: 'home', team: { displayName: 'Test home' }, score: completed ? '90' : undefined }, { id: '2', homeAway: 'away', team: { displayName: 'Test away' }, score: completed ? '80' : undefined }],
  }] }] };
}
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('observation time is recorded after complete response body arrives', async () => {
  let received = false;
  const snapshot = await fetchObservedSnapshot('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard', { fetchImpl: async () => ({ ok: true, text: async () => { received = true; return JSON.stringify(board()); } }), clock: () => { assert.equal(received, true); return Date.parse('2026-01-01T12:00:00Z'); } });
  assert.equal(snapshot.observedAt, '2026-01-01T12:00:00.000Z');
});
test('forecast is immutable before kickoff and settles only from later actual snapshot', async t => {
  const root = await setup(t);
  const options = { root, from: day, to: day, sports: [sport], routes: [route], fetchImpl: async () => new Response(JSON.stringify(board())), clock: () => Date.parse('2026-01-01T12:00:00Z') };
  const first = await captureSnapshots(options);
  assert.equal(first.added.forecasts, 1);
  const initial = JSON.parse(await readFile(join(root, 'forward/state.json')));
  assert.equal(initial.forecasts[0].publish, false);
  const pending = JSON.parse(await readFile(join(root, 'reports/forward.json')));
  assert.equal(pending.sports.nba.samples.settled, 0);
  assert.equal(pending.sports.nba.metrics, null);
  await captureSnapshots({ ...options, fetchImpl: async () => new Response(JSON.stringify(board(true))), clock: () => Date.parse('2026-01-03T12:00:00Z') });
  const final = JSON.parse(await readFile(join(root, 'forward/state.json')));
  assert.deepEqual(final.forecasts, initial.forecasts);
  const report = JSON.parse(await readFile(join(root, 'reports/forward.json')));
  assert.equal(report.sports.nba.samples.settled, 1);
  assert.equal(report.sports.nba.publication.eligible, false);
  assert.ok(!JSON.stringify(report).includes('probabilities'));
});
test('corrupted archived evidence stops further evaluation', async t => {
  const root = await setup(t), options = { root, from: day, to: day, sports: [sport], routes: [route], fetchImpl: async () => new Response(JSON.stringify(board())), clock: () => Date.parse('2026-01-01T12:00:00Z') };
  await captureSnapshots(options);
  const state = JSON.parse(await readFile(join(root, 'forward/state.json')));
  await writeFile(join(root, `snapshots/raw/${state.snapshots[0].sha256}.json`), '{}');
  await assert.rejects(captureSnapshots(options), /Uszkodzone archiwum/);
});
test('tennis tour filtering never turns a WTA match into ATP', () => {
  const competition = board().events[0].competitions[0];
  competition.competitors.forEach(c => { c.type = 'athlete'; c.athlete = { displayName: c.team.displayName }; });
  const data = { events: [{ groupings: [{ grouping: { slug: 'womens-singles' }, competitions: [competition] }] }] };
  assert.equal(upcomingFixtures(data, { sport: 'tennis', route: 'tennis/atp', day, observedAt: '2026-01-01T00:00:00Z' }).length, 0);
  assert.equal(upcomingFixtures(data, { sport: 'tennis', route: 'tennis/wta', day, observedAt: '2026-01-01T00:00:00Z' }).length, 1);
});
