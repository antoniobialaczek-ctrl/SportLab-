import { leagueLabel } from '../data/catalog.js';

export function buildAnalysisCatalog(events, { sport, routes, cutoff, limit = 12 }) {
  const before = Date.parse(cutoff);
  if (!Array.isArray(events) || !Array.isArray(routes) || !Number.isFinite(before) || !Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error('Nieprawidłowy zakres archiwum analiz');
  return events.filter(event => event.sport === sport && routes.includes(event.route) && Date.parse(event.startTime) < before && Date.parse(event.resultAvailableAt) < before)
    .sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, limit).map(event => ({
      id: event.id, sourceEventId: event.sourceEventId, sport, route: event.route,
      league: leagueLabel(event.route), leagueId: event.league, date: event.startTime,
      homeId: event.homeId, awayId: event.awayId, home: event.home, away: event.away,
      homeScore: event.homeScore, awayScore: event.awayScore, state: 'post', statusDetail: 'Zakończony • archiwum',
      forecast: { status: 'withheld', reason: 'Analiza opisowa dostępnych wcześniejszych wyników.' },
    }));
}
