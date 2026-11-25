import { isAllowedRoute, leagueLabel } from './catalog.js';
import { summarizeParticipant, isResultAvailableAt } from './analysis.js';
import { buildMatchContext } from './match-context.js';
import { loadRecentPlayerMatches } from './recent-player-matches.js';

const DAY = 86400000;
const fixed = value => Number(value.toFixed(2));
const decimal = value => value.toFixed(1).replace('.', ',');
const asOutcome = (scoreFor, scoreAgainst) => scoreFor > scoreAgainst ? 'W' : scoreFor === scoreAgainst ? 'D' : 'L';
const counted = (count, one, few, many) => `${count} ${count === 1 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many}`;

function splitSummary(rows, id, side) {
  const selected = rows.filter(row => side === 'home' ? row.homeId === id : row.awayId === id);
  const values = selected.map(row => {
    const home = row.homeId === id;
    return { scoreFor: home ? row.homeScore : row.awayScore, scoreAgainst: home ? row.awayScore : row.homeScore };
  });
  const outcomes = values.map(row => asOutcome(row.scoreFor, row.scoreAgainst));
  return {
    sample: selected.length,
    wins: outcomes.filter(outcome => outcome === 'W').length,
    draws: outcomes.filter(outcome => outcome === 'D').length,
    losses: outcomes.filter(outcome => outcome === 'L').length,
    averageFor: selected.length ? fixed(values.reduce((sum, row) => sum + row.scoreFor, 0) / selected.length) : null,
    averageAgainst: selected.length ? fixed(values.reduce((sum, row) => sum + row.scoreAgainst, 0) / selected.length) : null,
  };
}

function participantForm(events, participantId, route, cutoff, availabilityInclusive) {
  const summary = summarizeParticipant(events, { participantId, route, cutoff, availabilityInclusive });
  const ids = new Set(summary.recent.map(row => row.id));
  const rows = events.filter(event => ids.has(event.id)).sort((a, b) => b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id));
  const latest = rows[0];
  const name = latest ? latest.homeId === participantId ? latest.home : latest.away : null;
  let streakCount = 0;
  const streakOutcome = summary.recent[0]?.outcome || null;
  for (const row of summary.recent) {
    if (row.outcome !== streakOutcome) break;
    streakCount++;
  }
  return {
    ...summary,
    id: participantId,
    name,
    averageFor: summary.averageFor === null ? null : fixed(summary.averageFor),
    averageAgainst: summary.averageAgainst === null ? null : fixed(summary.averageAgainst),
    averageMargin: summary.sample ? fixed(summary.averageFor - summary.averageAgainst) : null,
    streak: { outcome: streakOutcome, count: streakCount },
    splits: { home: splitSummary(rows, participantId, 'home'), away: splitSummary(rows, participantId, 'away') },
    lastMatchAt: latest?.startTime || null,
    restDays: latest ? Math.floor((Date.parse(cutoff) - Date.parse(latest.startTime)) / DAY) : null,
    recent: summary.recent.map(row => {
      const event = rows.find(event => event.id === row.id);
      return { ...row, sourceEventId: event.sourceEventId, route: event.route, isHome: event.homeId === participantId,
        ...(event.scoreScope ? { scoreScope: event.scoreScope, regulationOnly: event.regulationOnly === true } : {}) };
    }),
  };
}

/** Descriptive pre-match analysis only. No odds, ratings, current records or
 * probabilities become features, and no result crosses the supplied cutoff.
 */
