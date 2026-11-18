import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, link } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_HISTORY_ROUTES, SPORTS, isAllowedRoute, parseDay, scoreboardURL } from './catalog.js';
import { normalizeScoreboard } from './espn.js';
import { validateEvent, validateHistory } from './schema.js';
import { mapConcurrent } from './fetch.js';
import { MODEL_VERSION, recordResearchForecast } from '../models/index.js';
import { scorePredictions } from '../models/metrics.js';

const DAY = 86_400_000;
const SHA = /^[a-f0-9]{64}$/;
const hash = text => createHash('sha256').update(text).digest('hex');
const isoNow = clock => new Date(clock()).toISOString();
const fixtureIdentity = row => `${row.route}:${row.sourceEventId}`;
const EMPTY = () => ({ schemaVersion: 1, updatedAt: null, snapshots: [], events: [], forecasts: [], conflicts: [] });
const readJSON = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};

async function atomicJSON(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function contentAddressed(directory, text) {
  const sha256 = hash(text);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${sha256}.json`);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    // Link only a complete file: concurrent identical responses cannot observe
    // a half-written content-addressed destination.
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (hash(await readFile(path)) !== sha256) throw new Error('Uszkodzone istniejące archiwum migawki');
    }
  } finally { await rm(temporary, { force: true }); }
  return sha256;
}

/** Archive the exact response text, with an observation clock taken AFTER the
 * response body has arrived. Public, HTTPS allowlist only; no cookies or keys.
 */
export async function fetchObservedSnapshot(url, { fetchImpl = globalThis.fetch, clock = Date.now, timeoutMs = 8000 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'site.api.espn.com' || !parsed.pathname.startsWith('/apis/site/v2/sports/')) throw new Error('Niedozwolone źródło migawki');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Źródło migawki zwróciło HTTP ${response.status}`);
    const text = await response.text();
    const observedAt = isoNow(clock);
    if (Buffer.byteLength(text) > 10 * 1024 * 1024) throw new Error('Migawka przekracza limit rozmiaru');
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !Array.isArray(data.events)) throw new Error('Nieprawidłowa odpowiedź migawki');
    return { text, data, sha256: hash(text), observedAt, url };
  } finally { clearTimeout(timer); }
}

export function upcomingFixtures(data, { sport, route, day, observedAt }) {
  const fixtures = [];
  const seen = new Set();
  for (const event of data.events || []) {
    const competitions = sport === 'tennis'
      ? (event.groupings || []).filter(group => group.grouping?.slug === (route === 'tennis/atp' ? 'mens-singles' : 'womens-singles')).flatMap(group => group.competitions || [])
      : event.competitions || [];
    for (const c of competitions) {
      const status = c.status?.type || (sport === 'tennis' ? undefined : event.status?.type);
      if (status?.state !== 'pre' || status.completed === true) continue;
      if (sport === 'tennis' && c.type?.slug && c.type.slug !== (route === 'tennis/atp' ? 'mens-singles' : 'womens-singles')) continue;
      const startTime = c.date || c.startDate || (sport === 'tennis' ? undefined : event.date);
      if (!Number.isFinite(Date.parse(startTime)) || Date.parse(startTime) <= Date.parse(observedAt)) continue;
      if (sport === 'tennis' && startTime.slice(0, 10) !== day) continue;
      const competitors = c.competitors || [];
      if (competitors.length !== 2) continue;
      const home = competitors.find(p => p.homeAway === 'home'), away = competitors.find(p => p.homeAway === 'away');
      if (!home || !away || (sport === 'tennis' && (home.type !== 'athlete' || away.type !== 'athlete'))) continue;
      const sourceEventId = String(c.id || (sport === 'tennis' ? '' : event.id) || '');
      const homeId = String(home.id || home.team?.id || home.athlete?.id || ''), awayId = String(away.id || away.team?.id || away.athlete?.id || '');
      if (![sourceEventId, homeId, awayId].every(id => /^[\w.-]{1,80}$/.test(id)) || homeId === awayId) continue;
      const fixture = { sourceEventId, id: `${route}:${sourceEventId}`, sport, route, league: route.split('/').at(-1), startTime: new Date(startTime).toISOString(), homeId, awayId, home: home.team?.displayName || home.athlete?.displayName || '', away: away.team?.displayName || away.athlete?.displayName || '', neutralSite: sport === 'tennis' ? true : typeof c.neutralSite === 'boolean' ? c.neutralSite : true };
      if (!fixture.home || !fixture.away || seen.has(fixture.id)) continue;
      seen.add(fixture.id);
      fixtures.push(fixture);
    }
  }
  return fixtures;
}

