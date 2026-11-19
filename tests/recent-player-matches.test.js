import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentPlayerMatchesLoader } from '../src/server/recent-player-matches.js';

const now = Date.parse('2026-11-19T20:00:00.000Z');
const query = { sport: 'nba', route: 'basketball/nba', teamId: '13' };
function fixture(id = '401910017', date = '2026-11-19T03:00Z') {
  return { id, date, competitions: [{ id, date, status: { period: 4, type: { state: 'post', completed: true, name: 'STATUS_FINAL' } },
    competitors: [{ id: '13', homeAway: 'home', team: { id: '13', displayName: 'Lakers' }, score: { value: 97, displayValue: '97' } },
      { id: '1', homeAway: 'away', team: { id: '1', displayName: 'Hawks' }, score: { value: 99, displayValue: '99' } }] }] };
}
const body = events => ({ team: { id: '13' }, events });
const loader = fetchImpl => createRecentPlayerMatchesLoader({ fetchImpl, clock: () => now, enabled: true });

test('current descriptive schedule exposes a completed match under 24h without inventing prior availability', async () => {
  const original = { id: 'basketball/nba:401910017', resultAvailableAt: '2026-11-20T03:00:00.000Z' };
  const result = await loader(async (url, options) => { assert.match(url, /basketball\/nba\/teams\/13\/schedule$/); assert.deepEqual(options, { timeoutMs: 4000, retries: 0 }); return body([fixture()]); })([original], query);
  assert.equal(result.events.length, 1);
  const row = result.events[0];
  assert.equal(row.descriptiveOnly, true); assert.equal(row.resultAvailableAt, new Date(now).toISOString());
  assert.equal(row.startTime, '2026-11-19T03:00:00.000Z'); assert.equal(row.sourceEventId, '401910017');
  assert.equal(original.resultAvailableAt, '2026-11-20T03:00:00.000Z');
  assert.equal(result.coverage.status, 'refreshed'); assert.equal(result.coverage.complete, false);
});

test('future and unfinished games are not current completed observations', async () => {
  const pending = fixture('100'); pending.competitions[0].status.type = { state: 'in', completed: false };
  const future = fixture('101', '2026-11-20T03:00Z');
  const result = await loader(async () => body([pending, future]))([], query);
  assert.deepEqual(result.events, []); assert.equal(result.coverage.observedMatches, 0);
});

test('wrong team, malformed identity/date, score and conflicting duplicate fail to explicit original-history fallback', async () => {
  const wrongTeam = body([fixture()]); wrongTeam.team.id = '99';
  const wrongParticipant = body([fixture()]); wrongParticipant.events[0].competitions[0].competitors[0].id = '2';
  const wrongDate = body([fixture()]); wrongDate.events[0].competitions[0].date = '2026-11-19T04:00Z';
  const wrongId = body([fixture()]); wrongId.events[0].competitions[0].id = '123';
  const malformedDate = body([fixture('100', '2026-02-31T03:00Z')]);
  const wrongScore = body([fixture()]); wrongScore.events[0].competitions[0].competitors[0].score.displayValue = '98';
  const conflict = body([fixture(), fixture()]); conflict.events[1].competitions[0].competitors[0].score = { value: 20, displayValue: '20' };
  const original = [{ id: 'original' }];
  for (const source of [wrongTeam, wrongParticipant, wrongDate, wrongId, malformedDate, wrongScore, conflict, body(Array(501).fill(fixture()))]) {
    const result = await loader(async () => source)(original, query);
    assert.equal(result.events, original); assert.equal(result.coverage.status, 'fallback'); assert.equal(result.coverage.complete, false); assert.ok(result.coverage.reason);
  }
});

test('soccer cross-league and extra-time games never become regulation player candidates', async () => {
  const valid = fixture('100'); valid.league = { slug: 'eng.1' }; valid.competitions[0].status = { period: 2, type: { state: 'post', completed: true, name: 'STATUS_FULL_TIME' } };
  const cup = structuredClone(valid); cup.id = cup.competitions[0].id = '101'; cup.league.slug = 'eng.fa';
  const overtime = structuredClone(valid); overtime.id = overtime.competitions[0].id = '102'; overtime.competitions[0].status.period = 4;
  const result = await loader(async () => body([valid, cup, overtime]))([], { ...query, sport: 'football', route: 'soccer/eng.1' });
  assert.equal(result.events.length, 1); assert.equal(result.events[0].id, 'soccer/eng.1:100'); assert.equal(result.coverage.excludedMatches, 2);
});

test('cache shares inflight source reads, expires in five minutes and failures are retried', async () => {
  let time = now, requests = 0;
  const load = createRecentPlayerMatchesLoader({ clock: () => time, enabled: true, fetchImpl: async () => { requests++; return body([fixture()]); } });
  const [a, b] = await Promise.all([load([], query), load([], query)]);
  assert.equal(requests, 1); assert.deepEqual(a, b); await load([], query); assert.equal(requests, 1);
  time += 300000; await load([], query); assert.equal(requests, 2);
  let failed = 0; const retry = loader(async () => { failed++; if (failed === 1) throw new Error('Network'); return body([fixture()]); });
  assert.equal((await retry([], query)).coverage.status, 'fallback'); assert.equal((await retry([], query)).coverage.status, 'refreshed'); assert.equal(failed, 2);
});

test('disabled and invalid routes never call a source', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('must not fetch'); };
  const load = createRecentPlayerMatchesLoader({ fetchImpl, clock: () => now, enabled: false });
  assert.equal((await load([], query)).coverage.status, 'disabled');
  assert.equal((await loader(fetchImpl)([], { ...query, route: 'soccer/not-allowed' })).coverage.status, 'fallback');
  assert.equal(calls, 0);
});
