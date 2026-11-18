import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeScoreboard } from '../src/data/espn.js';
import { validateEvent, mergeEvents, validateHistory } from '../src/data/schema.js';
import { fetchJSON, mapConcurrent } from '../src/data/fetch.js';
import { ingestHistory, historyDays } from '../src/data/history.js';
import { parseDay, scoreboardURL, DEFAULT_HISTORY_ROUTES } from '../src/data/catalog.js';

// Deliberately synthetic fixtures for adapter tests; never bundled as model history.
const final = { type: { name: 'STATUS_FINAL', state: 'post', completed: true } };
const fetchedAt = '2025-01-10T10:00:00.000Z';
const teamBoard = () => ({ events: [{ id: '100', season: { year: 2025 }, competitions: [{
  id: '100', date: '2025-01-02T01:00:00Z', status: structuredClone(final), neutralSite: false,
  competitors: [
    { id: '1', type: 'team', homeAway: 'home', score: '101', team: { displayName: 'Fixture A' } },
    { id: '2', type: 'team', homeAway: 'away', score: '99', team: { displayName: 'Fixture B' } },
  ],
}] }] });
const sourceOptions = (sport = 'nba', route = 'basketball/nba', day = '2025-01-02') => ({ sport, route, day, fetchedAt, url: scoreboardURL(route, day) });
const event = () => normalizeScoreboard(teamBoard(), sourceOptions()).events[0];
const tennisBoard = () => ({ events: [{ id: 'tournament-2025', season: { year: 2025 }, groupings: [{
  grouping: { slug: 'mens-singles' }, competitions: [{ id: 'match-200', date: '2025-01-02T13:00Z', type: { slug: 'mens-singles' }, status: structuredClone(final),
    competitors: [
      { id: '3', type: 'athlete', homeAway: 'home', winner: true, athlete: { displayName: 'Fixture C' }, linescores: [{ value: 6, winner: true }, { value: 7, winner: true }] },
      { id: '4', type: 'athlete', homeAway: 'away', winner: false, athlete: { displayName: 'Fixture D' }, linescores: [{ value: 4, winner: false }, { value: 6, winner: false }] },
    ],
  }],
}] }] });

test('NBA normalization keeps stable IDs and documents approximate availability without current stats', () => {
  const result = normalizeScoreboard(teamBoard(), sourceOptions());
  assert.equal(result.rejected.length, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, 'basketball/nba:100');
  assert.equal(result.events[0].homeScore, 101);
  assert.equal(result.events[0].resultAvailableAt, '2025-01-03T01:00:00.000Z');
  assert.equal(result.events[0].availabilityBasis, 'conservative-24h');
  assert.equal(Object.hasOwn(result.events[0], 'records'), false);
});

test('US schedule day games crossing UTC midnight are retained', () => {
  assert.equal(normalizeScoreboard(teamBoard(), sourceOptions('nba', 'basketball/nba', '2025-01-01')).events.length, 1);
});

test('missing and negative scores are rejected, never coerced to zero', () => {
  for (const bad of ['', undefined, '-1', '2.5', null]) {
    const board = teamBoard();
    board.events[0].competitions[0].competitors[0].score = bad;
    const result = normalizeScoreboard(board, sourceOptions());
    assert.equal(result.events.length, 0);
    assert.equal(result.rejected.length, 1);
  }
});

test('only completed games with an allowed final state enter history', () => {
  for (const type of [
    { name: 'STATUS_SCHEDULED', state: 'pre', completed: false },
    { name: 'STATUS_POSTPONED', state: 'post', completed: true },
    { name: 'STATUS_CANCELED', state: 'post', completed: true },
  ]) {
    const board = teamBoard();
    board.events[0].competitions[0].status = { type };
    assert.equal(normalizeScoreboard(board, sourceOptions()).events.length, 0);
  }
});

test('football accepts an actual draw but NBA does not', () => {
  const board = teamBoard();
  const comp = board.events[0].competitions[0];
  comp.competitors.forEach(p => { p.score = '1'; });
  comp.status = { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } };
  assert.equal(normalizeScoreboard(board, sourceOptions('football', 'soccer/eng.1')).events.length, 1);
  assert.equal(normalizeScoreboard(board, sourceOptions()).events.length, 0);
});

