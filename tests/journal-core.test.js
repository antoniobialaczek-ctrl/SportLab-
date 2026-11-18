import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRecord, createRecord, emptyJournal, evaluatePrice, MAX_RECORDS, mergeJournals, settleJournal, summarizeJournal, validateJournal } from '../public/journal-core.js';

const recordedAt = '2026-11-18T12:00:00.000Z', startTime = '2026-11-19T00:00:00.000Z', settledAt = '2026-11-20T01:00:00.000Z';
const event = { id: 'basketball/nba:12345', sport: 'nba', route: 'basketball/nba', homeId: '1', awayId: '2', home: 'Test A', away: 'Test B', state: 'pre', date: startTime };
const make = (id = 'record-0001', input = {}, fixture = event) => createRecord(fixture, { market: 'winner', outcome: 'home', odds: 2.5, stake: 2, ...input }, { now: recordedAt, id });
const row = (overrides = {}) => ({ id: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId, startTime,
  status: 'completed', homeScore: 100, awayScore: 90, resultAvailableAt: '2026-11-20T00:00:00.000Z', availabilityBasis: 'conservative-24h',
  source: { provider: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261119', fetchedAt: '2026-11-20T00:30:00.000Z' }, ...overrides });
const journal = (record = make()) => appendRecord(emptyJournal(), record);

test('personal entries are captured before kickoff with immutable bounded prices and stakes', () => {
  const record = make();
  assert.equal(record.personal, true); assert.equal(record.createdAt, recordedAt); assert.equal(record.status, 'pending');
  assert.equal(record.startTime, startTime); assert.equal(record.quotedAt, recordedAt); assert.equal(record.settlement, null);
  assert.throws(() => record.odds = 99, TypeError);
  for (const input of [{ odds: 1 }, { odds: '2.5' }, { odds: Infinity }, { odds: 1001 }, { stake: 0 }, { stake: 100.01 }, { stake: 0.001 }, { outcome: 'draw' }, { quotedAt: '2026-11-18T12:01:00.000Z' }, { quotedAt: '2026-11-18T11:44:59.000Z' }]) assert.throws(() => make('record-0001', input));
  for (const fixture of [{ ...event, state: 'in' }, { ...event, state: 'post' }, { ...event, date: recordedAt }, { ...event, date: '2026-11-17T00:00:00.000Z' }, { ...event, homeId: '2' }, { ...event, route: 'hockey/nhl' }]) assert.throws(() => make('record-0001', {}, fixture));
  assert.throws(() => make('record-0001', {}, { ...event, date: '2027-02-30T00:00:00Z' }));
  assert.throws(() => make('record-0001', { market: 'result_90' }, { ...event, id: 'soccer/engX1:12345', sport: 'football', route: 'soccer/eng.1' }));
});

test('merging preserves existing entries and refuses changed duplicates, corrupt data and overflow', () => {
  const base = journal();
  assert.deepEqual(mergeJournals(base, JSON.parse(JSON.stringify(base))), base);
  const duplicate = JSON.parse(JSON.stringify(base)); duplicate.records[0].odds = 3;
  assert.throws(() => mergeJournals(base, duplicate), /zmienia istniejący/);
  assert.throws(() => appendRecord(base, make('record-0001', { odds: 3 })), /Konflikt/);
  const full = validateJournal({ schemaVersion: 1, records: Array.from({ length: MAX_RECORDS }, (_, i) => make(`record-${String(i).padStart(4, '0')}`)) });
  assert.throws(() => appendRecord(full, make('record-0501')), /maksymalnie/);
  assert.throws(() => validateJournal({ schemaVersion: 2, records: [] }));
  assert.throws(() => validateJournal({ schemaVersion: 1, records: [make(), make()] }));
  assert.throws(() => validateJournal({ schemaVersion: 1, records: [{ ...make(), modelProbability: 0.8 }] }));
});

test('settlement requires matching fixture, participants, scope and results available only later', () => {
  const base = journal();
  for (const overrides of [{ id: 'basketball/nba:99999' }, { route: 'hockey/nhl' }, { sport: 'nhl' }, { homeId: '2', awayId: '1' }, { startTime: '2026-11-19T01:00:00.000Z' }, { status: 'canceled' }, { homeScore: 90 }, { awayScore: null }, { homeScore: -1 }, { resultAvailableAt: recordedAt }, { resultAvailableAt: '2026-11-21T00:00:00.000Z' }, { availabilityBasis: 'unknown' }, { source: { provider: 'other' } }]) {
    assert.equal(settleJournal(base, [row(overrides)], { now: settledAt }).records[0].status, 'pending');
  }
  const won = settleJournal(base, [row()], { now: settledAt });
  assert.equal(won.records[0].status, 'won'); assert.equal(won.records[0].settlement.homeScore, 100);
  assert.deepEqual(settleJournal(won, [row()], { now: '2026-11-20T02:00:00.000Z' }), won);
  assert.equal(base.records[0].status, 'pending');
  assert.deepEqual(settleJournal(base, [row(), row()], { now: settledAt }), base);
});

test('source score corrections flag a conflict and cannot silently rewrite a final grade', () => {
  const graded = settleJournal(journal(), [row()], { now: settledAt });
  const conflict = settleJournal(graded, [row({ homeScore: 80 })], { now: settledAt });
  assert.equal(conflict.records[0].status, 'won'); assert.equal(conflict.records[0].settlement.homeScore, 100);
  assert.equal(conflict.records[0].conflict.reason, 'source-result-changed');
  assert.equal(summarizeJournal(conflict).conflicted, 1); assert.equal(summarizeJournal(conflict).settled, 0);
  assert.equal(summarizeJournal(conflict).roi, null);
  assert.throws(() => mergeJournals(graded, conflict), /zmienia istniejący/);
});

test('football double chance counts a regulation draw and normal result market distinguishes it', () => {
  const fixture = { ...event, id: 'soccer/eng.1:12345', sport: 'football', route: 'soccer/eng.1' };
  const record = make('record-0001', { market: 'double_chance_90', outcome: 'draw_away' }, fixture);
  const result = row({ id: fixture.id, sport: fixture.sport, route: fixture.route, homeScore: 1, awayScore: 1,
    source: { provider: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261119', fetchedAt: '2026-11-20T00:30:00.000Z' } });
  assert.equal(settleJournal(journal(record), [result], { now: settledAt }).records[0].status, 'won');
  const home = make('record-0002', { market: 'result_90', outcome: 'home' }, fixture);
  assert.equal(settleJournal(journal(home), [result], { now: settledAt }).records[0].status, 'lost');
  const draw = make('record-0003', { market: 'result_90', outcome: 'draw' }, fixture);
  assert.equal(settleJournal(journal(draw), [result], { now: settledAt }).records[0].status, 'won');
});

test('profit and ROI use only settled personal unit stakes and never research model accuracy', () => {
  const a = make('record-0001'), b = make('record-0002', { outcome: 'away', odds: 2, stake: 1 });
  let entries = appendRecord(journal(a), b); entries = appendRecord(entries, make('record-0003', { stake: 10 }));
  const graded = settleJournal(entries, [row()], { now: settledAt });
  // All three entries refer to the same fixture and settle; the third home selection wins too.
  const summary = summarizeJournal(graded);
  assert.equal(summary.settled, 3); assert.equal(summary.won, 2); assert.equal(summary.lost, 1);
  assert.equal(summary.settledStake, 13); assert.equal(summary.profit, 17); assert.equal(summary.roi, 17 / 13); assert.equal(summary.hitRate, 2 / 3);
  const pending = summarizeJournal(journal()); assert.equal(pending.profit, 0); assert.equal(pending.roi, null); assert.equal(pending.hitRate, null);
  assert.equal(pending.personal, true); assert.match(pending.note, /Nie są skutecznością modeli/);
  const later = make('record-0004', { stake: 10 }, { ...event, id: 'basketball/nba:99999' });
  const mixed = settleJournal(appendRecord(journal(a), later), [row()], { now: settledAt });
  const mixedSummary = summarizeJournal(mixed);
  assert.equal(mixedSummary.pending, 1); assert.equal(mixedSummary.unitsStaked, 12); assert.equal(mixedSummary.settledStake, 2);
  assert.equal(mixedSummary.profit, 3); assert.equal(mixedSummary.roi, 1.5); assert.equal(mixedSummary.hitRate, 1);
});

test('price calculator shows implied break-even only until a matching fresh published forecast exists', () => {
  const options = { event, market: 'winner', outcome: 'home', now: recordedAt };
  const basic = evaluatePrice(2.5, null, options);
  assert.equal(basic.breakEven, 0.4); assert.equal(basic.modelProbability, null); assert.equal(basic.expectedValue, null);
  const forecast = { status: 'published', fixtureId: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId,
    startTime, market: 'winner', outcome: 'home', probability: 0.5, generatedAt: '2026-11-18T11:59:00.000Z', validUntil: '2026-11-18T12:10:00.000Z',
    verification: { pointInTimeVerified: true, publicationEligible: true, modelVersion: 'v1' } };
  assert.equal(evaluatePrice(2.5, forecast, options).expectedValue, 0.25);
  for (const change of [{ status: 'research' }, { fixtureId: 'basketball/nba:99999' }, { outcome: 'away' }, { generatedAt: '2026-11-18T12:01:00.000Z' }, { generatedAt: '2026-11-18T11:44:00.000Z' }, { validUntil: '2026-11-18T11:59:00.000Z' }, { probability: 1.1 }, { verification: { pointInTimeVerified: false, publicationEligible: true, modelVersion: 'v1' } }]) assert.equal(evaluatePrice(2.5, { ...forecast, ...change }, options).modelProbability, null);
  assert.throws(() => evaluatePrice(0));
  assert.equal(evaluatePrice(2, forecast, { ...options, event: { ...event, state: 'in' } }).status, 'unavailable');
});
