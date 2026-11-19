import { ekstraklasaDayURL, ekstraklasaEventURL, ekstraklasaNextURL, fetchEkstraklasaJSON, normalizeEkstraklasaResponse } from './ekstraklasa-source.js';

const cache = new Map();
let queue = Promise.resolve(), waiting = 0, lastStarted = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function observe(url, { day = null, fetchImpl = globalThis.fetch } = {}) {
  const old = cache.get(url);
  if (old?.fetchImpl === fetchImpl && (old.pending || Date.now() - old.at < 5 * 60000)) return old.promise;
  if (waiting >= 3) throw new Error('Odczyt Ekstraklasy jest zajęty. Spróbuj za chwilę.');
  waiting++;
  const entry = { fetchImpl, pending: true };
  entry.promise = queue.then(async () => {
    const delay = 6000 - (Date.now() - lastStarted);
    if (delay > 0) await sleep(delay);
    lastStarted = Date.now();
    const data = await fetchEkstraklasaJSON(url, { fetchImpl });
    const observedAt = new Date().toISOString();
    const normalized = normalizeEkstraklasaResponse(data, { day, observedAt, sourceURL: url });
    if (data.events?.length && !normalized.events.length && normalized.exclusions.length) throw new Error('Źródło nie potwierdza poprawnych spotkań Ekstraklasy.');
    return normalized;
  }).then(result => { entry.at = Date.now(); entry.pending = false; return result; }, error => { cache.delete(url); throw error; })
    .finally(() => { waiting--; });
  queue = entry.promise.catch(() => {});
  if (cache.size >= 32) cache.delete(cache.keys().next().value);
  cache.set(url, entry);
  return entry.promise;
}

export const getEkstraklasaDay = (day, options = {}) => observe(ekstraklasaDayURL(day), { ...options, day });
export const getEkstraklasaFixture = (id, options = {}) => observe(ekstraklasaEventURL(id), options);
export const getEkstraklasaNext = (options = {}) => observe(ekstraklasaNextURL(), options);

export function ekstraklasaDetails(event, fetchedAt) {
  return {
    players: [], teamStats: [], injuries: [], playerAnalysis: [], source: 'TheSportsDB', fetchedAt,
    availability: { identityVerified: false, eventId: event.sourceEventId, fetchedAt, status: 'unavailable' },
    odds: { fixtureId: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId,
      startTime: event.date, fetchedAt, status: event.state === 'pre' ? 'unavailable' : 'closed', quotes: [],
      reason: 'Darmowy odczyt TheSportsDB nie zawiera kursów dla Ekstraklasy.', source: 'TheSportsDB' },
    note: 'Darmowe dane TheSportsDB obejmują terminarz i wyniki. Statystyki zawodników, składy, kontuzje i kursy tej ligi nie są dostępne w tym źródle.',
  };
}