test('football excludes generic final with extra-time or penalty indicators', () => {
  for (const indicator of ['period', 'detail', 'shootoutScore']) {
    const board = teamBoard();
    const comp = board.events[0].competitions[0];
    comp.competitors.forEach(p => { p.score = '1'; });
    comp.status = structuredClone(final);
    if (indicator === 'period') comp.status.period = 4;
    if (indicator === 'detail') comp.status.type.detail = 'After Extra Time';
    if (indicator === 'shootoutScore') comp.competitors[0].shootoutScore = '4';
    assert.equal(normalizeScoreboard(board, sourceOptions('football', 'soccer/eng.1')).events.length, 0);
  }
});

test('unknown venue is treated conservatively as neutral with provenance', () => {
  const board = teamBoard();
  delete board.events[0].competitions[0].neutralSite;
  const normalized = normalizeScoreboard(board, sourceOptions()).events[0];
  assert.equal(normalized.neutralSite, true);
  assert.equal(normalized.neutralSiteBasis, 'unknown-assume-neutral');
});

test('tennis uses match IDs and set winners, excluding tournament shell and current rankings', () => {
  const result = normalizeScoreboard(tennisBoard(), sourceOptions('tennis', 'tennis/atp'));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].sourceEventId, 'match-200');
  assert.equal(result.events[0].homeScore, 2);
  assert.equal(result.events[0].awayScore, 0);
  assert.equal(result.events[0].homeId, '3');
  assert.equal(result.events[0].neutralSite, true);
});

test('tennis omits doubles, retirements, incomplete sets and other tournament days', () => {
  const options = sourceOptions('tennis', 'tennis/atp');
  let board = tennisBoard();
  board.events[0].groupings[0].competitions[0].type.slug = 'mens-doubles';
  assert.equal(normalizeScoreboard(board, options).events.length, 0);
  board = tennisBoard();
  board.events[0].groupings[0].competitions[0].status.type = { name: 'STATUS_RETIRED', state: 'post', completed: true };
  assert.equal(normalizeScoreboard(board, options).events.length, 0);
  board = tennisBoard();
  board.events[0].groupings[0].competitions[0].competitors[0].linescores.pop();
  assert.equal(normalizeScoreboard(board, options).rejected.length, 1);
  assert.equal(normalizeScoreboard(tennisBoard(), { ...options, day: '2025-01-03' }).events.length, 0);
});

test('ATP/WTA responses cannot mix opposite singles tours even under shared tournaments', () => {
  assert.equal(normalizeScoreboard(tennisBoard(), sourceOptions('tennis', 'tennis/wta')).events.length, 0);
  const board = tennisBoard();
  board.events[0].groupings[0].grouping.slug = 'womens-singles';
  board.events[0].groupings[0].competitions[0].type.slug = 'womens-singles';
  assert.equal(normalizeScoreboard(board, sourceOptions('tennis', 'tennis/wta')).events.length, 1);
  assert.equal(normalizeScoreboard(board, sourceOptions('tennis', 'tennis/atp')).events.length, 0);
});

test('contradictory winner flags and a bogus empty tennis set are quarantinable', () => {
  let board = tennisBoard();
  let competitors = board.events[0].groupings[0].competitions[0].competitors;
  competitors[0].winner = false;
  assert.match(normalizeScoreboard(board, sourceOptions('tennis', 'tennis/atp')).rejected[0].reason, /Zwycięzca/);
  board = tennisBoard();
  competitors = board.events[0].groupings[0].competitions[0].competitors;
  competitors.forEach(p => p.linescores.push({ value: 0, winner: false }));
  assert.match(normalizeScoreboard(board, sourceOptions('tennis', 'tennis/atp')).rejected[0].reason, /Niejednoznaczny/);
});

test('tennis cannot fall back to tournament dates or IDs when match identity is absent', () => {
  for (const field of ['id', 'date']) {
    const board = tennisBoard();
    board.events[0].date = '2025-01-02T13:00Z';
    delete board.events[0].groupings[0].competitions[0][field];
    const result = normalizeScoreboard(board, sourceOptions('tennis', 'tennis/atp'));
    assert.equal(result.events.length, 0);
    assert.equal(result.rejected.length, 1);
  }
});

test('final states with a future date cannot enter history', () => {
  const board = teamBoard();
  board.events[0].competitions[0].date = '2026-01-01T01:00Z';
  assert.equal(normalizeScoreboard(board, sourceOptions()).events.length, 0);
});

test('malformed response and a route outside the allowlist fail closed', () => {
  assert.throws(() => normalizeScoreboard({}, sourceOptions()), /listy/);
  assert.throws(() => normalizeScoreboard(teamBoard(), sourceOptions('nba', '../../bad')), /liga/);
  assert.throws(() => validateEvent({ ...event(), source: { ...event().source, url: 'https://example.com' } }), /URL/);
});