/** No relabeling of old files: only a freshly received response can create one
 * of these result observations. Its timestamp is the first actual observation.
 */
export function observedResults(snapshot, { sport, route, day }) {
  if (!SHA.test(snapshot.sha256) || hash(snapshot.text) !== snapshot.sha256) throw new Error('Migawka nie odpowiada sumie kontrolnej');
  const normalized = normalizeScoreboard(JSON.parse(snapshot.text), { sport, route, day, fetchedAt: snapshot.observedAt, url: snapshot.url });
  return { ...normalized, events: normalized.events.map(event => validateEvent({
    ...event, resultAvailableAt: snapshot.observedAt, availabilityBasis: 'historical-snapshot',
    source: { ...event.source, observedAt: snapshot.observedAt, snapshotSha256: snapshot.sha256, snapshotPath: `snapshots/raw/${snapshot.sha256}.json` },
  })) };
}

function validateState(state) {
  if (state?.schemaVersion !== 1 || !['snapshots', 'events', 'forecasts', 'conflicts'].every(key => Array.isArray(state[key]))) throw new Error('Nieprawidłowy rejestr obserwacji');
  const ids = new Set();
  for (const event of state.events) {
    validateEvent(event);
    if (event.availabilityBasis !== 'historical-snapshot' || event.resultAvailableAt !== event.source.observedAt || event.source.fetchedAt !== event.source.observedAt || !SHA.test(event.source.snapshotSha256) || ids.has(event.id)) throw new Error('Niespójne pochodzenie obserwowanego wyniku');
    ids.add(event.id);
  }
  const forecasts = new Set();
  for (const forecast of state.forecasts) {
    if (forecasts.has(forecast.id) || fixtureIdentity(forecast) !== forecast.id || !isAllowedRoute(forecast.sport, forecast.route) || !/^\d+\.\d+\.\d+$/.test(forecast.modelVersion) || forecast.publish !== false || forecast.status !== 'research-record-only' || !SHA.test(forecast.fixtureSnapshotSha256) || !SHA.test(forecast.trainingSnapshotSha256) || !SHA.test(forecast.dataFingerprint) || !Number.isFinite(Date.parse(forecast.issuedAt)) || Date.parse(forecast.startTime) - Date.parse(forecast.issuedAt) < 5 * 60_000) throw new Error('Nieprawidłowa rejestracja przedmeczowa');
    scorePredictions([{ probabilities: forecast.probabilities, outcome: 0 }]);
    scorePredictions([{ probabilities: forecast.baseline, outcome: 0 }]);
    forecasts.add(forecast.id);
  }
  return state;
}

async function verifyArchive(root, state) {
  const references = new Map();
  for (const snapshot of state.snapshots) {
    if (!SHA.test(snapshot.sha256) || !Number.isFinite(Date.parse(snapshot.observedAt))) throw new Error('Nieprawidłowa metryka migawki');
    references.set(`raw/${snapshot.sha256}`, snapshot.sha256);
  }
  for (const event of state.events) references.set(`raw/${event.source.snapshotSha256}`, event.source.snapshotSha256);
  for (const forecast of state.forecasts) {
    references.set(`raw/${forecast.fixtureSnapshotSha256}`, forecast.fixtureSnapshotSha256);
    references.set(`training/${forecast.trainingSnapshotSha256}`, forecast.trainingSnapshotSha256);
  }
  for (const [relative, sha256] of references) {
    const bytes = await readFile(join(root, 'snapshots', `${relative}.json`));
    if (hash(bytes) !== sha256) throw new Error(`Uszkodzone archiwum ${relative}`);
  }
}

function settle(forecast, event, conflicted) {
  if (conflicted.has(forecast.id)) return { status: 'void', reason: 'Sprzeczne obserwacje źródła.' };
  if (!event) return { status: 'pending' };
  if (Date.parse(event.resultAvailableAt) <= Date.parse(forecast.issuedAt) || forecast.homeId !== event.homeId || forecast.awayId !== event.awayId || forecast.startTime !== event.startTime) return { status: 'void', reason: 'Zmiana terminu/uczestników lub wynik nie pochodzi z późniejszej obserwacji.' };
  const outcome = event.homeScore > event.awayScore ? 0 : event.homeScore === event.awayScore ? 1 : forecast.sport === 'football' ? 2 : 1;
  return { status: 'settled', outcome, probabilities: forecast.probabilities, baseline: forecast.baseline };
}

