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

/** Retrospective, descriptive form only. A missing match/statistic is never 0. */
export function selectPreviousMatches(events, { sport, route, teamId, cutoff, count = 2 }) {
  const before = Date.parse(cutoff);
  if (!Number.isFinite(before) || ![1, 2].includes(count)) throw new Error('Nieprawidłowy zakres formy zawodników');
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
export function aggregatePlayerForm(records, { sport, teamId, limit = 5 }) {
  const definition = DEFINITIONS[sport];
  if (!definition) return { players: [], sampledMatches: [], primaryMetric: null, conflicts: 0 };
  const totals = new Map(), sampledMatches = [], seenMatches = new Set();
  let conflicts = 0;
  for (const { match, data, url } of records) {
    if (seenMatches.has(match.id)) continue;
    seenMatches.add(match.id);
    const perGame = new Map();
    const groups = Array.isArray(data?.boxscore?.players) ? data.boxscore.players : [];
    for (const group of groups) {
      // A name or the other team's roster does not establish team identity.
      if (String(group?.team?.id || '') !== teamId) continue;
      for (const category of Array.isArray(group.statistics) ? group.statistics : []) {
        const labels = Array.isArray(category?.labels) ? category.labels.map(label => String(label).trim().toUpperCase()) : [];
        for (const athlete of Array.isArray(category?.athletes) ? category.athletes : []) {
          if (!athlete || athlete.didNotPlay || !Array.isArray(athlete.stats)) continue;
          const id = String(athlete.athlete?.id || ''), name = athlete.athlete?.displayName;
          if (!/^\d{1,14}$/.test(id) || typeof name !== 'string' || !name.trim()) continue;
          if (!perGame.has(id)) perGame.set(id, { id, name, team: group.team?.displayName || (match.homeId === teamId ? match.home : match.away), values: new Map(), rejected: new Set() });
          const player = perGame.get(id);
          for (const metric of definition.metrics) {
            const index = labels.findIndex(label => metric.aliases.includes(label));
            if (index < 0 || player.rejected.has(metric.key)) continue;
            const value = numeric(athlete.stats[index]);
            if (value === null) continue;
            if (player.values.has(metric.key) && player.values.get(metric.key) !== value) {
              // Conflicting groups cannot silently replace an earlier value.
              player.values.delete(metric.key); player.rejected.add(metric.key); conflicts++;
            } else player.values.set(metric.key, value);
          }
        }
      }
    }
    const available = [...perGame.values()].filter(player => player.values.size > 0);
    if (available.length) sampledMatches.push({ id: match.id, date: match.startTime, url, playerCount: available.length });
    for (const player of available) {
      if (!totals.has(player.id)) totals.set(player.id, { id: player.id, name: player.name, team: player.team, games: 0, sums: new Map() });
      const total = totals.get(player.id); total.games++;
      for (const [key, value] of player.values) {
        const previous = total.sums.get(key) || { sum: 0, sample: 0 };
        total.sums.set(key, { sum: previous.sum + value, sample: previous.sample + 1 });
      }
    }
  }
  const players = [...totals.values()].map(player => ({
    id: player.id, name: player.name, team: player.team, games: player.games,
    metrics: Object.fromEntries(definition.metrics.flatMap(metric => {
      const aggregate = player.sums.get(metric.key);
      return aggregate ? [[metric.key, { label: metric.label, average: aggregate.sum / aggregate.sample, sample: aggregate.sample }]] : [];
    })),
  })).sort((a, b) => (b.metrics[definition.primary]?.average ?? -Infinity) - (a.metrics[definition.primary]?.average ?? -Infinity)
    || (b.metrics[definition.primary]?.sample ?? 0) - (a.metrics[definition.primary]?.sample ?? 0)
    || a.name.localeCompare(b.name, 'pl')).slice(0, limit);
  return { players, sampledMatches, primaryMetric: definition.primary, conflicts };
}

export async function buildPlayerForm(events, query, { fetchSummary = url => fetchJSON(url, { timeoutMs: 4000, retries: 0 }), now = () => new Date().toISOString() } = {}) {
  const { sport, route, teamId, cutoff, count = 2 } = query;
  const base = { sport, route, teamId, cutoff, requestedMatches: count, source: 'ESPN — zakończone mecze', fetchedAt: now(),
    note: 'Średnie dotyczą wyłącznie dostępnych statystyk z ostatnich zapisanych meczów. Dane są opisowe; nie potwierdzają przyszłego składu ani udziału zawodnika. Boxscore pobrano obecnie i nie odtwarza on archiwalnego stanu informacji przed dawnym meczem.' };
  if (!DEFINITIONS[sport]) return { ...base, status: 'unavailable', reason: sport === 'tennis' ? 'Formę tenisistów pokazuje analiza ich wcześniejszych spotkań.' : 'Brak porównywalnego źródła statystyk zawodników.', availableHistoryMatches: 0, successfulMatches: 0, sampledMatches: [], attemptedMatches: [], players: [], primaryMetric: null, errors: [] };
  const matches = selectPreviousMatches(events, query);
  const results = await Promise.all(matches.map(async match => {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${route}/summary?event=${encodeURIComponent(match.sourceEventId)}`;
    try {
      const data = await fetchSummary(url);
      const hasTeam = Array.isArray(data?.boxscore?.players) && data.boxscore.players.some(group => String(group?.team?.id || '') === teamId);
      return hasTeam ? { match, url, data } : { match, url, error: 'Źródło nie zwróciło statystyk zawodników tej drużyny.' };
    } catch { return { match, url, error: 'Nie udało się pobrać statystyk zawodników z ESPN.' }; }
  }));
  const aggregate = aggregatePlayerForm(results.filter(result => !result.error), query);
  const errors = results.filter(result => result.error).map(result => `${result.match.startTime.slice(0, 10)}: ${result.error}`);
  if (aggregate.conflicts) errors.push(`Pominięto sprzeczne wartości statystyk: ${aggregate.conflicts}.`);
  const status = aggregate.players.length ? aggregate.sampledMatches.length === count && !errors.length ? 'available' : 'partial' : 'unavailable';
  return { ...base, ...aggregate, fetchedAt: now(), availableHistoryMatches: matches.length, successfulMatches: aggregate.sampledMatches.length,
    attemptedMatches: results.map(result => ({ id: result.match.id, date: result.match.startTime, url: result.url, status: aggregate.sampledMatches.some(match => match.id === result.match.id) ? 'available' : 'unavailable' })),
    errors, status, reason: !matches.length ? 'Brak wcześniejszych meczów tej drużyny w zapisanej historii.' : !aggregate.players.length ? 'W poprzednich meczach źródło nie udostępniło porównywalnych statystyk zawodników.' : status === 'partial' ? 'Analiza opiera się na niepełnej próbie dostępnych statystyk.' : null };
}
