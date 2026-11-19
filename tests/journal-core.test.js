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
  assert.throws(() => validateJournal({ schemaVersion: 3, records: [] }));
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


test('version one journals migrate without losing prices, original times, results or import identity', () => {
  const old = JSON.parse(JSON.stringify(settleJournal(journal(), [row()], { now: settledAt })));
  old.schemaVersion = 1; delete old.records[0].scope; delete old.records[0].settlement.scope;
  const before = JSON.stringify(old), migrated = validateJournal(old);
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.records[0].scope, 'including_overtime');
  for (const key of ['id', 'createdAt', 'quotedAt', 'odds', 'stake', 'status']) assert.equal(migrated.records[0][key], old.records[0][key]);
  assert.deepEqual(migrated.records[0].settlement.source, old.records[0].settlement.source);
  assert.equal(migrated.records[0].settlement.settledAt, old.records[0].settlement.settledAt);
  assert.equal(summarizeJournal(migrated).profit, 3);
  assert.equal(JSON.stringify(old), before); assert.ok(Object.isFrozen(migrated.records[0].settlement));
  assert.deepEqual(mergeJournals(migrated, old), migrated);
  const forged = JSON.parse(JSON.stringify(old)); forged.records[0].scope = 'regulation_90';
  assert.throws(() => validateJournal(forged));
  const pendingOld = JSON.parse(JSON.stringify(make())); delete pendingOld.scope;
  assert.equal(appendRecord(emptyJournal(), pendingOld).records[0].scope, 'including_overtime');
});

test('NBA totals grade exact half-point lines with full overtime scope, never an integer push', () => {
  const record = make('record-total-01', { market: 'total_points', outcome: 'over', line: 189.5, scope: 'including_overtime' });
  const result = row({ scope: 'including_overtime' });
  const win = settleJournal(journal(record), [result], { now: settledAt });
  assert.equal(win.records[0].status, 'won'); assert.equal(win.records[0].settlement.value, 190);
  assert.equal(win.records[0].settlement.line, 189.5); assert.equal(win.records[0].settlement.scope, record.scope);
  const under = make('record-total-02', { market: 'total_points', outcome: 'under', line: 190.5, scope: 'including_overtime' });
  assert.equal(settleJournal(journal(under), [result], { now: settledAt }).records[0].status, 'won');
  assert.equal(settleJournal(journal(record), [row()], { now: settledAt }).records[0].status, 'pending');
  assert.equal(settleJournal(journal(record), [{ ...result, scope: 'regulation_90' }], { now: settledAt }).records[0].status, 'pending');
  for (const input of [{ line: 190 }, { line: '189.5' }, { scope: undefined }, { scope: 'including_overtime_shootout' }, { outcome: 'home' }, { line: 600.5 }]) assert.throws(() => make('record-total-bad', { market: 'total_points', outcome: 'over', line: 189.5, scope: 'including_overtime', ...input }));
  const changed = settleJournal(win, [{ ...result, awayScore: 91 }], { now: settledAt });
  assert.equal(changed.records[0].status, 'won'); assert.ok(changed.records[0].conflict); assert.equal(summarizeJournal(changed).settled, 0);
});

