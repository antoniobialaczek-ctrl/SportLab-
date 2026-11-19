import { readFile } from 'node:fs/promises';

const localURL = new URL('../../data/supplemental/mls.json', import.meta.url);
const ROUTE = 'soccer/usa.1', DAY = 86400000, CACHE_MS = 600000, MAX_BYTES = 12 * 1024 * 1024;
const numericId = value => typeof value === 'string' && /^[1-9]\d{0,11}$/.test(value);
// ESPN's 2026 All-Star fixture is incorrectly labelled regular-season. Bind these exclusions to provider IDs.
const exhibitionTeams = new Set(['9817', '20279']);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const stage = value => typeof value === 'string' && /^(?:regular-season|(?:eastern|western)-conference-playoffs---(?:wild-card|round-one|semifinals|final)|mls-cup)$/.test(value);
const score = value => (typeof value === 'string' && /^(?:0|[1-9]\d?)$/.test(value) || Number.isInteger(value)) && Number(value) >= 0 && Number(value) <= 30 ? Number(value) : null;
let runtimeCache = null;

export const MLS_SOURCE = Object.freeze({ provider: 'ESPN', route: ROUTE, leagueId: '770', name: 'MLS', attribution: 'Dane: ESPN', scope: 'regular-season-and-playoffs', regulationOnly: true });

