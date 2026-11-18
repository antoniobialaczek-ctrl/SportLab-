import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isAllowedRoute } from './catalog.js';
import { validateEvent } from './schema.js';
import { normalizeScoreboard } from './espn.js';
import { MODEL_CODE_FINGERPRINT, MODEL_VERSION, recordResearchForecast } from '../models/index.js';

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[\w.-]{1,80}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function fixtureFromRaw(data, row) {
  const expectedTour = row.route === 'tennis/atp' ? 'mens-singles' : 'womens-singles';
  const matches = [];
  for (const event of data.events || []) {
    const competitions = row.sport === 'tennis'
      ? (event.groupings || []).filter(g => g.grouping?.slug === expectedTour).flatMap(g => g.competitions || [])
      : event.competitions || [];
    for (const c of competitions) {
      const id = String(c.id || (row.sport === 'tennis' ? '' : event.id) || '');
      if (id !== row.sourceEventId) continue;
      if (row.sport === 'tennis' && c.type?.slug && c.type.slug !== expectedTour) continue;
      const status = c.status?.type || (row.sport === 'tennis' ? undefined : event.status?.type);
      if (status?.state !== 'pre' || status.completed === true) throw new Error('Dowód meczu nie przedstawia stanu przed rozpoczęciem');
      if (!Array.isArray(c.competitors) || c.competitors.length !== 2) throw new Error('Niejednoznaczni uczestnicy w dowodzie meczu');
      const home = c.competitors.find(p => p.homeAway === 'home');
      const away = c.competitors.find(p => p.homeAway === 'away');
      if (!home || !away || (row.sport === 'tennis' && (home.type !== 'athlete' || away.type !== 'athlete'))) throw new Error('Niejednoznaczni uczestnicy w dowodzie meczu');
      const time = c.date || c.startDate || (row.sport === 'tennis' ? undefined : event.date);
      if (!Number.isFinite(Date.parse(time))) throw new Error('Brak godziny konkretnego meczu w dowodzie');
      matches.push({
        sourceEventId: id, id: `${row.route}:${id}`, sport: row.sport, route: row.route, league: row.route.split('/').at(-1),
        startTime: new Date(time).toISOString(),
        homeId: String(home.id || home.team?.id || home.athlete?.id || ''),
        awayId: String(away.id || away.team?.id || away.athlete?.id || ''),
        home: home.team?.displayName || home.athlete?.displayName || '',
        away: away.team?.displayName || away.athlete?.displayName || '',
        neutralSite: row.sport === 'tennis' ? true : typeof c.neutralSite === 'boolean' ? c.neutralSite : true,
      });
    }
  }
  if (matches.length !== 1) throw new Error('Dowód nie identyfikuje jednego konkretnego meczu');
  return matches[0];
}

/** Authenticate the relationship between stored records and archived inputs.
 * Missing code fingerprints identify legacy research only, never valid trials.
 * A changed current implementation cannot silently replay a frozen experiment.
 */