export function evaluateForward(state, { now = new Date().toISOString() } = {}) {
  validateState(state);
  const cutoff = Date.parse(now);
  if (!Number.isFinite(cutoff)) throw new Error('Nieprawidłowy czas oceny prospektywnej');
  const events = new Map(state.events.filter(event => Date.parse(event.resultAvailableAt) <= cutoff).map(event => [event.id, event]));
  const conflicted = new Set(state.conflicts.map(row => row.id));
  const makeReport = forecasts => {
    const settled = forecasts.map(forecast => settle(forecast, events.get(forecast.id), conflicted));
    const completed = settled.filter(row => row.status === 'settled');
    return { status: 'research', publication: { eligible: false, reasons: ['Rejestr prospektywny służy ocenie badawczej. Kalibracja i niezależny późniejszy test wymagają osobnego zatwierdzenia po zebraniu danych.'] }, samples: { recorded: forecasts.length, settled: completed.length, pending: settled.filter(row => row.status === 'pending').length, void: settled.filter(row => row.status === 'void').length }, metrics: completed.length ? scorePredictions(completed) : null, baselineMetrics: completed.length ? scorePredictions(completed.map(row => ({ ...row, probabilities: row.baseline }))) : null, finalTestMetrics: null };
  };
  return { schemaVersion: 1, generatedAt: now, kind: 'prospective', modelVersion: MODEL_VERSION, note: 'Prawdopodobieństwa rejestrowano prywatnie przed rozpoczęciem meczu, wyniki rozliczano wyłącznie z późniejszych zachowanych migawek. Nie są opublikowanymi prognozami. Metryki całego rejestru to opis badawczy, nie osobny końcowy test kalibracji.', sports: Object.fromEntries(SPORTS.map(sport => {
    const forecasts = state.forecasts.filter(row => row.sport === sport && row.modelVersion === MODEL_VERSION && Date.parse(row.issuedAt) <= cutoff);
    return [sport, { sport, modelVersion: MODEL_VERSION, otherVersionRecords: state.forecasts.filter(row => row.sport === sport && row.modelVersion !== MODEL_VERSION).length, ...makeReport(forecasts), leagues: [...Map.groupBy(forecasts, row => row.route)].map(([route, rows]) => ({ route, league: route.split('/').at(-1), ...makeReport(rows) })) }];
  })) };
}

/** Local/artifact mutation only. Existing forecasts/results are immutable;
 * source corrections become conflicts, not silently rewritten successes.
 */
