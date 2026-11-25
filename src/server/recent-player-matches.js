import { fetchJSON } from '../data/fetch.js';
import { isAllowedRoute, leagueLabel } from './catalog.js';

const CACHE_MS = 5 * 60000, MAX_ENTRIES = 64, MAX_EVENTS = 500;
const numericId = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const runtimeEnabled = () => process.env.SPORTLAB_REMOTE_DATA !== '0'
  && (Boolean(process.env.VERCEL) || process.env.SPORTLAB_REMOTE_DATA === '1');

function utcTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const canonical = new Date(timestamp).toISOString();
  return canonical.slice(0, 16) === value.slice(0, 16)
    && (value.length === 17 || canonical.slice(0, 19) === value.slice(0, 19)) ? timestamp : null;
}

function scoreOf(competitor) {
  const score = competitor?.score;
  if (!score || !Number.isInteger(score.value) || score.value < 0 || score.value > 1000) return null;
  if (score.displayValue != null && (!/^\d+$/.test(String(score.displayValue)) || Number(score.displayValue) !== score.value)) return null;
  return score.value;
}

function normalizeSchedule(body, query, observedAt, url) {
  const { sport, route, teamId } = query, observedTime = Date.parse(observedAt);
  if (String(body?.team?.id) !== teamId || !Array.isArray(body.events) || body.events.length > MAX_EVENTS) throw new Error('Nieprawidłowy terminarz drużyny.');
  // Soccer's top-level season can remain the current year even when a
  // historical season was requested. The actual events establish its scope.
  const years = [...new Set(body.events.filter(event => sport !== 'football' || event.league?.slug === route.slice('soccer/'.length))
    .map(event => event.season?.year).filter(Number.isInteger))];
  if (years.length > 1 || query.season != null && (years.length ? years[0] !== query.season : body.season?.year !== query.season)) throw new Error('Źródło nie potwierdza żądanego sezonu.');
  const season = years[0] ?? (Number.isInteger(body.season?.year) ? body.season.year : null);
  const matches = new Map();
  let excluded = 0;
  for (const event of body.events) {
    const competitions = event?.competitions;
    if (!Array.isArray(competitions) || competitions.length !== 1) throw new Error('Niejednoznaczny mecz w terminarzu drużyny.');
    const competition = competitions[0], status = competition?.status?.type;
    if (status?.state !== 'post' || status.completed !== true) continue;
    // A soccer club's schedule can contain cup games from other leagues.
    if (sport === 'football' && event.league?.slug !== route.slice('soccer/'.length)) { excluded++; continue; }
    if (query.season != null && event.season?.year !== query.season) throw new Error('Mecz nie potwierdza żądanego sezonu.');
    if (sport === 'football' && (competition.status.period !== 2 || status.name !== 'STATUS_FULL_TIME'
      || competition.status.clock != null && (!Number.isFinite(competition.status.clock) || competition.status.clock < 5400 || competition.status.clock >= 7200)
      || competition.wasSuspended === true || competition.shootout === true
      || /extra\s*time|penalt|shootout|\bAET\b|abandon|walkover|cancel|suspend/i.test([status.detail, status.shortDetail, status.description, ...(competition.notes || []).map(note => note.text)].filter(Boolean).join(' '))
      || (competition.competitors || []).some(row => row.shootoutScore != null || row.penaltyScore != null || row.linescores?.length > 2))) { excluded++; continue; }
    const id = String(event.id ?? ''), time = utcTime(event.date), competitionTime = utcTime(competition.date);
    if (!numericId(id) || String(competition.id) !== id || time === null || time !== competitionTime) throw new Error('Nieprawidłowa tożsamość lub data zakończonego meczu.');
    if (time >= observedTime) { excluded++; continue; }
    const competitors = competition.competitors;
    if (!Array.isArray(competitors) || competitors.length !== 2) throw new Error('Nieprawidłowi uczestnicy zakończonego meczu.');
    const home = competitors.find(row => row?.homeAway === 'home'), away = competitors.find(row => row?.homeAway === 'away');
    const homeId = String(home?.id ?? ''), awayId = String(away?.id ?? '');
    if (!numericId(homeId) || !numericId(awayId) || homeId === awayId
      || String(home?.team?.id) !== homeId || String(away?.team?.id) !== awayId
      || ![homeId, awayId].includes(teamId)) throw new Error('Terminarz zawiera zakończony mecz innej drużyny.');
    const homeScore = scoreOf(home), awayScore = scoreOf(away);
    if (homeScore === null || awayScore === null || sport === 'football' && (homeScore > 30 || awayScore > 30)
      || ![home.team.displayName, away.team.displayName].every(name => typeof name === 'string' && name.trim() && name.length <= 200)) throw new Error('Nieprawidłowy wynik lub nazwa uczestnika.');
    const row = { id: `${route}:${id}`, sourceEventId: id, sport, route, league: leagueLabel(route),
      startTime: new Date(time).toISOString(), homeId, awayId, home: home.team.displayName, away: away.team.displayName,
      homeScore, awayScore, status: 'completed', resultAvailableAt: observedAt,
      availabilityBasis: 'current-descriptive-observation', descriptiveOnly: true,
      ...(Number.isInteger(event.season?.year) ? { season: event.season.year } : {}),
      ...(sport === 'football' ? { scoreScope: 'regulation_90', regulationOnly: true } : {}),
      source: { provider: 'ESPN', url, fetchedAt: observedAt } };
    const previous = matches.get(row.id);
    if (previous && ['startTime', 'homeId', 'awayId', 'homeScore', 'awayScore'].some(key => previous[key] !== row[key])) throw new Error('Sprzeczne rekordy tego samego meczu w terminarzu.');
    matches.set(row.id, row);
  }
  return { matches: [...matches.values()].sort((a, b) => b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id)), excluded, season };
}

