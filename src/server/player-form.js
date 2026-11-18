import { fetchJSON } from '../data/fetch.js';

const DEFINITIONS = {
  nba: { primary: 'PTS', metrics: [
    { key: 'PTS', label: 'Punkty', aliases: ['PTS', 'POINTS'] },
    { key: 'AST', label: 'Asysty', aliases: ['AST', 'ASSISTS'] },
    { key: 'REB', label: 'Zbiórki', aliases: ['REB', 'REBOUNDS'] },
  ] },
  nhl: { primary: 'G', metrics: [
    { key: 'G', label: 'Gole', aliases: ['G', 'GOALS'] },
    { key: 'A', label: 'Asysty', aliases: ['A', 'ASSISTS'] },
    { key: 'S', label: 'Strzały na bramkę', aliases: ['S', 'SOG', 'SHOTS'] },
  ] },
  football: { primary: 'G', metrics: [
    { key: 'G', label: 'Gole', aliases: ['G', 'GOALS'] },
    { key: 'A', label: 'Asysty', aliases: ['A', 'ASSISTS'] },
    { key: 'SH', label: 'Strzały', aliases: ['SH', 'SHOTS'] },
  ] },
};

const numeric = value => (typeof value === 'number' || typeof value === 'string')
  && /^\d+(?:\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value))
  ? Number(value) : null;

function parseMinutes(value) {
  if (typeof value === 'string' && /^\d{1,3}:[0-5]\d$/.test(value)) {
    const [minutes, seconds] = value.split(':').map(Number);
    return minutes + seconds / 60;
  }
  return numeric(value);
}

function summarizeObservations(values, label) {
  const observations = [...values].sort((a, b) => b.date.localeCompare(a.date) || a.matchId.localeCompare(b.matchId));
  const sorted = observations.map(row => row.value).sort((a, b) => a - b), size = sorted.length;
  return { label, average: sorted.reduce((sum, value) => sum + value, 0) / size, sample: size,
    median: size % 2 ? sorted[(size - 1) / 2] : (sorted[size / 2 - 1] + sorted[size / 2]) / 2,
    last5Average: observations.slice(0, 5).reduce((sum, row) => sum + row.value, 0) / Math.min(5, size),
    minimum: sorted[0], maximum: sorted.at(-1), observations };
}

function summaryMatches(data, match, { allowMissingHeader = false } = {}) {
  if (!data?.header) return allowMissingHeader;
  const header = data.header;
  if (String(header.id) !== String(match.sourceEventId)) return false;
  const competitions = Array.isArray(header.competitions) ? header.competitions.filter(row => String(row?.id) === String(match.sourceEventId)) : [];
  if (competitions.length !== 1) return false;
  const competition = competitions[0];
  if (!Number.isFinite(Date.parse(competition.date)) || Date.parse(competition.date) !== Date.parse(match.startTime)) return false;
  const participants = competition.competitors;
  if (!Array.isArray(participants) || participants.length !== 2) return false;
  const home = participants.find(row => row?.homeAway === 'home'), away = participants.find(row => row?.homeAway === 'away');
  if (!home || !away || ![home.id, away.id].every(id => /^\d{1,14}$/.test(String(id))) || String(home.id) === String(away.id)
    || String(home.id) !== match.homeId || String(away.id) !== match.awayId
    || home?.team?.id != null && String(home.team.id) !== match.homeId || away?.team?.id != null && String(away.team.id) !== match.awayId) return false;
  const status = competition.status?.type;
  return status?.state === 'post' && status.completed === true;
}

/** Shared bounded cache for successful historical boxscores. Failed requests
 * and empty payloads are retried, and simultaneous consumers share one fetch.
 */
export function createSummaryLoader({ fetchImpl = fetchJSON, clock = Date.now, ttl = 15 * 60000, maxEntries = 128, concurrency = 3 } = {}) {
  const cache = new Map(), inflight = new Map(), queue = [];
  let active = 0;
  async function run(url) {
    if (active >= concurrency) await new Promise(resolve => queue.push(resolve));
    else active++;
    try {
      const data = await fetchImpl(url, { timeoutMs: 3500, retries: 0 });
      let validHeader = false;
      if (data?.header) {
        let wanted; try { wanted = new URL(url).searchParams.get('event'); } catch { /* Not a provider URL; cannot cache its header. */ }
        const competition = data.header.competitions?.find?.(row => String(row?.id) === wanted);
        const home = competition?.competitors?.find?.(row => row?.homeAway === 'home');
        const away = competition?.competitors?.find?.(row => row?.homeAway === 'away');
        validHeader = Boolean(wanted && competition && summaryMatches(data, { sourceEventId: wanted, startTime: competition.date, homeId: String(home?.id), awayId: String(away?.id) }));
      }
      if (validHeader && Array.isArray(data?.boxscore?.players) && data.boxscore.players.some(group => /^\d{1,14}$/.test(String(group?.team?.id || ''))
        && Array.isArray(group.statistics) && group.statistics.some(category => Array.isArray(category?.athletes) && category.athletes.some(row => Array.isArray(row?.stats) && row.stats.length)))) {
        cache.set(url, { data, expiresAt: clock() + ttl });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      }
      return data;
    } finally {
      const waiting = queue.shift();
      if (waiting) waiting(); else active--;
    }
  }
  return function load(url) {
    const cached = cache.get(url);
    if (cached?.expiresAt > clock()) return Promise.resolve(cached.data);
    cache.delete(url);
    if (inflight.has(url)) return inflight.get(url);
    const pending = run(url).finally(() => inflight.delete(url));
    inflight.set(url, pending);
    return pending;
  };
}
const defaultSummaryLoader = createSummaryLoader();

