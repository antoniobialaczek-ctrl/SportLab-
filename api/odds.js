import { ESPN_UNAVAILABLE_HISTORY_ROUTES, isAllowedRoute } from '../src/server/catalog.js';
import { fetchJSON } from '../src/data/fetch.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { extractOdds } from '../src/server/odds.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let fixture;
  try {
    const sport = scalar(req.query.sport), route = scalar(req.query.route), id = scalar(req.query.id);
    const homeId = scalar(req.query.homeId), awayId = scalar(req.query.awayId), startTime = scalar(req.query.startTime);
    if (!isAllowedRoute(sport, route)) throw new Error('Nieznana liga');
    if (![homeId, awayId].every(value => /^\d{1,14}$/.test(value)) || homeId === awayId) throw new Error('Nieprawidłowi uczestnicy');
    if (!id.startsWith(route + ':') || !/^\d{4,14}$/.test(id.slice(route.length + 1))) throw new Error('Nieprawidłowe ID meczu');
    parseTimestamp(startTime);
    fixture = { sport, route, id, homeId, awayId, startTime };
  } catch (error) { return failure(res, 400, error.message); }
  res.setHeader('Cache-Control', 'no-store');
  if (!['nba', 'nhl', 'football'].includes(fixture.sport) || ESPN_UNAVAILABLE_HISTORY_ROUTES[fixture.route]) return res.json({ status: 'unavailable', quotes: [], reason: 'Brak obsługi kursów dla tej ligi.', fetchedAt: new Date().toISOString() });
  if (Date.parse(fixture.startTime) <= Date.now()) return res.json({ status: 'closed', quotes: [], reason: 'Nie pobieramy kursów przedmeczowych po rozpoczęciu spotkania.', fetchedAt: new Date().toISOString() });
  try {
    const sourceId = fixture.id.slice(fixture.route.length + 1);
    const data = await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/${fixture.route}/summary?event=${sourceId}`, { timeoutMs: 5000, retries: 0 });
    res.json(extractOdds(data, fixture));
  } catch { return failure(res, 502, 'Źródło kursów jest chwilowo niedostępne. Kurs można wpisać ręcznie w dzienniku.'); }
}