test('upsert is idempotent, permits score correction and blocks identity conflicts/duplicates', () => {
  const first = event();
  assert.equal(mergeEvents([first], [first]).length, 1);
  const corrected = mergeEvents([first], [{ ...first, homeScore: 102 }])[0];
  assert.equal(corrected.homeScore, 102);
  assert.deepEqual(corrected.revisions[0].fields.homeScore, { before: 101, after: 102 });
  assert.equal(mergeEvents([corrected], [corrected])[0].revisions.length, 1);
  assert.throws(() => mergeEvents([first], [{ ...first, homeId: 'changed' }]), /Konflikt/);
  assert.throws(() => mergeEvents([], [first, first]), /Powielony/);
  assert.throws(() => validateHistory({ schemaVersion: 1, events: [first, first] }, 'nba'), /Powielony/);
});

test('storage timestamps must be canonical and reject overflow dates', () => {
  assert.throws(() => validateEvent({ ...event(), startTime: '2025-02-30T01:00:00.000Z' }), /czas/);
  assert.throws(() => validateEvent({ ...event(), resultAvailableAt: event().startTime }), /przed/);
  assert.equal(validateEvent({ ...event(), sport: 'tennis', route: 'tennis/atp', league: 'atp', id: 'tennis/atp:100', homeScore: 3, awayScore: 2, source: { ...event().source, url: scoreboardURL('tennis/atp', '2025-01-02') } }).awayScore, 2);
});

test('date validation rejects invalid calendar days, future/inverted/unbounded requests', () => {
  assert.throws(() => parseDay('2025-02-30'), /data/);
  assert.throws(() => historyDays('2025-01-03', '2025-01-02', fetchedAt), /poprzedza/);
  assert.throws(() => historyDays('2025-01-01', '2025-01-10', fetchedAt), /zakończone/);
  assert.throws(() => historyDays('2020-01-01', '2025-01-01', fetchedAt), /1096/);
  assert.deepEqual(historyDays('2025-01-01', '2025-01-02', fetchedAt), ['2025-01-01', '2025-01-02']);
});

test('fetch retries transient HTTP failure but rejects permanent and malformed responses', async () => {
  let calls = 0;
  const url = scoreboardURL('basketball/nba', '2025-01-02');
  const value = await fetchJSON(url, { sleepImpl: async () => {}, fetchImpl: async () => ++calls === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ events: [] }) } });
  assert.deepEqual(value, { events: [] });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchJSON(url, { fetchImpl: async () => { calls++; return { ok: false, status: 404 }; } }), /404/);
  assert.equal(calls, 1);
  await assert.rejects(fetchJSON(url, { fetchImpl: async () => ({ ok: true, json: async () => [] }) }), /JSON/);
  await assert.rejects(fetchJSON('https://bad.example/'), /host/);
});

test('fetch abort timeout is bounded and retried only as configured', async () => {
  let calls = 0;
  await assert.rejects(fetchJSON(scoreboardURL('basketball/nba', '2025-01-02'), {
    timeoutMs: 5, retries: 0,
    fetchImpl: async (url, { signal }) => { calls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); },
  }), /aborted/);
  assert.equal(calls, 1);
});

