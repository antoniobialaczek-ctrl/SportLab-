import test from 'node:test';
import assert from 'node:assert/strict';
import { ekstraklasaDayURL, ekstraklasaEventURL, fetchEkstraklasaJSON, normalizeEkstraklasaResponse } from '../src/server/ekstraklasa-source.js';
const observedAt = '2026-11-19T10:00:00.000Z';
const fixture = extra => ({ idEvent: '2490318', idLeague: '4422', strSport: 'Soccer', strHomeTeam: 'Piast Gliwice', strAwayTeam: 'Korona Kielce', idHomeTeam: '135300', idAwayTeam: '135298', strTimestamp: '2026-11-20T17:00:00', dateEvent: '2026-11-20', strTime: '17:00:00', strStatus: 'NS', strPostponed: 'no', intHomeScore: null, intAwayScore: null, ...extra });
const parse = (events, extra = {}) => normalizeEkstraklasaResponse({ events }, { observedAt, day: '2026-11-20', sourceURL: ekstraklasaDayURL('2026-11-20'), ...extra });
test('Ekstraklasa day feed uses exact league identities, UTC time and a separate provider namespace', () => {
  const result = parse([fixture()]);
  assert.equal(result.events[0].id, 'soccer/pol.1:tsdb-2490318');
  assert.equal(result.events[0].homeId, 'tsdb-135300');
  assert.equal(result.events[0].date, '2026-11-20T17:00:00.000Z');
  assert.equal(result.events[0].homeScore, null);
  assert.equal(result.events[0].forecast.status, 'withheld');
  assert.equal(result.coverage.complete, false);
  assert.deepEqual(result.history, []);
  assert.throws(() => ekstraklasaDayURL('2026-02-30'));
  assert.throws(() => ekstraklasaEventURL('2490318'));
});
test('Ekstraklasa excludes uncertain timing, postponed, wrong league, live-after-future and conflicting observations', () => {
  for (const extra of [{ strTimestamp: null }, { strTime: '18:00:00' }, { strTime: null }, { strTime: '00:00:00', strTimestamp: '2026-11-20T00:00:00' }, { dateEvent: '2026-11-21' }, { strPostponed: 'yes' }, { idLeague: '4328' }, { strStatus: 'FT', intHomeScore: '1', intAwayScore: '0' }, { strStatus: 'HT' }, { idAwayTeam: '135300' }]) assert.equal(parse([fixture(extra)]).events.length, 0);
  assert.equal(parse([fixture(), fixture({ strAwayTeam: 'Other' })]).events.length, 0);
  assert.equal(parse([fixture(), fixture()]).events.length, 1);
});
test('Ekstraklasa final results become available at actual observation, never at a reconstructed past publication time', () => {
  const result = parse([fixture({ strStatus: 'FT', intHomeScore: '2', intAwayScore: '1' })], { observedAt: '2026-11-21T10:00:00.000Z' });
  assert.equal(result.history[0].firstObservedAt, '2026-11-21T10:00:00.000Z');
  assert.equal(result.history[0].resultAvailableAt, '2026-11-21T17:00:00.000Z');
  assert.equal(result.history[0].availabilityBasis, 'observed-result');
  assert.equal(result.history[0].homeScore, 2);
  assert.equal(result.history[0].source.provider, 'TheSportsDB');
  for (const extra of [{ intHomeScore: '' }, { intHomeScore: null }, { intHomeScore: '-1' }, { intHomeScoreExtra: '1' }, { strStatus: 'AET' }]) assert.equal(parse([fixture({ strStatus: 'FT', intHomeScore: '2', intAwayScore: '1', ...extra })], { observedAt: '2026-11-21T10:00:00.000Z' }).history.length, 0);
});
test('Ekstraklasa API rejects source errors, untrusted hosts and rate limits without retrying', async () => {
  let calls = 0;
  await assert.rejects(fetchEkstraklasaJSON(ekstraklasaDayURL('2026-11-20'), { fetchImpl: async () => { calls++; return { ok: false, status: 429 }; } }));
  assert.equal(calls, 1);
  await assert.rejects(fetchEkstraklasaJSON('https://other.invalid/eventsday.php'));
  await assert.rejects(fetchEkstraklasaJSON(ekstraklasaDayURL('2026-11-20'), { fetchImpl: async () => ({ ok: true, json: async () => ({ events: [], Message: 'Invalid League ID passed' }) }) }));
  assert.throws(() => parse(null, { sourceURL: ekstraklasaDayURL('2026-11-21') }));
  assert.throws(() => normalizeEkstraklasaResponse({ events: [], Message: 'Invalid League ID passed' }, { observedAt, sourceURL: ekstraklasaDayURL('2026-11-20') }));
  assert.equal(parse(null).events.length, 0);
});