export function buildMatchAnalysis(events, { sport, route, homeId, awayId, cutoff, fixtureId = null, availabilityInclusive = false }) {
  if (!Array.isArray(events) || !Number.isFinite(Date.parse(cutoff))) throw new Error('Nieprawidłowe dane analizy meczu');
  if (homeId === awayId) throw new Error('Mecz wymaga dwóch różnych uczestników');
  const before = Date.parse(cutoff);
  const seen = new Set();
  const history = events.filter(event => event.sport === sport && event.route === route && event.id !== fixtureId
    && isResultAvailableAt(event, before, availabilityInclusive) && Date.parse(event.startTime) < before);
  for (const event of history) {
    if (seen.has(event.id)) throw new Error('Powielony mecz w analizie');
    seen.add(event.id);
  }
  history.sort((a, b) => b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id));
  const home = participantForm(history, homeId, route, cutoff, availabilityInclusive);
  const away = participantForm(history, awayId, route, cutoff, availabilityInclusive);
  const direct = history.filter(event => (event.homeId === homeId && event.awayId === awayId) || (event.homeId === awayId && event.awayId === homeId)).slice(0, 5);
  const headToHead = {
    sample: direct.length,
    homeWins: 0, draws: 0, awayWins: 0,
    recent: direct.map(event => {
      const currentHomeScore = event.homeId === homeId ? event.homeScore : event.awayScore;
      const currentAwayScore = event.homeId === awayId ? event.homeScore : event.awayScore;
      const outcome = asOutcome(currentHomeScore, currentAwayScore);
      return { id: event.id, sourceEventId: event.sourceEventId, date: event.startTime, home: event.home, away: event.away,
        homeScore: event.homeScore, awayScore: event.awayScore, currentHomeScore, currentAwayScore, outcome,
        ...(event.scoreScope ? { scoreScope: event.scoreScope, regulationOnly: event.regulationOnly === true } : {}) };
    }),
  };
  for (const row of headToHead.recent) {
    if (row.outcome === 'W') headToHead.homeWins++;
    else if (row.outcome === 'D') headToHead.draws++;
    else headToHead.awayWins++;
  }
  const comparableCounts = home.sample > 0 && home.sample === away.sample;
  const comparison = {
    sampleComplete: home.sample === 10 && away.sample === 10,
    formWinsDifference: comparableCounts ? home.wins - away.wins : null,
    averageMarginDifference: home.sample && away.sample ? fixed(home.averageMargin - away.averageMargin) : null,
  };
  const homeLabel = home.name || (sport === 'tennis' ? 'Pierwszy zawodnik' : 'Gospodarze');
  const awayLabel = away.name || (sport === 'tennis' ? 'Drugi zawodnik' : 'Goście');
  const unit = sport === 'nba' ? 'pkt' : sport === 'tennis' ? 'seta' : 'gola';
  const narrative = [home, away].map((form, index) => {
    const label = index === 0 ? homeLabel : awayLabel;
    if (!form.sample) return `${label}: brak wcześniejszych spotkań w zapisanej historii tej ligi.`;
    const sample = form.sample === 1 ? 'w ostatnim dostępnym meczu' : `w ostatnich ${form.sample} dostępnych meczach`;
    return `${label}: ${counted(form.wins, 'zwycięstwo', 'zwycięstwa', 'zwycięstw')}${sport === 'football' ? `, ${counted(form.draws, 'remis', 'remisy', 'remisów')}` : ''} i ${counted(form.losses, 'porażka', 'porażki', 'porażek')} ${sample}. Średnia zdobyczy: ${decimal(form.averageFor)} ${unit}; średnia strat: ${decimal(form.averageAgainst)} ${unit} na mecz.`;
  });
  if (comparableCounts) {
    const difference = comparison.formWinsDifference;
    narrative.push(difference === 0
      ? `W próbach o tej samej liczebności (${home.sample}) obie strony mają po ${counted(home.wins, 'zwycięstwo', 'zwycięstwa', 'zwycięstw')}.`
      : `W próbach o tej samej liczebności (${home.sample}) ${difference > 0 ? homeLabel : awayLabel} ma o ${counted(Math.abs(difference), 'zwycięstwo', 'zwycięstwa', 'zwycięstw')} więcej.`);
  }
  if (headToHead.sample) narrative.push(`Bezpośrednie spotkania (próba: ${headToHead.sample}): zwycięstwa ${homeLabel} — ${headToHead.homeWins}, remisy — ${headToHead.draws}, zwycięstwa ${awayLabel} — ${headToHead.awayWins}.`);
  const notes = [
    'To analiza opisowa zapisanych wyników, bez przewidywania zwycięzcy i bez prawdopodobieństw.',
    'Próba może być niepełna i nie jest pełnym bilansem sezonu. Dodatkowy kontekst pokazuje wcześniejsze bilanse rywali; nie jest korektą prognozy.',
    'Podział gospodarze/goście odzwierciedla oznaczenia źródła, a czas od ostatniego meczu liczymy od jego rozpoczęcia.',
  ];
  if (home.sample !== away.sample) notes.push('Próby uczestników mają różną liczebność, dlatego nie porównujemy bezpośrednio liczby zwycięstw.');
  if (history.some(event => event.availabilityBasis === 'conservative-24h')) notes.push('Dostępność wyników historycznych ma bufor 24 godzin; źródło może zawierać późniejsze korekty.');
  return {
    status: home.sample && away.sample ? 'available' : home.sample || away.sample ? 'partial' : 'unavailable',
    sport, route, league: leagueLabel(route), cutoff, fixtureId,
    home, away, headToHead, comparison, narrative, notes,
    context: buildMatchContext(history, { sport, route, homeId, awayId, cutoff, fixtureId }),
    historyRange: { availableMatches: history.length, firstMatchAt: history.at(-1)?.startTime || null, lastMatchAt: history[0]?.startTime || null },
  };
}