function playerRecord(input = {}, selectedEvent = event) {
  return make('record-player01', { market: 'player_prop', outcome: 'over', line: 19.5, scope: 'including_overtime', playerId: '101', teamId: selectedEvent.homeId, metric: 'PTS', playerName: 'Test Player', ...input }, selectedEvent);
}
function playerResult(overrides = {}) {
  return row({ scope: 'including_overtime', availabilityBasis: 'observed-result',
    resultAvailableAt: '2026-11-19T03:00:00.000Z',
    source: { provider: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=12345', fetchedAt: '2026-11-19T03:00:00.000Z' },
    playerStats: [{ playerId: '101', teamId: '1', metric: 'PTS', value: 20, scope: 'including_overtime' }], ...overrides });
}

test('athlete grades bind the exact player, team, statistic, line and settlement scope', () => {
  const record = playerRecord(), result = playerResult();
  const graded = settleJournal(journal(record), [result], { now: settledAt }).records[0];
  assert.equal(graded.status, 'won'); assert.equal(graded.settlement.value, 20); assert.equal(graded.settlement.playerId, '101');
  assert.equal(graded.settlement.metric, 'PTS'); assert.equal(graded.settlement.teamId, '1');
  for (const changes of [{ playerId: '999' }, { teamId: '2' }, { metric: 'AST' }, { scope: 'regulation_90' }, { value: null }, { value: -1 }, { value: 20.5 }]) {
    const wrong = { ...result, playerStats: [{ ...result.playerStats[0], ...changes }] };
    assert.equal(settleJournal(journal(record), [wrong], { now: settledAt }).records[0].status, 'pending');
  }
  for (const playerStats of [undefined, [], [result.playerStats[0], result.playerStats[0]], [{ ...result.playerStats[0], didNotPlay: true, value: undefined }], [{ ...result.playerStats[0], didNotPlay: true, value: 0 }]]) {
    assert.equal(settleJournal(journal(record), [{ ...result, playerStats }], { now: settledAt }).records[0].status, 'pending');
  }
  const actualZero = { ...result, playerStats: [{ ...result.playerStats[0], value: 0 }] };
  assert.equal(settleJournal(journal(record), [actualZero], { now: settledAt }).records[0].status, 'lost');
  const under = playerRecord({ outcome: 'under', line: 20.5 });
  assert.equal(settleJournal(journal(under), [result], { now: settledAt }).records[0].status, 'won');
  for (const input of [{ playerId: 'tsdb-101' }, { teamId: '999' }, { metric: 'G' }, { playerName: '' }, { line: 20 }, { scope: undefined }]) assert.throws(() => playerRecord(input));
});

test('a corrected athlete value is quarantined even when the original won grade would stay won', () => {
  const record = playerRecord(), result = playerResult();
  const graded = settleJournal(journal(record), [result], { now: settledAt });
  const corrected = { ...result, playerStats: [{ ...result.playerStats[0], value: 21 }] };
  const conflict = settleJournal(graded, [corrected], { now: settledAt });
  assert.equal(conflict.records[0].status, 'won'); assert.equal(conflict.records[0].settlement.value, 20);
  assert.equal(conflict.records[0].conflict.reason, 'source-result-changed'); assert.equal(summarizeJournal(conflict).settled, 0);
  const tampered = JSON.parse(JSON.stringify(graded)); tampered.records[0].settlement.playerId = '999';
  assert.throws(() => validateJournal(tampered));
});

test('NHL player shots exclude shootout while its fixture final score can include shootout', () => {
  const fixture = { ...event, id: 'hockey/nhl:12345', sport: 'nhl', route: 'hockey/nhl' };
  const record = playerRecord({ line: 1.5, metric: 'S', scope: 'including_overtime_excluding_shootout' }, fixture);
  const result = row({ id: fixture.id, sport: fixture.sport, route: fixture.route, scope: 'including_overtime_shootout', homeScore: 3, awayScore: 2,
    source: { provider: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=12345', fetchedAt: '2026-11-20T00:30:00.000Z' },
    playerStats: [{ playerId: '101', teamId: '1', metric: 'S', value: 2, scope: 'including_overtime_excluding_shootout' }] });
  assert.equal(settleJournal(journal(record), [result], { now: settledAt }).records[0].status, 'won');
  assert.throws(() => playerRecord({ metric: 'S', scope: 'including_overtime_shootout' }, fixture));
});

test('Ekstraklasa totals and results accept only its separate identity and trusted 90 minute source', () => {
  const fixture = { ...event, id: 'soccer/pol.1:tsdb-12345', sport: 'football', route: 'soccer/pol.1', homeId: 'tsdb-100', awayId: 'tsdb-200' };
  const record = make('record-goals01', { market: 'total_goals', outcome: 'over', line: 2.5, scope: 'regulation_90' }, fixture);
  const result = row({ id: fixture.id, sport: fixture.sport, route: fixture.route, homeId: fixture.homeId, awayId: fixture.awayId, scope: 'regulation_90', homeScore: 2, awayScore: 1,
    availabilityBasis: 'observed-result', source: { provider: 'TheSportsDB', url: 'https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-11-19&l=4422', fetchedAt: '2026-11-20T00:30:00.000Z' } });
  const graded = settleJournal(journal(record), [result], { now: settledAt });
  assert.equal(graded.records[0].status, 'won'); assert.equal(graded.records[0].settlement.value, 3);
  for (const source of [{ ...result.source, provider: 'ESPN' }, { ...result.source, url: result.source.url.replace('4422', '4328') }, { ...result.source, url: result.source.url.replace('2026-11-19', '2026-11-18') }, { ...result.source, url: 'https://www.thesportsdb.com/api/v1/json/123/lookupevent.php?id=99999' }]) assert.equal(settleJournal(journal(record), [{ ...result, source }], { now: settledAt }).records[0].status, 'pending');
  const doubleChance = make('record-pol1X01', { market: 'double_chance_90', outcome: 'home_draw' }, fixture);
  assert.equal(settleJournal(journal(doubleChance), [{ ...result, homeScore: 1, awayScore: 1 }], { now: settledAt }).records[0].status, 'won');
  for (const changed of [{ ...fixture, homeId: '100' }, { ...fixture, id: 'soccer/pol.1:12345' }, { ...fixture, route: 'soccer/eng.1', id: 'soccer/eng.1:tsdb-12345' }]) assert.throws(() => make('record-goals-bad', { market: 'total_goals', outcome: 'over', line: 2.5, scope: 'regulation_90' }, changed));
  assert.throws(() => playerRecord({ metric: 'SH', line: 1.5, scope: 'regulation_90' }, fixture));
});

test('new market imports reject contradictory grades, earlier source evidence and unbound forecasts', () => {
  const record = playerRecord(), result = playerResult();
  const graded = JSON.parse(JSON.stringify(settleJournal(journal(record), [result], { now: settledAt })));
  for (const mutate of [j => j.records[0].settlement.value = 0, j => j.records[0].settlement.line = 18.5,
    j => j.records[0].settlement.source.url = j.records[0].settlement.source.url.replace('event=12345', 'event=99999'),
    j => j.records[0].settlement.source.fetchedAt = recordedAt,
    j => j.records[0].settlement.scope = 'regulation_90']) {
    const changed = structuredClone(graded); mutate(changed); assert.throws(() => validateJournal(changed));
  }
  const old = { ...graded, schemaVersion: 1 }; assert.throws(() => validateJournal(old));
  const forgedForecast = { status: 'published', fixtureId: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId,
    startTime, market: 'total_points', outcome: 'over', probability: 0.99, generatedAt: recordedAt, validUntil: '2026-11-18T12:10:00.000Z',
    verification: { pointInTimeVerified: true, publicationEligible: true, modelVersion: 'v1' } };
  assert.equal(evaluatePrice(2, forgedForecast, { event, market: 'total_points', outcome: 'over', now: recordedAt }).modelProbability, null);
});