export async function captureSnapshots({ root, from, to, sports = ['nba', 'football', 'nhl', 'tennis'], routes, concurrency = 2, fetchImpl = globalThis.fetch, clock = Date.now, onProgress = () => {} } = {}) {
  if (!root) throw new Error('Brak katalogu danych');
  const first = parseDay(from), last = parseDay(to);
  if (first > last || last - first > 7 * DAY) throw new Error('Przechwytywanie obejmuje maksymalnie osiem dni');
  if (!Array.isArray(sports) || !sports.length || sports.some(sport => !SPORTS.includes(sport) || sport === 'cs2')) throw new Error('Nieobsługiwane dyscypliny obserwacji');
  const selected = sports.flatMap(sport => (routes ? routes.filter(route => isAllowedRoute(sport, route)) : DEFAULT_HISTORY_ROUTES[sport]).map(route => ({ sport, route })));
  if (!selected.length || (routes && routes.some(route => !selected.some(item => item.route === route)))) throw new Error('Nieobsługiwana trasa obserwacji');
  const forwardDirectory = join(root, 'forward'), reportDirectory = join(root, 'reports');
  await mkdir(forwardDirectory, { recursive: true }); await mkdir(reportDirectory, { recursive: true });
  const state = validateState(await readJSON(join(forwardDirectory, 'state.json'), EMPTY()));
  await verifyArchive(root, state);
  const histories = {};
  for (const sport of sports) {
    const stored = await readJSON(join(root, 'history', `${sport}.json`), { schemaVersion: 1, events: [] });
    validateHistory(stored, sport);
    histories[sport] = stored.events;
  }
  const jobs = [];
  for (let day = first; day <= last; day += DAY) for (const selection of selected) jobs.push({ ...selection, day: new Date(day).toISOString().slice(0, 10) });
  const captures = await mapConcurrent(jobs, concurrency, async job => {
    try {
      const snapshot = await fetchObservedSnapshot(scoreboardURL(job.route, job.day), { fetchImpl, clock });
      await contentAddressed(join(root, 'snapshots', 'raw'), snapshot.text);
      const result = observedResults(snapshot, job);
      onProgress({ route: job.route, day: job.day, observed: result.events.length, rejected: result.rejected.length });
      return { job, snapshot, result };
    } catch (error) { onProgress({ route: job.route, day: job.day, error: error.message }); return { job, error: error.message }; }
  });
  const byId = new Map(state.events.map(event => [event.id, event]));
  const forecastIds = new Set(state.forecasts.map(forecast => forecast.id));
  const added = { snapshots: 0, results: 0, forecasts: 0, conflicts: 0 };
  const errors = [];
  // Merge all actual result observations before issuing new forecasts.
  for (const capture of captures) {
    if (capture.error) { errors.push({ ...capture.job, error: capture.error }); continue; }
    const { snapshot, result, job } = capture;
    if (result.rejected.length) errors.push({ ...job, error: `${result.rejected.length} odrzuconych rekordów`, rejected: result.rejected });
    state.snapshots.push({ sha256: snapshot.sha256, observedAt: snapshot.observedAt, url: snapshot.url, ...job }); added.snapshots++;
    for (const event of result.events) {
      const prior = byId.get(event.id);
      if (!prior) { byId.set(event.id, event); added.results++; }
      else if (['homeId', 'awayId', 'homeScore', 'awayScore', 'startTime'].some(field => prior[field] !== event[field])) {
        if (!state.conflicts.some(conflict => conflict.id === event.id && conflict.snapshotSha256 === snapshot.sha256)) {
          state.conflicts.push({ id: event.id, observedAt: snapshot.observedAt, originalSnapshotSha256: prior.source.snapshotSha256, snapshotSha256: snapshot.sha256, reason: 'Zmiana wyniku, terminu lub uczestników w kolejnej obserwacji.' }); added.conflicts++;
        }
      }
    }
  }
  state.events = [...byId.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id));
  const conflicted = new Set(state.conflicts.map(row => row.id));
  for (const capture of captures) {
    if (capture.error) continue;
    const { snapshot, job } = capture;
    const issuedAt = isoNow(clock);
    const training = new Map(histories[job.sport].filter(event => !conflicted.has(event.id)).map(event => [event.id, event]));
    for (const event of state.events) if (event.sport === job.sport && !conflicted.has(event.id)) training.set(event.id, event);
    for (const fixture of upcomingFixtures(snapshot.data, { ...job, observedAt: snapshot.observedAt })) {
      if (forecastIds.has(fixture.id)) continue;
      try {
        const { record, trainingEvents } = recordResearchForecast(fixture, [...training.values()], { now: issuedAt });
        const trainingSnapshotSha256 = await contentAddressed(join(root, 'snapshots', 'training'), JSON.stringify({ schemaVersion: 1, sport: fixture.sport, route: fixture.route, modelVersion: MODEL_VERSION, events: trainingEvents }));
        state.forecasts.push({ ...fixture, ...record, fixtureObservedAt: snapshot.observedAt, fixtureSnapshotSha256: snapshot.sha256, trainingSnapshotSha256 });
        forecastIds.add(fixture.id); added.forecasts++;
      } catch (error) { if (Date.parse(fixture.startTime) - Date.parse(issuedAt) >= 5 * 60_000) errors.push({ ...job, id: fixture.id, error: error.message }); }
    }
  }
  state.updatedAt = isoNow(clock);
  validateState(state);
  const report = evaluateForward(state, { now: state.updatedAt });
  await atomicJSON(join(forwardDirectory, 'state.json'), state);
  await atomicJSON(join(reportDirectory, 'forward.json'), report);
  return { schemaVersion: 1, capturedAt: state.updatedAt, added, total: { snapshots: state.snapshots.length, results: state.events.length, forecasts: state.forecasts.length, conflicts: state.conflicts.length }, errors, hasErrors: errors.length > 0 };
}