const currentId = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const currentISO = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Confirmed regulation facts read now, separate from the frozen historical
 * availability protocol. No observation timestamp is moved into the past.
 */
export async function buildCurrentFootballAnalysis(query, { load = loadRecentPlayerMatches, clock = Date.now } = {}) {
  const initial = clock(), start = Date.parse(query.fixtureStart);
  if (query.sport !== 'football' || !isAllowedRoute('football', query.route) || query.route === 'soccer/pol.1'
    || !currentId(query.homeId) || !currentId(query.awayId) || query.homeId === query.awayId
    || typeof query.fixtureId !== 'string' || !query.fixtureId.startsWith(`${query.route}:`) || !/^\d{4,14}$/.test(query.fixtureId.slice(query.route.length + 1))
    || !currentISO(query.fixtureStart) || !Number.isFinite(initial) || start <= initial
    || query.cutoff != null && (!currentISO(query.cutoff) || Date.parse(query.cutoff) > initial)) throw new Error('Nieprawidłowy zakres bieżącej analizy piłkarskiej');
  const cutoffAt = value => new Date(Math.min(value, start)).toISOString();
  const sources = [];
  const unavailable = (reason, cutoff) => {
    const analysis = buildMatchAnalysis([], { ...query, cutoff });
    analysis.notes.unshift(reason);
    return { ...analysis, available: false, historyAvailable: false, currentDescriptive: true,
      resultScope: 'unavailable', modelExperimentEligible: false, observedAt: null,
      source: 'ESPN — potwierdzone wyniki 90 minut', coverage: { complete: false, status: 'unavailable', sources, reason } };
  };
  let current;
  try {
    current = await Promise.all([query.homeId, query.awayId].map(async teamId => ({ teamId, requestedSeason: null,
      data: await load([], { sport: 'football', route: query.route, teamId }) })));
  } catch { return unavailable('Nie udało się potwierdzić bieżących wyników 90 minut obu drużyn.', cutoffAt(clock())); }
  for (const item of current) sources.push({ teamId: item.teamId, requestedSeason: null, ...item.data?.coverage });
  if (current.some(item => item.data?.coverage?.status !== 'refreshed' || !Array.isArray(item.data.events))) return unavailable('Bieżący terminarz nie potwierdza wyników 90 minut obu drużyn. Nie podstawiono wyników o nieznanym zakresie.', cutoffAt(clock()));
  const previous = await Promise.all(current.filter(item => item.data.events.length < 10
    && Number.isInteger(item.data.coverage.season) && item.data.coverage.season > 2000).map(async item => {
    const requestedSeason = item.data.coverage.season - 1;
    try { return { teamId: item.teamId, requestedSeason, data: await load([], { sport: 'football', route: query.route, teamId: item.teamId, season: requestedSeason }) }; }
    catch { return { teamId: item.teamId, requestedSeason, data: { events: [], coverage: { status: 'fallback', reason: 'Nie udało się potwierdzić poprzedniego sezonu.' } } }; }
  }));
  for (const item of previous) sources.push({ teamId: item.teamId, requestedSeason: item.requestedSeason, ...item.data.coverage });
  const timestamp = clock();
  if (!Number.isFinite(timestamp) || timestamp < initial) return unavailable('Nie można potwierdzić czasu bieżącej obserwacji.', cutoffAt(initial));
  const cutoff = cutoffAt(timestamp), before = Date.parse(cutoff);
  if (timestamp >= start) return unavailable('Spotkanie rozpoczęło się podczas odczytu. Nie utworzono bieżącego wskazania przedmeczowego.', cutoff);
  const events = new Map();
  try {
    for (const { teamId, requestedSeason, data } of [...current, ...previous]) {
      if (data.coverage.status !== 'refreshed') continue;
      const observed = data.coverage.fetchedAt;
      if (!currentISO(observed) || Date.parse(observed) > before || !Array.isArray(data.events)) throw new Error('Nieprawidłowa obserwacja');
      const expectedURL = `https://site.api.espn.com/apis/site/v2/sports/${query.route}/teams/${teamId}/schedule${requestedSeason == null ? '' : `?season=${requestedSeason}`}`;
      for (const row of data.events) {
        if (row.sport !== 'football' || row.route !== query.route || row.status !== 'completed' || row.regulationOnly !== true || row.scoreScope !== 'regulation_90'
          || row.descriptiveOnly !== true || row.availabilityBasis !== 'current-descriptive-observation'
          || !currentId(row.sourceEventId) || row.id !== `${query.route}:${row.sourceEventId}`
          || !currentId(row.homeId) || !currentId(row.awayId) || row.homeId === row.awayId || ![row.homeId, row.awayId].includes(teamId)
          || ![row.home, row.away].every(name => typeof name === 'string' && name.trim() && name.length <= 200)
          || !currentISO(row.startTime) || Date.parse(row.startTime) >= before
          || row.resultAvailableAt !== observed || row.source?.fetchedAt !== observed || row.source?.provider !== 'ESPN' || row.source.url !== expectedURL
          || ![row.homeScore, row.awayScore].every(value => Number.isInteger(value) && value >= 0 && value <= 30)
          || requestedSeason != null && row.season !== requestedSeason) throw new Error('Niepotwierdzony wynik 90 minut');
        const prior = events.get(row.id);
        if (prior && ['startTime', 'homeId', 'awayId', 'homeScore', 'awayScore'].some(key => prior[key] !== row[key])) throw new Error('Sprzeczny wynik');
        if (!prior) events.set(row.id, row);
      }
    }
  } catch { return unavailable('Wyniki mają sprzeczny lub niepotwierdzony zakres. Nie utworzono analizy sumy goli.', cutoff); }
  const analysis = buildMatchAnalysis([...events.values()], { ...query, cutoff, availabilityInclusive: true });
  analysis.notes.unshift('Bieżąca analiza opisowa potwierdzonych wyników 90 minut. Czas obserwacji jest rzeczywisty; nie odtwarzamy stanu wiedzy przed dawnymi meczami. Dane obejmują tylko wybraną ligę; źródło nie potwierdza kompletności sezonów.');
  const observedAt = [...current, ...previous].filter(item => item.data.coverage.status === 'refreshed')
    .map(item => item.data.coverage.fetchedAt).filter(currentISO).sort().at(-1) || null;
  return { ...analysis, available: analysis.status !== 'unavailable', historyAvailable: events.size > 0,
    currentDescriptive: true, resultScope: 'regulation_90', modelExperimentEligible: false, observedAt, historyUpdatedAt: observedAt,
    source: 'ESPN — potwierdzone wyniki 90 minut', runtimeData: { origin: 'espn', fallback: previous.some(item => item.data.coverage.status !== 'refreshed') },
    coverage: { complete: false, status: previous.some(item => item.data.coverage.status !== 'refreshed') ? 'partial' : 'refreshed', sources,
      acceptedEvents: events.size, previousSeasonRequested: previous.length > 0 } };
}
