// Public descriptive leagues may grow without changing the preregistered
// model catalogue or its implementation fingerprint.
import { ROUTES as MODEL_ROUTES, leagueLabel as modelLabel } from '../data/catalog.js';
export { ESPN_UNAVAILABLE_HISTORY_ROUTES } from '../data/catalog.js';
export const MLS_ROUTE = 'soccer/usa.1';
export const ROUTES = Object.freeze({ ...MODEL_ROUTES, football: Object.freeze([...MODEL_ROUTES.football, MLS_ROUTE]) });
export const leagueLabel = route => route === MLS_ROUTE ? 'MLS' : modelLabel(route);
export const isAllowedRoute = (sport, route) => Object.hasOwn(ROUTES, sport) && ROUTES[sport].includes(route);
