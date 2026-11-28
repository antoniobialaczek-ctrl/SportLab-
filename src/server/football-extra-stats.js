import { isAllowedRoute } from './catalog.js';
import { loadRecentPlayerMatches } from './recent-player-matches.js';
import { loadPlayerSummary } from './player-form.js';

const TTL = 5 * 60000, MAX_ENTRIES = 32, LIMIT = 8, BUDGET = 22000, READ_MS = 3500;
const id = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const canonicalTime = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 16) === value.slice(0, 16) ? stamp : null;
};
const definitions = {
  corners: { name: 'wonCorners', maximum: 50 },
  yellowCards: { name: 'yellowCards', maximum: 30 },
  shots: { name: 'totalShots', maximum: 100 },
  shotsOnTarget: { name: 'shotsOnTarget', maximum: 100 },
};
const numeric = value => (typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

function statValue(rows, definition) {
  const stats = rows.filter(row => row?.name === definition.name);
  if (!stats.length) return null;
  const values = stats.map(row => {
    const a = row.value == null ? null : numeric(row.value), b = row.displayValue == null ? null : numeric(row.displayValue);
    if (row.value != null && a === null || row.displayValue != null && b === null || a !== null && b !== null && a !== b) return null;
    const value = a ?? b;
    return value !== null && value <= definition.maximum ? value : null;
  });
  return values.some(value => value === null) || new Set(values).size !== 1 ? null : values[0];
}

function scheduleMatch(row, query, teamId, before, season) {
  return row?.sport === 'football' && row.route === query.route && row.status === 'completed'
    && row.regulationOnly === true && row.scoreScope === 'regulation_90' && row.descriptiveOnly === true
    && row.availabilityBasis === 'current-descriptive-observation' && id(row.sourceEventId) && /^\d{4,14}$/.test(row.sourceEventId)
    && row.id === `${query.route}:${row.sourceEventId}` && row.id !== query.fixtureId
    && [row.homeId, row.awayId].every(id) && row.homeId !== row.awayId && [row.homeId, row.awayId].includes(teamId)
    && [row.home, row.away].every(name => typeof name === 'string' && name.trim() && name.length <= 200)
    && iso(row.startTime) && Date.parse(row.startTime) < before
    && [row.homeScore, row.awayScore].every(value => Number.isInteger(value) && value >= 0 && value <= 30)
    && row.source?.provider === 'ESPN' && iso(row.source.fetchedAt) && Date.parse(row.source.fetchedAt) <= before
    && row.resultAvailableAt === row.source.fetchedAt && (season == null || row.season === season)
    && row.source.url === `https://site.api.espn.com/apis/site/v2/sports/${query.route}/teams/${teamId}/schedule${season == null ? '' : `?season=${season}`}`;
}

/** Only the confirmed 90-minute schedule establishes period scope. Some ESPN
 * summaries omit clock/period, so their identity, final type and exact scores
 * must agree with that independently verified regulation schedule. */
export function extractFootballExtraStats(data, match) {
  if (match?.regulationOnly !== true || match.scoreScope !== 'regulation_90') return null;
  const sourceId = match.sourceEventId, competitions = data?.header?.competitions;
  if (String(data?.header?.id || '') !== sourceId || !Array.isArray(competitions) || competitions.length !== 1) return null;
  const comp = competitions[0], status = comp?.status, type = status?.type;
  if (String(comp?.id || '') !== sourceId || canonicalTime(comp.date) !== Date.parse(match.startTime)
    || type?.state !== 'post' || type.completed !== true || type.name !== 'STATUS_FULL_TIME'
    || status.period != null && status.period !== 2 || status.clock != null && (!Number.isFinite(status.clock) || status.clock < 5400 || status.clock >= 7200)
    || comp.wasSuspended === true || comp.shootout === true
    || /extra\s*time|penalt|shootout|\bAET\b|abandon|walkover|cancel|suspend/i.test([type.detail, type.shortDetail, type.description, ...(Array.isArray(comp.notes) ? comp.notes : []).map(note => note.text)].filter(Boolean).join(' '))) return null;
  const participants = comp.competitors;
  if (!Array.isArray(participants) || participants.length !== 2) return null;
  for (const [side, wanted, wantedScore] of [['home', match.homeId, match.homeScore], ['away', match.awayId, match.awayScore]]) {
    const found = participants.filter(row => row?.homeAway === side);
    if (found.length !== 1 || String(found[0].id) !== wanted || String(found[0].team?.id) !== wanted
      || numeric(found[0].score) !== wantedScore || found[0].shootoutScore != null || found[0].penaltyScore != null
      || Array.isArray(found[0].linescores) && found[0].linescores.length > 2) return null;
  }
  const groups = data?.boxscore?.teams;
  if (!Array.isArray(groups) || groups.length !== 2 || new Set(groups.map(row => String(row?.team?.id))).size !== 2) return null;
  const values = {};
  for (const wanted of [match.homeId, match.awayId]) {
    const group = groups.find(row => String(row?.team?.id) === wanted);
    if (!group || !Array.isArray(group.statistics) || group.statistics.length > 100) return null;
    values[wanted] = Object.fromEntries(Object.entries(definitions).flatMap(([key, definition]) => {
      const value = statValue(group.statistics, definition);
      return value === null ? [] : [[key, value]];
    }));
    if (values[wanted].shots != null && values[wanted].shotsOnTarget > values[wanted].shots) delete values[wanted].shotsOnTarget;
  }
  return values;
}

export function createFootballExtraStatsService({ loadMatches = loadRecentPlayerMatches, fetchSummary = loadPlayerSummary, clock = Date.now } = {}) {
  const cache = new Map(), inflight = new Map();
  async function build(query, initial) {
    const deadline = initial + BUDGET, start = Date.parse(query.fixtureStart), sources = [], errors = [];
    let budgetReached = false;
    const response = (status, reason, teams = null) => {
      const stamp = clock(), observedAt = Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
      const metrics = Object.fromEntries(Object.keys(definitions).map(key => [key, { home: teams?.home.matches.filter(row => row.stats[key]).length || 0, away: teams?.away.matches.filter(row => row.stats[key]).length || 0 }]));
      return { sport: 'football', route: query.route, fixtureId: query.fixtureId, homeId: query.homeId, awayId: query.awayId,
        fixtureStart: query.fixtureStart, scope: 'regulation_90', status, reason, teams, observedAt, fetchedAt: observedAt,
        currentDescriptive: true, modelExperimentEligible: false, source: 'ESPN — statystyki zakończonych meczów',
        coverage: { complete: false, metrics, sources, budgetReached, maximumMatchesPerTeam: LIMIT, cacheSeconds: status === 'available' ? TTL / 1000 : status === 'partial' ? 30 : 0, errors },
        notes: ['Bieżący odczyt statystyk potwierdzonych wyników 90 minut, bez dogrywki i karnych. Nie odtwarza dawnego stanu wiedzy i nie jest częścią testów modeli.',
          'Żółte kartki są osobną statystyką ESPN. Nie oznaczają wszystkich kartek, punktów za kartki ani zasad rozliczenia konkretnego bukmachera.',
          'Brak statystyki nie jest zerem. Źródło nie potwierdza kompletności danych ani oferty kursów na te rynki.'] };
    };
    if (query.route === 'soccer/pol.1') return response('unavailable', 'Darmowe źródło Ekstraklasy nie udostępnia potwierdzonych statystyk rożnych i kartek.');
    const current = await Promise.all([query.homeId, query.awayId].map(async teamId => {
      try { return { teamId, data: await loadMatches([], { sport: 'football', route: query.route, teamId }), season: null }; }
      catch { return { teamId, data: null, season: null }; }
    }));
    if (current.some(row => row.data?.coverage?.status !== 'refreshed' || !Array.isArray(row.data.events))) return response('unavailable', 'Nie udało się potwierdzić zakończonych wyników 90 minut obu drużyn.');
    const reads = [...current];
    if (clock() + 4000 < deadline) {
      const prior = await Promise.all(current.filter(row => row.data.events.length < LIMIT && Number.isInteger(row.data.coverage.season) && row.data.coverage.season > 2000).map(async row => {
        const season = row.data.coverage.season - 1;
        try { return { teamId: row.teamId, season, data: await loadMatches([], { sport: 'football', route: query.route, teamId: row.teamId, season }) }; }
        catch { return { teamId: row.teamId, season, data: null }; }
      }));
      reads.push(...prior);
    }
    const selected = {};
    for (const teamId of [query.homeId, query.awayId]) {
      const rows = new Map();
      for (const read of reads.filter(row => row.teamId === teamId)) {
        sources.push({ teamId, requestedSeason: read.season, ...read.data?.coverage });
        if (read.data?.coverage?.status !== 'refreshed') continue;
        for (const row of read.data.events) {
          if (!scheduleMatch(row, query, teamId, clock(), read.season)) continue;
          const previous = rows.get(row.id);
          if (previous && ['startTime', 'homeId', 'awayId', 'homeScore', 'awayScore'].some(key => previous[key] !== row[key])) return response('unavailable', 'Sprzeczne rekordy zakończonego spotkania.');
          rows.set(row.id, row);
        }
      }
      selected[teamId] = [...rows.values()].sort((a, b) => b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id)).slice(0, LIMIT);
    }
    const unique = new Map();
    for (const row of [...selected[query.homeId], ...selected[query.awayId]]) {
      const prior = unique.get(row.id);
      if (prior && ['startTime', 'homeId', 'awayId', 'homeScore', 'awayScore'].some(key => prior[key] !== row[key])) return response('unavailable', 'Wspólne spotkanie ma sprzeczny wynik.');
      unique.set(row.id, row);
    }
    const pending = [...unique.values()], records = new Map();
    let next = 0;
    async function worker() {
      while (next < pending.length) {
        if (clock() + READ_MS > deadline || clock() >= start) { budgetReached = true; break; }
        const match = pending[next], url = `https://site.api.espn.com/apis/site/v2/sports/${query.route}/summary?event=${match.sourceEventId}`;
        if (fetchSummary.ready && !fetchSummary.ready(url)) {
          if (!fetchSummary.waitForSlot) { budgetReached = true; break; }
          await fetchSummary.waitForSlot(); continue;
        }
        next++;
        try {
          const payload = await fetchSummary(url), observedAt = payload?.observedAt;
          if (!iso(observedAt) || Date.parse(observedAt) > clock() || Date.parse(observedAt) <= Date.parse(match.startTime) || Date.parse(observedAt) >= start) throw new Error('Niepotwierdzony czas źródła');
          const stats = extractFootballExtraStats(payload.data, match);
          if (!stats) throw new Error('Niepotwierdzony boxscore');
          records.set(match.id, { stats, observedAt, url });
        } catch { errors.push({ matchId: match.id, reason: 'Statystyki meczu są niedostępne lub nie przeszły weryfikacji.' }); }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    if (clock() >= start || clock() < initial) return response('unavailable', 'Mecz rozpoczął się podczas pobierania lub nie można potwierdzić czasu obserwacji.');
    const teams = Object.fromEntries([['home', query.homeId], ['away', query.awayId]].map(([side, teamId]) => {
      const matches = selected[teamId].flatMap(match => {
        const record = records.get(match.id); if (!record) return [];
        const opponentId = match.homeId === teamId ? match.awayId : match.homeId;
        const stats = Object.fromEntries(Object.keys(definitions).flatMap(key => record.stats[teamId][key] != null && record.stats[opponentId][key] != null
          ? [[key, { own: record.stats[teamId][key], opponent: record.stats[opponentId][key] }]] : []));
        if (!Object.keys(stats).length) return [];
        return [{ matchId: match.id, date: match.startTime, route: query.route, scope: 'regulation_90', isHome: match.homeId === teamId,
          opponent: match.homeId === teamId ? match.away : match.home, sourceFetchedAt: record.observedAt, sourceURL: record.url, stats }];
      });
      return [side, { id: teamId, name: selected[teamId][0] ? selected[teamId][0].homeId === teamId ? selected[teamId][0].home : selected[teamId][0].away : teamId, sample: matches.length, matches }];
    }));
    const complete = [teams.home, teams.away].every(team => team.matches.length === LIMIT && Object.keys(definitions).every(key => team.matches.every(row => row.stats[key])));
    return response(complete ? 'available' : teams.home.sample || teams.away.sample ? 'partial' : 'unavailable', complete ? null : budgetReached ? 'Osiągnięto ograniczony czas odczytu. Pokazano wyłącznie potwierdzone statystyki.' : 'Dostępna jest częściowa historia statystyk tej ligi.', teams);
  }
  return function get(query) {
    const now = clock(), start = Date.parse(query?.fixtureStart), pol = query?.route === 'soccer/pol.1';
    const participant = pol ? /^tsdb-\d{1,14}$/ : /^\d{1,14}$/, fixture = pol ? /^tsdb-\d{4,14}$/ : /^\d{4,14}$/;
    if (query?.sport !== 'football' || !isAllowedRoute('football', query.route) || ![query.homeId, query.awayId].every(value => typeof value === 'string' && participant.test(value))
      || query.homeId === query.awayId || typeof query.fixtureId !== 'string' || !query.fixtureId.startsWith(`${query.route}:`) || !fixture.test(query.fixtureId.slice(query.route.length + 1))
      || !iso(query.fixtureStart) || !Number.isFinite(now) || start <= now || start - now > 2 * 86400000) throw new Error('Nieprawidłowy zakres statystyk piłkarskich');
    const key = `${query.fixtureId}:${query.homeId}:${query.awayId}:${query.fixtureStart}`, hit = cache.get(key);
    if (hit && now >= hit.at && now - hit.at < (hit.data.status === 'available' ? TTL : 30000)) return Promise.resolve(hit.data);
    cache.delete(key);
    if (inflight.has(key)) return inflight.get(key);
    const promise = build(query, now).then(data => {
      if (['available', 'partial'].includes(data.status)) {
        cache.set(key, { at: clock(), data }); while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
      }
      return data;
    }).finally(() => inflight.delete(key));
    inflight.set(key, promise); return promise;
  };
}
const service = createFootballExtraStatsService();
export function getFootballExtraStats(query) { return service(query); }