export function mlsSeasonURL(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Nieprawidłowy sezon MLS');
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard?dates=${year}&limit=1000`;
}

function sourceYear(sourceURL) {
  let url;
  try { url = new URL(sourceURL); } catch { throw new Error('Nieprawidłowe źródło MLS'); }
  const year = Number(url.searchParams.get('dates'));
  if (sourceURL !== mlsSeasonURL(year)) throw new Error('Nieprawidłowy zakres źródła MLS');
  return year;
}

function regulation(status) {
  return status?.type?.state === 'post' && status.type.completed === true && status.type.name === 'STATUS_FULL_TIME'
    && status.period === 2 && Number.isFinite(status.clock) && status.clock >= 5400 && status.clock < 7200;
}

/** One season response, including playoffs. Unknown or non-regulation results are excluded. */
export function normalizeMLSResponse(body, { observedAt, sourceURL } = {}) {
  const year = sourceYear(sourceURL);
  if (!iso(observedAt) || !Array.isArray(body?.leagues) || body.leagues.length !== 1 || body.leagues[0]?.id !== '770'
    || body.leagues[0]?.slug !== 'usa.1' || body.leagues[0]?.season?.year !== year || !Array.isArray(body.events)
    || body.events.length >= 1000) throw new Error('Niezweryfikowana lub obcięta odpowiedź sezonu MLS');
  const events = [], rejected = {}, exclusions = [], seen = new Set(), sourceEventIds = [];
  const reject = (reason, sourceEventId) => { rejected[reason] = (rejected[reason] || 0) + 1; exclusions.push({ route: ROUTE, sourceEventId, season: year, reason }); };
  for (const event of body.events) {
    if (!numericId(event?.id) || seen.has(event.id)) throw new Error('Sprzeczna lub powtórzona tożsamość meczu MLS');
    seen.add(event.id);
    sourceEventIds.push(event.id);
    const competition = event.competitions?.length === 1 ? event.competitions[0] : null;
    const teams = competition?.competitors, home = teams?.find(team => team.homeAway === 'home'), away = teams?.find(team => team.homeAway === 'away');
    const startTime = timestamp(event.date);
    if (event.uid !== `s:600~l:770~e:${event.id}` || competition?.id !== event.id || competition.uid !== `${event.uid}~c:${event.id}`
      || !Array.isArray(teams) || teams.length !== 2 || !home || !away || home === away
      || ![home, away].every(team => team.type === 'team' && numericId(team.id) && team.id === team.team?.id
        && team.uid === `s:600~t:${team.id}` && team.team.uid === team.uid && typeof team.team.displayName === 'string' && team.team.displayName.trim() && team.team.displayName.length <= 200)
      || home.id === away.id || exhibitionTeams.has(home.id) || exhibitionTeams.has(away.id) || !startTime || timestamp(competition.date) !== startTime || timestamp(competition.startDate) !== startTime
      || event.season?.year !== year || !stage(event.season?.slug) || !Number.isInteger(event.season?.type)) { reject('identity-or-scope', event.id); continue; }
    if (!regulation(event.status) || !regulation(competition.status) || competition.format?.regulation?.periods !== 2
      || competition.wasSuspended === true || competition.status.period !== event.status.period
      || [home, away].some(team => team.shootoutScore !== undefined || team.penaltyScore !== undefined || team.linescores?.length > 2)) { reject('not-completed-regulation', event.id); continue; }
    const homeScore = score(home.score), awayScore = score(away.score);
    if (homeScore === null || awayScore === null || Date.parse(startTime) >= Date.parse(observedAt)) { reject('score-or-time', event.id); continue; }
    events.push({ id: `${ROUTE}:${event.id}`, sourceEventId: event.id, provider: 'ESPN', sport: 'football', route: ROUTE,
      league: 'usa.1', leagueId: 'usa.1', date: startTime, startTime, season: year, seasonStage: event.season.slug,
      homeId: home.id, awayId: away.id, home: home.team.displayName, away: away.team.displayName, homeScore, awayScore,
      state: 'post', status: 'completed', statusDetail: 'Koniec meczu (90 min)', regulationOnly: true,
      firstObservedAt: observedAt, resultAvailableAt: new Date(Math.max(Date.parse(startTime) + DAY, Date.parse(observedAt))).toISOString(),
      availabilityBasis: 'observed-result', neutralSite: typeof competition.neutralSite === 'boolean' ? competition.neutralSite : true,
      neutralSiteBasis: typeof competition.neutralSite === 'boolean' ? 'source' : 'unknown-assume-neutral',
      source: { provider: 'ESPN', url: sourceURL, fetchedAt: observedAt, season: year } });
  }
  return { events, sourceEventIds, exclusions, coverage: { complete: false, year, sourceURL, returnedEvents: body.events.length, acceptedEvents: events.length,
    rejected, requestedLimit: 1000, pagesObserved: 1, pagination: 'not-provided', scope: 'regular-season-and-playoffs', regulationOnly: true } };
}

export function validateMLSHistory(data) {
  if (!data || data.schemaVersion !== 1 || data.kind !== 'supplemental-descriptive-history' || data.route !== ROUTE
    || data.modelExperimentEligible !== false || !iso(data.fetchedAt) || !Array.isArray(data.events)) throw new Error('Nieprawidłowa oddzielna historia MLS');
  const ids = new Set();
  for (const row of data.events) {
    const year = sourceYear(row.source?.url);
    if (!numericId(row.sourceEventId) || row.id !== `${ROUTE}:${row.sourceEventId}` || ids.has(row.id)
      || !numericId(row.homeId) || !numericId(row.awayId) || row.homeId === row.awayId || exhibitionTeams.has(row.homeId) || exhibitionTeams.has(row.awayId) || row.route !== ROUTE
      || row.sport !== 'football' || row.league !== 'usa.1' || row.status !== 'completed' || row.state !== 'post' || row.regulationOnly !== true
      || row.season !== year || row.source.season !== year || !stage(row.seasonStage)
      || ![row.home, row.away].every(value => typeof value === 'string' && value.trim() && value.length <= 200)
      || ![row.homeScore, row.awayScore].every(value => Number.isInteger(value) && value >= 0 && value <= 30)
      || ![row.startTime, row.firstObservedAt, row.resultAvailableAt, row.source?.fetchedAt].every(iso)
      || row.availabilityBasis !== 'observed-result' || row.source.provider !== 'ESPN'
      || Date.parse(row.source.fetchedAt) < Date.parse(row.firstObservedAt) || Date.parse(row.source.fetchedAt) <= Date.parse(row.startTime)
      || Date.parse(row.source.fetchedAt) > Date.parse(data.fetchedAt)
      || Date.parse(row.resultAvailableAt) < Math.max(Date.parse(row.startTime) + DAY, Date.parse(row.firstObservedAt))
      || Date.parse(row.resultAvailableAt) > Math.max(Date.parse(row.startTime) + DAY, Date.parse(row.source.fetchedAt))) throw new Error('Nieprawidłowy wynik lub pochodzenie MLS');
    ids.add(row.id);
  }
  return data;
}

export function mergeMLSHistory(previous, incoming) {
  const events = new Map(previous.map(row => [row.id, row]));
  for (let row of incoming) {
    const old = events.get(row.id);
    if (old && ['homeId', 'awayId', 'route', 'season', 'seasonStage'].some(field => old[field] !== row[field])) throw new Error('Sprzeczna tożsamość obserwowanego meczu MLS');
    if (old) {
      const changed = ['homeScore', 'awayScore', 'startTime'].some(field => old[field] !== row[field]);
      row = { ...row, firstObservedAt: old.firstObservedAt, resultAvailableAt: changed ? row.resultAvailableAt : old.resultAvailableAt,
        ...(old.revisions ? { revisions: old.revisions } : {}) };
      if (changed) row.revisions = [...(old.revisions || []), { observedAt: row.source.fetchedAt,
        previous: { homeScore: old.homeScore, awayScore: old.awayScore, startTime: old.startTime, resultAvailableAt: old.resultAvailableAt } }];
    }
    events.set(row.id, row);
  }
  return [...events.values()].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
}

async function downloadSeason(url, fetchImpl) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`MLS: HTTP ${response.status}`);
    if (Number(response.headers?.get('content-length')) > MAX_BYTES) throw new Error('Zbyt duża odpowiedź MLS');
    let bytes;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let size = 0;
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Zbyt duża odpowiedź MLS'); }
        chunks.push(Buffer.from(next.value));
      }
      bytes = Buffer.concat(chunks, size);
    } else { bytes = Buffer.from(await response.text()); if (bytes.length > MAX_BYTES) throw new Error('Zbyt duża odpowiedź MLS'); }
    return JSON.parse(bytes.toString('utf8'));
  } finally { clearTimeout(timer); }
}

/** Runtime refresh is one bounded free ESPN request per ten-minute cache interval. */
export async function loadMLSHistory({ teamIds = [], now = Date.now(), fetchImpl = globalThis.fetch, historyData, historyURL = localURL,
  refresh = process.env.SPORTLAB_REMOTE_DATA !== '0' && (Boolean(process.env.VERCEL) || process.env.SPORTLAB_REMOTE_DATA === '1') } = {}) {
  if (!Number.isFinite(now) || !Array.isArray(teamIds) || teamIds.length > 2 || !teamIds.every(numericId)) throw new Error('Nieprawidłowe parametry historii MLS');
  let local, localError = null, remoteError = null;
  try { local = validateMLSHistory(historyData || JSON.parse(await readFile(historyURL, 'utf8'))); }
  catch (error) { localError = error.message; local = { events: [], fetchedAt: null, coverage: { complete: false } }; }
  let selected = local;
  if (refresh) {
    const year = new Date(now).getUTCFullYear();
    const previous = runtimeCache?.fetchImpl === fetchImpl && runtimeCache.year === year ? runtimeCache : null;
    if (!previous || now < previous.at || now - previous.at >= CACHE_MS) {
      const base = previous?.data || local;
      const promise = (async () => {
        try {
          const startedAt = Date.now(), body = await downloadSeason(mlsSeasonURL(year), fetchImpl);
          const observedAt = new Date(now + Math.max(0, Date.now() - startedAt)).toISOString();
          const incoming = normalizeMLSResponse(body, { observedAt, sourceURL: mlsSeasonURL(year) });
          const currentIds = new Set(incoming.events.map(row => row.id));
          if (base.events.some(row => row.season === year && !currentIds.has(row.id))) throw new Error('Wycofany lub zmieniony wynik MLS wymaga ponownej weryfikacji');
          const data = validateMLSHistory({ schemaVersion: 1, kind: 'supplemental-descriptive-history', route: ROUTE, modelExperimentEligible: false,
            fetchedAt: observedAt, events: mergeMLSHistory(base.events, incoming.events), exclusions: [...(base.exclusions || []).filter(row => row.season !== year), ...incoming.exclusions], coverage: { ...base.coverage, complete: false,
              runtimeSeason: incoming.coverage, note: 'Oddzielna historia opisowa. Tylko potwierdzone wyniki 90 min; bez dogrywki, karnych i All-Star. ESPN nie udostępnia tu sumy stron ani gwarancji pełnego sezonu.' } });
          return { data };
        } catch { return { data: base, error: 'Automatyczna aktualizacja MLS jest niedostępna lub nie przeszła weryfikacji; użyto ostatniej zweryfikowanej historii.' }; }
      })();
      runtimeCache = { at: now, year, fetchImpl, promise, data: previous?.data };
    }
    const cache = runtimeCache, result = await cache.promise;
    cache.data = result.data;
    selected = result.data;
    remoteError = result.error || null;
  }
  return { events: selected.events, exclusions: selected.exclusions || [], fetchedAt: selected.fetchedAt, source: MLS_SOURCE, status: selected.events.length ? 'available' : 'unavailable',
    coverage: { ...selected.coverage, complete: false }, modelExperimentEligible: false, localError, remoteError, usingLocalFallback: Boolean(remoteError),
    runtimeData: { origin: refresh && !remoteError ? 'espn' : 'local', fallback: Boolean(remoteError), ...(remoteError ? { reason: remoteError } : {}), cacheSeconds: CACHE_MS / 1000 } };
}