/** Retrospective, descriptive form only. A missing match/statistic is never 0. */
export function selectPreviousMatches(events, { sport, route, teamId, cutoff, count = 10 }) {
  const before = Date.parse(cutoff);
  if (!Number.isFinite(before) || !Number.isInteger(count) || count < 1 || count > 10) throw new Error('Nieprawidłowy zakres formy zawodników');
  const unique = new Map();
  for (const event of events) {
    if (event.sport !== sport || event.route !== route || event.status !== 'completed'
      || (event.homeId !== teamId && event.awayId !== teamId)
      || !(Date.parse(event.startTime) < before) || !(Date.parse(event.resultAvailableAt) < before)) continue;
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  return [...unique.values()].sort((a, b) => b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id)).slice(0, count);
}

/** Aggregate actual boxscore observations, once per player/metric/match. */
export function aggregatePlayerForm(records, { sport, teamId, limit = 10 }) {
  const definition = DEFINITIONS[sport];
  if (!definition) return { players: [], sampledMatches: [], primaryMetric: null, conflicts: 0 };
  const totals = new Map(), sampledMatches = [], seenMatches = new Set();
  let conflicts = 0;
  for (const { match, data, url } of records) {
    if (seenMatches.has(match.id) || !summaryMatches(data, match, { allowMissingHeader: true })) continue;
    seenMatches.add(match.id);
    const perGame = new Map(), deniedPlayers = new Set();
    const groups = Array.isArray(data?.boxscore?.players) ? data.boxscore.players : [];
    for (const group of groups) {
      // A name or the other team's roster does not establish team identity.
      if (String(group?.team?.id || '') !== teamId) continue;
      for (const category of Array.isArray(group.statistics) ? group.statistics : []) {
        const labels = Array.isArray(category?.labels) ? category.labels.map(label => String(label).trim().toUpperCase()) : [];
        for (const athlete of Array.isArray(category?.athletes) ? category.athletes : []) {
          if (!athlete) continue;
          const id = String(athlete.athlete?.id || ''), name = athlete.athlete?.displayName;
          if (!/^\d{1,14}$/.test(id)) continue;
          if (athlete.athlete?.team?.id != null && String(athlete.athlete.team.id) !== teamId) continue;
          if (athlete.didNotPlay) { deniedPlayers.add(id); continue; }
          if (!Array.isArray(athlete.stats) || typeof name !== 'string' || !name.trim()) continue;
          if (!perGame.has(id)) perGame.set(id, { id, name, team: group.team?.displayName || (match.homeId === teamId ? match.home : match.away), values: new Map(), rejected: new Set(), minutes: null, minutesRejected: false, zeroMinutes: false });
          const player = perGame.get(id);
          const minuteIndex = labels.findIndex(label => ['MIN', 'MINUTES', 'TOI'].includes(label));
          if (minuteIndex >= 0) {
            const minutes = parseMinutes(athlete.stats[minuteIndex]);
            if (minutes === 0) player.zeroMinutes = true;
            if (minutes !== null && !player.minutesRejected) {
              if (player.minutes !== null && player.minutes !== minutes) { player.minutes = null; player.minutesRejected = true; conflicts++; }
              else player.minutes = minutes;
            }
          }
          for (const metric of definition.metrics) {
            if (player.rejected.has(metric.key)) continue;
            const values = labels.flatMap((label, index) => {
              const value = metric.aliases.includes(label) ? numeric(athlete.stats[index]) : null;
              return value !== null && Number.isInteger(value) ? [value] : [];
            });
            if (!values.length) continue;
            if (new Set(values).size > 1) { player.values.delete(metric.key); player.rejected.add(metric.key); conflicts++; continue; }
            const value = values[0];
            if (player.values.has(metric.key) && player.values.get(metric.key) !== value) {
              // Conflicting groups cannot silently replace an earlier value.
              player.values.delete(metric.key); player.rejected.add(metric.key); conflicts++;
            } else player.values.set(metric.key, value);
          }
        }
      }
    }
    const available = [...perGame.values()].filter(player => player.values.size > 0 && !player.zeroMinutes && !deniedPlayers.has(player.id));
    if (available.length) sampledMatches.push({ id: match.id, date: match.startTime, url, playerCount: available.length });
    for (const player of available) {
      if (!totals.has(player.id)) totals.set(player.id, { id: player.id, name: player.name, team: player.team, games: 0, observations: new Map(), minutes: [] });
      const total = totals.get(player.id); total.games++;
      for (const [key, value] of player.values) {
        const previous = total.observations.get(key) || [];
        previous.push({ matchId: match.id, date: match.startTime, value });
        total.observations.set(key, previous);
      }
      if (player.minutes !== null && !player.minutesRejected) total.minutes.push({ matchId: match.id, date: match.startTime, value: player.minutes });
    }
  }
  sampledMatches.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const players = [...totals.values()].map(player => ({
    id: player.id, name: player.name, team: player.team, games: player.games,
    minutes: player.minutes.length ? summarizeObservations(player.minutes, 'Minuty') : null,
    metrics: Object.fromEntries(definition.metrics.flatMap(metric => {
      const observations = player.observations.get(metric.key);
      return observations ? [[metric.key, summarizeObservations(observations, metric.label)]] : [];
    })),
  })).sort((a, b) => (b.metrics[definition.primary]?.average ?? -Infinity) - (a.metrics[definition.primary]?.average ?? -Infinity)
    || (b.metrics[definition.primary]?.sample ?? 0) - (a.metrics[definition.primary]?.sample ?? 0)
    || a.name.localeCompare(b.name, 'pl')).slice(0, limit);
  return { players, sampledMatches, primaryMetric: definition.primary, conflicts };
}

