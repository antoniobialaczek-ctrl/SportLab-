export const ROUTES = Object.freeze({
  nba: ['basketball/nba'],
  nhl: ['hockey/nhl'],
  football: ['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/pol.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1'],
  tennis: ['tennis/atp', 'tennis/wta'],
  cs2: [],
});
export const SPORTS = Object.freeze(Object.keys(ROUTES));
// A route visible in the preserved UI is not proof of provider coverage.
// Verified on several historical dates: this ESPN route returns HTTP 400.
export const ESPN_UNAVAILABLE_HISTORY_ROUTES = Object.freeze({
  'soccer/pol.1': {
    provider: 'ESPN', status: 'unavailable', checkedAt: '2026-11-18',
    reason: 'ESPN nie udostępnia historii Ekstraklasy pod trasą soccer/pol.1 (HTTP 400).',
  },
});
export const DEFAULT_HISTORY_ROUTES = Object.freeze({
  nba: ROUTES.nba,
  nhl: ROUTES.nhl,
  football: ROUTES.football.filter(route => !Object.hasOwn(ESPN_UNAVAILABLE_HISTORY_ROUTES, route)),
  tennis: ROUTES.tennis,
  cs2: [],
});
const LABELS = {
  'basketball/nba': 'NBA', 'hockey/nhl': 'NHL', 'soccer/eng.1': 'Premier League',
  'soccer/esp.1': 'La Liga', 'soccer/ger.1': 'Bundesliga', 'soccer/ita.1': 'Serie A',
  'soccer/fra.1': 'Ligue 1', 'soccer/pol.1': 'Ekstraklasa', 'soccer/uefa.champions': 'Liga Mistrzów',
  'soccer/uefa.europa': 'Liga Europy', 'soccer/eng.2': 'Championship',
  'soccer/ned.1': 'Eredivisie', 'soccer/por.1': 'Liga Portugalska', 'tennis/atp': 'ATP', 'tennis/wta': 'WTA',
};
export const leagueLabel = route => LABELS[route] || route;
export const isAllowedRoute = (sport, route) => Object.hasOwn(ROUTES, sport) && ROUTES[sport].includes(route);

export function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Data musi mieć format YYYY-MM-DD');
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error('Nieprawidłowa data kalendarzowa');
  return timestamp;
}

export function scoreboardURL(route, day) {
  if (!Object.values(ROUTES).flat().includes(route)) throw new Error('Nieznana liga');
  parseDay(day);
  return `https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=${day.replaceAll('-', '')}&limit=1000`;
}
