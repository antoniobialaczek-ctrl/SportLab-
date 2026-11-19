import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mlsSeasonURL, normalizeMLSResponse, validateMLSHistory, mergeMLSHistory, loadMLSHistory } from '../src/server/mls-history.js';

const observedAt = '2026-11-19T10:00:00.000Z', now = Date.parse(observedAt), sourceURL = mlsSeasonURL(2026);
const status = { clock: 5400, period: 2, type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } };
const competitor = (id, homeAway, value) => ({ id, uid: `s:600~t:${id}`, type: 'team', homeAway, score: value, team: { id, uid: `s:600~t:${id}`, displayName: `Club ${id}` } });
const fixture = { id: '761439', uid: 's:600~l:770~e:761439', date: '2026-11-17T19:30Z', season: { year: 2026, type: 13846, slug: 'regular-season' }, status,
  competitions: [{ id: '761439', uid: 's:600~l:770~e:761439~c:761439', date: '2026-11-17T19:30Z', startDate: '2026-11-17T19:30Z', status,
    format: { regulation: { periods: 2 } }, competitors: [competitor('21812', 'home', '2'), competitor('21300', 'away', '1')] }] };
const body = events => ({ leagues: [{ id: '770', slug: 'usa.1', season: { year: 2026 } }], events });
const normalize = event => normalizeMLSResponse(body([event]), { observedAt, sourceURL });
const events = normalize(fixture).events;
const data = { schemaVersion: 1, kind: 'supplemental-descriptive-history', route: 'soccer/usa.1', modelExperimentEligible: false, fetchedAt: observedAt, events, coverage: { complete: false } };
const response = value => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(value) });

test('MLS source binds exact ESPN league/event/team identities and real observation availability', () => {
  assert.equal(events.length, 1);
  assert.equal(validateMLSHistory(data), data);
  assert.equal(events[0].firstObservedAt, observedAt);
  assert.equal(events[0].resultAvailableAt, observedAt);
  const recent = structuredClone(fixture);
  recent.date = recent.competitions[0].date = recent.competitions[0].startDate = '2026-11-18T22:00Z';
  assert.equal(normalize(recent).events[0].resultAvailableAt, '2026-11-19T22:00:00.000Z');
  assert.throws(() => normalizeMLSResponse(body([fixture]), { observedAt, sourceURL: sourceURL.replace('usa.1', 'eng.1') }));
  assert.throws(() => normalizeMLSResponse(body([fixture, fixture]), { observedAt, sourceURL }));
  assert.throws(() => normalizeMLSResponse({ ...body([fixture]), leagues: [{ id: '23', slug: 'usa.1', season: { year: 2026 } }] }, { observedAt, sourceURL }));
  for (const extra of [{ homeId: 'tsdb-21812' }, { homeScore: null }, { resultAvailableAt: '2026-11-18T10:00:00.000Z' }, { route: 'soccer/eng.1' }, { regulationOnly: false }]) {
    assert.throws(() => validateMLSHistory({ ...data, events: [{ ...events[0], ...extra }] }));
  }
});

test('unknown, malformed, All-Star, extra time, shootouts and unfinished MLS results fail closed', () => {
  const variants = [];
  for (const change of [
    event => { event.uid = 's:600~l:23~e:761439'; },
    event => { event.competitions[0].competitors[0].team.id = '999'; },
    event => { event.competitions[0].competitors[0].score = '2.5'; },
    event => { event.season.slug = 'all-star-game'; },
    event => { const team = event.competitions[0].competitors[0]; team.id = team.team.id = '9817'; team.uid = team.team.uid = 's:600~t:9817'; },
    event => { event.status.type.name = 'STATUS_FINAL_PEN'; event.competitions[0].status.type.name = 'STATUS_FINAL_PEN'; },
    event => { event.competitions[0].status.period = 4; },
    event => { event.competitions[0].status.clock = 2100; },
    event => { event.competitions[0].competitors[0].shootoutScore = '4'; },
    event => { event.competitions[0].competitors[0].linescores = [{}, {}, {}]; },
    event => { event.competitions[0].status.type.completed = false; },
  ]) { const event = structuredClone(fixture); change(event); variants.push(event); }
  for (const event of variants) { assert.equal(normalize(event).events.length, 0); assert.equal(normalize(event).exclusions.length, 1); }
});

test('unchanged observations preserve availability; a corrected score is only available after its new observation', () => {
  const later = '2026-11-20T10:00:00.000Z';
  const next = { ...events[0], firstObservedAt: later, resultAvailableAt: later, source: { ...events[0].source, fetchedAt: later } };
  const unchanged = mergeMLSHistory(events, [next])[0];
  assert.equal(unchanged.firstObservedAt, observedAt);
  assert.equal(unchanged.resultAvailableAt, observedAt);
  const corrected = mergeMLSHistory(events, [{ ...next, homeScore: 3 }])[0];
  assert.equal(corrected.firstObservedAt, observedAt);
  assert.equal(corrected.resultAvailableAt, later);
  assert.equal(corrected.revisions[0].previous.homeScore, 2);
  assert.throws(() => mergeMLSHistory(events, [{ ...next, homeId: '999' }]));
});

test('MLS runtime shares one exact season request for ten minutes and keeps the original observation', async () => {
  let calls = 0;
  const fetchImpl = async url => { calls++; assert.equal(url, sourceURL); return response(body([fixture])); };
  const options = { historyData: data, now, refresh: true, fetchImpl };
  const [first, second] = await Promise.all([loadMLSHistory(options), loadMLSHistory(options)]);
  assert.equal(calls, 1);
  assert.equal(first.events[0].firstObservedAt, observedAt);
  assert.equal(second.runtimeData.origin, 'espn');
  await loadMLSHistory({ ...options, now: now + 599999 });
  assert.equal(calls, 1);
  await loadMLSHistory({ ...options, now: now + 600000 });
  assert.equal(calls, 2);
});

test('source errors and retracted results use explicit validated fallback; local-only mode makes no requests', async () => {
  const unavailable = await loadMLSHistory({ historyData: data, now, refresh: true, fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(unavailable.events.length, 1);
  assert.equal(unavailable.usingLocalFallback, true);
  assert.equal(unavailable.runtimeData.fallback, true);
  const retracted = structuredClone(fixture); retracted.status.type.completed = false;
  const conflict = await loadMLSHistory({ historyData: data, now, refresh: true, fetchImpl: async () => response(body([retracted])) });
  assert.equal(conflict.usingLocalFallback, true);
  const local = await loadMLSHistory({ historyData: data, now, refresh: false, fetchImpl: () => { throw new Error('unexpected network'); } });
  assert.equal(local.runtimeData.origin, 'local');
  assert.equal(local.modelExperimentEligible, false);
});

test('bundled MLS history contains separately observed regulation-only 2025–2026 results', async () => {
  const bundled = validateMLSHistory(JSON.parse(await readFile(new URL('../data/supplemental/mls.json', import.meta.url), 'utf8')));
  assert.ok(bundled.events.length >= 1000);
  assert.deepEqual([...new Set(bundled.events.map(row => row.season))], [2025, 2026]);
  assert.equal(bundled.coverage.complete, false);
  for (const row of bundled.events) assert.ok(Date.parse(row.resultAvailableAt) >= Date.parse(row.firstObservedAt));
});