export async function buildPlayerForm(events, query, { fetchSummary = defaultSummaryLoader, now = () => new Date().toISOString() } = {}) {
  const { sport, route, teamId, cutoff, count = 10 } = query;
  const base = { sport, route, teamId, cutoff, requestedMatches: count, source: 'ESPN — zakończone mecze', fetchedAt: now(),
    note: 'Średnie i mediany dotyczą wyłącznie dostępnych występów w ostatnich zapisanych meczach. Dane są opisowe; nie potwierdzają przyszłego składu ani udziału zawodnika. Boxscore pobrano obecnie i nie odtwarza on archiwalnego stanu informacji przed dawnym meczem. Brak występu lub statystyki nie jest zerem.' };
  if (!DEFINITIONS[sport]) return { ...base, status: 'unavailable', reason: sport === 'tennis' ? 'Formę tenisistów pokazuje analiza ich wcześniejszych spotkań.' : 'Brak porównywalnego źródła statystyk zawodników.', availableHistoryMatches: 0, successfulMatches: 0, sampledMatches: [], attemptedMatches: [], players: [], primaryMetric: null, errors: [] };
  const matches = selectPreviousMatches(events, { ...query, count });
  const results = new Array(matches.length);
  let next = 0;
  async function worker() {
    while (next < matches.length) {
      const index = next++, match = matches[index];
      const url = `https://site.api.espn.com/apis/site/v2/sports/${route}/summary?event=${encodeURIComponent(match.sourceEventId)}`;
      try {
        const data = await fetchSummary(url);
        const hasTeam = Array.isArray(data?.boxscore?.players) && data.boxscore.players.some(group => String(group?.team?.id || '') === teamId);
        results[index] = !summaryMatches(data, match) ? { match, url, error: 'Dane źródłowe nie potwierdzają właściwego zakończonego meczu.' }
          : hasTeam ? { match, url, data } : { match, url, error: 'Źródło nie zwróciło statystyk zawodników tej drużyny.' };
      } catch { results[index] = { match, url, error: 'Nie udało się pobrać statystyk zawodników z ESPN.' }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, matches.length) }, worker));
  const aggregate = aggregatePlayerForm(results.filter(result => !result.error), query);
  const errors = results.filter(result => result.error).map(result => `${result.match.startTime.slice(0, 10)}: ${result.error}`);
  if (aggregate.conflicts) errors.push(`Pominięto sprzeczne wartości statystyk: ${aggregate.conflicts}.`);
  const status = aggregate.players.length ? aggregate.sampledMatches.length === count && !errors.length ? 'available' : 'partial' : 'unavailable';
  return { ...base, ...aggregate, fetchedAt: now(), availableHistoryMatches: matches.length, successfulMatches: aggregate.sampledMatches.length,
    attemptedMatches: results.map(result => ({ id: result.match.id, date: result.match.startTime, url: result.url, status: aggregate.sampledMatches.some(match => match.id === result.match.id) ? 'available' : 'unavailable' })),
    errors, status, reason: !matches.length ? 'Brak wcześniejszych meczów tej drużyny w zapisanej historii.' : !aggregate.players.length ? 'W poprzednich meczach źródło nie udostępniło porównywalnych statystyk zawodników.' : status === 'partial' ? 'Część ostatnich występów lub statystyk jest niedostępna w źródle.' : null };
}