/** Current descriptive observations only. Never persisted into model history,
 * and never asserted to have been available before this actual source read.
 */
export function createRecentPlayerMatchesLoader({ fetchImpl = fetchJSON, clock = Date.now, enabled = runtimeEnabled() } = {}) {
  const cache = new Map(), inflight = new Map();
  return async function load(events, query) {
    const { sport, route, teamId } = query;
    const base = { source: 'ESPN — terminarz drużyny', complete: false, cacheSeconds: CACHE_MS / 1000 };
    const fallback = reason => ({ events, coverage: { ...base, status: 'fallback', reason } });
    if (!enabled) return { events, coverage: { ...base, status: 'disabled', reason: 'Bieżące odświeżanie terminarza jest wyłączone.' } };
    if (!['nba', 'nhl', 'football'].includes(sport) || !isAllowedRoute(sport, route) || route === 'soccer/pol.1' || !numericId(teamId)) return fallback('Brak obsługi bieżącego terminarza tej drużyny.');
    if (query.season != null && (!Number.isInteger(query.season) || query.season < 2000 || query.season > 2100)) return fallback('Nieprawidłowy sezon terminarza.');
    const timestamp = clock();
    if (!Number.isFinite(timestamp)) return fallback('Nie można potwierdzić czasu aktualizacji.');
    const key = `${route}:${teamId}:${query.season ?? 'current'}`, cached = cache.get(key);
    let data;
    try {
      if (cached && timestamp - cached.timestamp >= 0 && timestamp - cached.timestamp < CACHE_MS) data = cached.data;
      else {
        cache.delete(key);
        let pending = inflight.get(key);
        if (!pending) {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${route}/teams/${teamId}/schedule${query.season == null ? '' : `?season=${query.season}`}`;
          pending = (async () => {
            const body = await fetchImpl(url, { timeoutMs: 4000, retries: 0 });
            const observedAt = new Date(clock()).toISOString();
            const result = { ...normalizeSchedule(body, query, observedAt, url), observedAt };
            cache.set(key, { timestamp: clock(), data: result });
            while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
            return result;
          })().finally(() => inflight.delete(key));
          inflight.set(key, pending);
        }
        data = await pending;
      }
    } catch { return fallback('Nie udało się potwierdzić bieżącego terminarza. Pokazano tylko dostępną zapisaną historię.'); }
    const merged = new Map(events.map(event => [event.id, event]));
    for (const match of data.matches) merged.set(match.id, match);
    return { events: [...merged.values()], coverage: { ...base, status: 'refreshed', fetchedAt: data.observedAt,
      latestMatchDate: data.matches[0]?.startTime || null, observedMatches: data.matches.length,
      season: data.season,
      excludedMatches: data.excluded, reason: 'Odczyt bieżącego terminarza wybranej ligi; źródło nie potwierdza kompletności wszystkich występów zawodnika.' } };
  };
}

const defaultLoader = createRecentPlayerMatchesLoader();
export function loadRecentPlayerMatches(events, query, options) {
  return options ? createRecentPlayerMatchesLoader(options)(events, query) : defaultLoader(events, query);
}