export async function auditForecastEvidence(root, state) {
  if (!root || !Array.isArray(state?.forecasts) || !Array.isArray(state?.snapshots)) throw new Error('Nieprawidłowy stan audytu dowodów');
  const verifiedIds = [], legacyIds = [], seen = new Set();
  const cache = new Map();
  const observedRows = new Map();
  async function archived(kind, sha) {
    if (!SHA.test(sha || '')) throw new Error('Nieprawidłowy skrót dowodu');
    const key = `${kind}/${sha}`;
    if (!cache.has(key)) {
      const bytes = await readFile(join(root, 'snapshots', kind, `${sha}.json`));
      if (hash(bytes) !== sha) throw new Error(`Uszkodzony dowód ${key}`);
      cache.set(key, JSON.parse(bytes.toString('utf8')));
    }
    return cache.get(key);
  }
  for (const row of state.forecasts) {
    if (!row || typeof row.id !== 'string' || seen.has(row.id)) throw new Error('Powielona lub nieprawidłowa prognoza w audycie');
    seen.add(row.id);
    if (row.modelCodeFingerprint === undefined) { legacyIds.push(row.id); continue; }
    const fail = reason => { throw new Error(`${row.id}: ${reason}`); };
    if (row.modelCodeFingerprint !== MODEL_CODE_FINGERPRINT || row.modelVersion !== MODEL_VERSION) fail('Kod modelu zmienił się względem zamrożonej prognozy; wymagany oddzielny przegląd wersji');
    if (!isAllowedRoute(row.sport, row.route) || !ID.test(row.sourceEventId || '') || row.id !== `${row.route}:${row.sourceEventId}` || row.league !== row.route.split('/').at(-1)) fail('Niespójna tożsamość prognozy');
    if (row.status !== 'research-record-only' || row.publish !== false || !canonicalTime(row.issuedAt) || !canonicalTime(row.fixtureObservedAt) || !canonicalTime(row.startTime) || Date.parse(row.fixtureObservedAt) > Date.parse(row.issuedAt) || Date.parse(row.startTime) - Date.parse(row.issuedAt) < 300000) fail('Nieprawidłowa chronologia rejestracji');
    const observations = state.snapshots.filter(snapshot => snapshot.sha256 === row.fixtureSnapshotSha256 && snapshot.route === row.route && snapshot.sport === row.sport && snapshot.observedAt === row.fixtureObservedAt);
    if (!observations.length) fail('Brak zarejestrowanej obserwacji dowodu meczu');
    for (const observation of observations) {
      let url;
      try { url = new URL(observation.url); } catch { fail('Nieprawidłowe źródło dowodu meczu'); }
      if (url.protocol !== 'https:' || url.hostname !== 'site.api.espn.com' || !url.pathname.startsWith(`/apis/site/v2/sports/${row.route}/`)) fail('Nieprawidłowe źródło dowodu meczu');
    }
    const raw = await archived('raw', row.fixtureSnapshotSha256);
    if (!raw || !Array.isArray(raw.events)) fail('Nieprawidłowy surowy dowód meczu');
    const fixture = fixtureFromRaw(raw, row);
    for (const [field, value] of Object.entries(fixture)) if (row[field] !== value) fail(`Dowód meczu nie potwierdza pola ${field}`);
    const training = await archived('training', row.trainingSnapshotSha256);
    if (!training || training.schemaVersion !== 1 || training.sport !== row.sport || training.route !== row.route || training.modelVersion !== row.modelVersion || training.modelCodeFingerprint !== row.modelCodeFingerprint || !Array.isArray(training.events)) fail('Niespójne metadane zamrożonego treningu');
    for (const event of training.events) {
      validateEvent(event);
      if (event.sport !== row.sport || event.route !== row.route || Date.parse(event.resultAvailableAt) >= Date.parse(row.issuedAt) || Date.parse(event.source.fetchedAt) >= Date.parse(row.issuedAt)) fail('Trening zawiera dane niedostępne w chwili rejestracji');
      if (event.availabilityBasis === 'historical-snapshot') {
        if (event.resultAvailableAt !== event.source.observedAt || event.source.fetchedAt !== event.source.observedAt) fail('Obserwowany trening ma niespójny czas dowodu');
        const key = `${event.source.snapshotSha256}:${event.route}:${event.source.observedAt}`;
        if (!observedRows.has(key)) {
          const source = await archived('raw', event.source.snapshotSha256);
          const compactDay = new URL(event.source.url).searchParams.get('dates');
          const day = /^\d{8}$/.test(compactDay || '') ? `${compactDay.slice(0, 4)}-${compactDay.slice(4, 6)}-${compactDay.slice(6, 8)}` : undefined;
          observedRows.set(key, normalizeScoreboard(source, { sport: event.sport, route: event.route, fetchedAt: event.source.observedAt, url: event.source.url, day }).events);
        }
        const candidates = observedRows.get(key).filter(candidate => candidate.id === event.id);
        if (candidates.length !== 1 || ['sport', 'league', 'route', 'startTime', 'homeId', 'awayId', 'homeScore', 'awayScore', 'neutralSite'].some(field => candidates[0][field] !== event[field])) fail('Archiwum nie potwierdza obserwowanego wyniku treningowego');
      }
    }
    const replay = recordResearchForecast(fixture, training.events, { now: row.issuedAt }).record;
    for (const field of ['modelVersion', 'modelCodeFingerprint', 'issuedAt', 'dataFingerprint', 'knownEventCount', 'outcomes', 'calibration']) {
      if (!isDeepStrictEqual(replay[field], row[field])) fail(`Odtworzenie treningu nie potwierdza pola ${field}`);
    }
    for (const field of ['probabilities', 'baseline']) {
      if (!Array.isArray(row[field]) || replay[field].length !== row[field].length || replay[field].some((p, i) => !Number.isFinite(row[field][i]) || Math.abs(p - row[field][i]) > 1e-12)) fail(`Odtworzony model nie potwierdza wektora ${field}`);
    }
    verifiedIds.push(row.id);
  }
  // A valid pre-match vector does not authenticate the later outcome. Every
  // settlement, including legacy research, must match its actual raw response.
  for (const event of state.events || []) {
    validateEvent(event);
    if (event.availabilityBasis !== 'historical-snapshot' || event.resultAvailableAt !== event.source.observedAt || event.source.fetchedAt !== event.source.observedAt) throw new Error('Niespójny czas dowodu wyniku rozliczenia');
    if (!state.snapshots.some(s => s.sha256 === event.source.snapshotSha256 && s.route === event.route && s.observedAt === event.source.observedAt && s.url === event.source.url)) throw new Error('Brak obserwacji dowodu wyniku rozliczenia');
    const raw = await archived('raw', event.source.snapshotSha256);
    const compact = new URL(event.source.url).searchParams.get('dates');
    const day = /^\d{8}$/.test(compact || '') ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : undefined;
    const candidates = normalizeScoreboard(raw, { sport: event.sport, route: event.route, fetchedAt: event.source.observedAt, url: event.source.url, day }).events.filter(row => row.id === event.id);
    if (candidates.length !== 1 || ['sport', 'league', 'route', 'startTime', 'homeId', 'awayId', 'homeScore', 'awayScore', 'neutralSite'].some(field => event[field] !== candidates[0][field])) throw new Error('Archiwum nie potwierdza wyniku rozliczenia');
  }
  for (const row of state.voids || []) {
    const forecast = state.forecasts.find(f => f.id === row.id);
    if (!forecast || Date.parse(row.observedAt) < Date.parse(forecast.issuedAt)) throw new Error('Niespójny czas unieważnienia');
    if (row.reason === 'result-not-observed-in-14-days') {
      if (Date.parse(row.observedAt) - Date.parse(forecast.startTime) <= 14 * 86400000 || state.events?.some(e => e.id === row.id && Date.parse(e.resultAvailableAt) <= Date.parse(row.observedAt))) throw new Error('Nieprawidłowy termin braku wyniku');
      continue;
    }
    const metadata = state.snapshots.find(s => s.sha256 === row.snapshotSha256 && s.route === forecast.route && s.observedAt === row.observedAt);
    if (!metadata) throw new Error('Brak dowodu unieważnienia');
    const raw = await archived('raw', row.snapshotSha256);
    if (row.reason === 'invalid-final-record') {
      const rejected = normalizeScoreboard(raw, { sport: forecast.sport, route: forecast.route, day: metadata.day, fetchedAt: row.observedAt, url: metadata.url }).rejected;
      if (!rejected.some(r => String(r.id) === forecast.sourceEventId)) throw new Error('Archiwum nie potwierdza nieprawidłowego wyniku');
    } else if (row.reason === 'terminal-source-status') {
      const competitions = (raw.events || []).flatMap(e => forecast.sport === 'tennis' ? (e.groupings || []).flatMap(g => g.competitions || []) : e.competitions || []);
      if (!competitions.some(c => String(c.id) === forecast.sourceEventId && /cancelled|canceled|abandoned|walkover|walk.over|retired|retirement|defaulted|w\/o|\bret\./i.test([c.status?.type?.name, c.status?.type?.description, c.status?.type?.detail, ...(c.notes || []).map(n => n.text)].join(' ')))) throw new Error('Archiwum nie potwierdza odwołania lub przerwania meczu');
    } else throw new Error('Nieznany powód unieważnienia');
  }
  for (const conflict of state.conflicts || []) {
    const original = state.events?.find(event => event.id === conflict.id);
    const metadata = state.snapshots.find(s => s.sha256 === conflict.snapshotSha256 && s.route === original?.route && s.observedAt === conflict.observedAt);
    if (!original || !metadata || original.source.snapshotSha256 !== conflict.originalSnapshotSha256 || Date.parse(conflict.observedAt) < Date.parse(original.resultAvailableAt)) throw new Error('Brak spójnego dowodu korekty wyniku');
    const raw = await archived('raw', conflict.snapshotSha256);
    const corrected = normalizeScoreboard(raw, { sport: original.sport, route: original.route, fetchedAt: conflict.observedAt, url: metadata.url, day: metadata.day }).events.find(event => event.id === original.id);
    if (!corrected || !['homeId', 'awayId', 'homeScore', 'awayScore', 'startTime'].some(field => corrected[field] !== original[field])) throw new Error('Archiwum nie potwierdza sprzeczności wyniku');
  }
  return { verifiedIds, legacyIds };
}
