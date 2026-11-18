import { leagueLabel } from '../data/catalog.js';
import { summarizeParticipant } from './analysis.js';

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

function participantForm(events, participantId, route, cutoff) {
  const summary = summarizeParticipant(events, { participantId, route, cutoff });
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
      return { ...row, sourceEventId: event.sourceEventId, route: event.route, isHome: event.homeId === participantId };
    }),
  };
}

/** Descriptive pre-match analysis only. No odds, ratings, current records or
 * probabilities become features, and no result crosses the supplied cutoff.
 */
export function buildMatchAnalysis(events, { sport, route, homeId, awayId, cutoff, fixtureId = null }) {
  if (!Array.isArray(events) || !Number.isFinite(Date.parse(cutoff))) throw new Error('Nieprawidłowe dane analizy meczu');
  if (homeId === awayId) throw new Error('Mecz wymaga dwóch różnych uczestników');
  const before = Date.parse(cutoff);
  const seen = new Set();
  const history = events.filter(event => event.sport === sport && event.route === route && event.id !== fixtureId
    && Date.parse(event.resultAvailableAt) < before && Date.parse(event.startTime) < before);
  for (const event of history) {
    if (seen.has(event.id)) throw new Error('Powielony mecz w analizie');
    seen.add(event.id);
  }
  history.sort((a, b) => b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id));
  const home = participantForm(history, homeId, route, cutoff);
  const away = participantForm(history, awayId, route, cutoff);
  const direct = history.filter(event => (event.homeId === homeId && event.awayId === awayId) || (event.homeId === awayId && event.awayId === homeId)).slice(0, 5);
  const headToHead = {
    sample: direct.length,
    homeWins: 0, draws: 0, awayWins: 0,
    recent: direct.map(event => {
      const currentHomeScore = event.homeId === homeId ? event.homeScore : event.awayScore;
      const currentAwayScore = event.homeId === awayId ? event.homeScore : event.awayScore;
      const outcome = asOutcome(currentHomeScore, currentAwayScore);
      return { id: event.id, sourceEventId: event.sourceEventId, date: event.startTime, home: event.home, away: event.away,
        homeScore: event.homeScore, awayScore: event.awayScore, currentHomeScore, currentAwayScore, outcome };
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
    'Próba może być niepełna; porównanie nie uwzględnia siły rywali i nie jest pełnym bilansem sezonu.',
    'Podział gospodarze/goście odzwierciedla oznaczenia źródła, a czas od ostatniego meczu liczymy od jego rozpoczęcia.',
  ];
  if (home.sample !== away.sample) notes.push('Próby uczestników mają różną liczebność, dlatego nie porównujemy bezpośrednio liczby zwycięstw.');
  if (history.some(event => event.availabilityBasis === 'conservative-24h')) notes.push('Dostępność wyników historycznych ma bufor 24 godzin; źródło może zawierać późniejsze korekty.');
  return {
    status: home.sample && away.sample ? 'available' : home.sample || away.sample ? 'partial' : 'unavailable',
    sport, route, league: leagueLabel(route), cutoff, fixtureId,
    home, away, headToHead, comparison, narrative, notes,
    historyRange: { availableMatches: history.length, firstMatchAt: history.at(-1)?.startTime || null, lastMatchAt: history[0]?.startTime || null },
  };
}