test('parallel requests never exceed configured concurrency and retain ordering', async () => {
  let active = 0;
  let max = 0;
  const result = await mapConcurrent([1, 2, 3, 4, 5], 2, async value => {
    active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  assert.equal(max, 2);
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
});

test('source failure preserves the previous complete history and records diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-ingest-'));
  try {
    const original = JSON.stringify({ schemaVersion: 1, updatedAt: fetchedAt, events: [event()], errors: [] });
    await writeFile(join(root, 'nba.json'), original);
    const report = await ingestHistory({ root, from: '2025-01-02', to: '2025-01-03', sports: ['nba', 'cs2'], now: fetchedAt,
      fetchImpl: async url => new URL(url).searchParams.get('dates') === '20250102'
        ? { ok: true, json: async () => teamBoard() } : { ok: false, status: 404 },
    });
    assert.equal(report.hasErrors, true);
    assert.equal(report.sports.nba.status, 'error');
    assert.equal(report.sports.cs2.status, 'unavailable');
    assert.equal(await readFile(join(root, 'nba.json'), 'utf8'), original);
    assert.equal(JSON.parse(await readFile(join(root, 'ingestion.json'), 'utf8')).hasErrors, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('valid ingestion persists real normalized records; dry-run writes nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-ingest-'));
  const options = { root, from: '2025-01-02', to: '2025-01-02', sports: ['nba', 'cs2'], now: fetchedAt, fetchImpl: async () => ({ ok: true, json: async () => teamBoard() }) };
  try {
    const preview = await ingestHistory({ ...options, dryRun: true });
    assert.equal(preview.hasErrors, false);
    assert.equal(preview.sports.nba.events, 1);
    await assert.rejects(readFile(join(root, 'nba.json')), { code: 'ENOENT' });
    const report = await ingestHistory(options);
    assert.equal(report.hasErrors, false);
    const stored = JSON.parse(await readFile(join(root, 'nba.json'), 'utf8'));
    assert.equal(stored.events[0].source.provider, 'ESPN');
    await ingestHistory(options);
    assert.equal(JSON.parse(await readFile(join(root, 'nba.json'), 'utf8')).events.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('isolated malformed records are excluded with provenance and recover when corrected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-ingest-'));
  const board = teamBoard();
  board.events = Array.from({ length: 21 }, (_, i) => {
    const e = structuredClone(board.events[0]);
    e.id = e.competitions[0].id = String(100 + i);
    return e;
  });
  board.events[0].competitions[0].competitors[0].score = '';
  const options = { root, from: '2025-01-02', to: '2025-01-02', sports: ['nba'], now: fetchedAt,
    fetchImpl: async () => ({ ok: true, json: async () => structuredClone(board) }),
  };
  try {
    const report = await ingestHistory(options);
    assert.equal(report.hasErrors, false);
    assert.equal(report.hasExclusions, true);
    assert.equal(report.sports.nba.status, 'ok-with-exclusions');
    let stored = JSON.parse(await readFile(join(root, 'nba.json'), 'utf8'));
    assert.equal(stored.events.length, 20);
    assert.equal(stored.exclusions.length, 1);
    assert.equal(stored.exclusions[0].id, 'basketball/nba:100');
    assert.equal(stored.exclusions[0].url, scoreboardURL('basketball/nba', '2025-01-02'));
    board.events[0].competitions[0].competitors[0].score = '101';
    const corrected = await ingestHistory(options);
    assert.equal(corrected.hasErrors, false);
    stored = JSON.parse(await readFile(join(root, 'nba.json'), 'utf8'));
    assert.equal(stored.events.length, 21);
    assert.equal(stored.exclusions.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('broad schema failures above five percent preserve the last complete dataset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-ingest-'));
  const original = JSON.stringify({ schemaVersion: 1, updatedAt: fetchedAt, events: [event()], errors: [] });
  const board = teamBoard();
  delete board.events[0].competitions[0].competitors[0].score;
  try {
    await writeFile(join(root, 'nba.json'), original);
    const report = await ingestHistory({ root, from: '2025-01-02', to: '2025-01-02', sports: ['nba'], now: fetchedAt, fetchImpl: async () => ({ ok: true, json: async () => board }) });
    assert.equal(report.hasErrors, true);
    assert.equal(report.sports.nba.status, 'error');
    assert.equal(await readFile(join(root, 'nba.json'), 'utf8'), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('repeated source records on adjoining ESPN schedule days are idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-ingest-'));
  try {
    const report = await ingestHistory({ root, from: '2025-01-01', to: '2025-01-02', sports: ['nba'], now: fetchedAt, fetchImpl: async () => ({ ok: true, json: async () => teamBoard() }) });
    assert.equal(report.hasErrors, false);
    assert.equal(report.sports.nba.events, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('known unsupported ESPN history route is explicitly unavailable without repeated failing requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sportlab-ingest-'));
  let requests = 0;
  try {
    const report = await ingestHistory({ root, from: '2025-01-01', to: '2025-01-02', sports: ['football'], routes: ['soccer/pol.1'], now: fetchedAt,
      fetchImpl: async () => { requests++; throw new Error('must not request unsupported route'); },
    });
    assert.equal(requests, 0);
    assert.equal(report.hasErrors, false);
    assert.equal(report.sports.football.status, 'unavailable');
    assert.equal(report.sports.football.unavailableSources[0].route, 'soccer/pol.1');
    assert.equal(DEFAULT_HISTORY_ROUTES.football.length, 10);
    assert.equal(DEFAULT_HISTORY_ROUTES.football.includes('soccer/pol.1'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
