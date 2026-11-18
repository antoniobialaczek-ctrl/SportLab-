import { isAllowedRoute } from '../src/data/catalog.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { readForwardReport, readReports } from '../src/server/storage.js';
import { forecastReadiness } from '../src/server/forecast.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let query;
  try {
    const sport = scalar(req.query.sport), route = scalar(req.query.route);
    const homeId = scalar(req.query.homeId), awayId = scalar(req.query.awayId);
    const id = scalar(req.query.id), startTime = scalar(req.query.startTime);
    const market = scalar(req.query.market), outcome = scalar(req.query.outcome);
    if (!isAllowedRoute(sport, route)) throw new Error('Nieznana liga');
    if (![homeId, awayId].every(value => /^\d{1,14}$/.test(value)) || homeId === awayId) throw new Error('Nieprawidłowi uczestnicy');
    if (!id.startsWith(route + ':') || !/^\d{4,14}$/.test(id.slice(route.length + 1))) throw new Error('Nieprawidłowe ID meczu');
    parseTimestamp(startTime);
    const allowed = sport === 'football' ? { result_90: ['home', 'draw', 'away'], double_chance_90: ['home_draw', 'draw_away'] }
      : ['nba', 'nhl', 'tennis'].includes(sport) ? { winner: ['home', 'away'] } : {};
    if ((market || outcome) && !allowed[market]?.includes(outcome)) throw new Error('Rynek nie odpowiada dyscyplinie lub wynikowi');
    query = { sport, route, homeId, awayId, id, startTime, market, outcome };
  } catch (error) { return failure(res, 400, error.message); }
  try {
    const [report, forward] = await Promise.all([readReports(), readForwardReport()]);
    // No provider call is necessary while public publication remains withheld.
    res.setHeader('Cache-Control', 'no-store');
    res.json(forecastReadiness(query, report, forward));
  } catch { return failure(res, 503, 'Nie można potwierdzić walidacji. Prognoza i opłacalność względem modelu są niedostępne.'); }
}
