import { ESPN_UNAVAILABLE_HISTORY_ROUTES, isAllowedRoute } from '../src/data/catalog.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { readHistory } from '../src/server/storage.js';
import { buildMatchAnalysis } from '../src/server/match-analysis.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let query;
  try {
    const sport = scalar(req.query.sport), route = scalar(req.query.route);
    const homeId = scalar(req.query.homeId), awayId = scalar(req.query.awayId);
    const cutoff = scalar(req.query.cutoff, new Date().toISOString());
    const fixtureId = scalar(req.query.fixtureId) || null;
    if (!isAllowedRoute(sport, route)) throw new Error('Nieznana liga');
    if (![homeId, awayId].every(id => /^\d{1,14}$/.test(id)) || homeId === awayId) throw new Error('Nieprawidłowi uczestnicy meczu');
    if (parseTimestamp(cutoff) > Date.now()) throw new Error('Punkt odcięcia nie może być późniejszy niż teraz');
    if (fixtureId && (!fixtureId.startsWith(route + ':') || !/^\d{4,14}$/.test(fixtureId.slice(route.length + 1)))) throw new Error('Nieprawidłowe ID meczu');
    query = { sport, route, homeId, awayId, cutoff, fixtureId };
  } catch (error) { return failure(res, 400, error.message); }
  try {
    const history = await readHistory(query.sport);
    const analysis = buildMatchAnalysis(history.events, query);
    const unavailable = ESPN_UNAVAILABLE_HISTORY_ROUTES[query.route];
    if (unavailable && analysis.status === 'unavailable') analysis.notes.unshift(unavailable.reason);
    res.setHeader('Cache-Control', analysis.status === 'unavailable' ? 'no-store' : history.runtimeData?.fallback ? 'public, s-maxage=30' : 'public, s-maxage=300');
    res.json({ ...analysis, available: analysis.status !== 'unavailable', historyAvailable: history.available,
      historyUpdatedAt: history.updatedAt, excludedRecords: history.exclusions?.length || 0,
      coverage: history.coverage || null, source: 'Zapisane wyniki ESPN', runtimeData: history.runtimeData || null });
  } catch { return failure(res, 503, 'Analiza meczu jest chwilowo niedostępna lub historia nie przeszła weryfikacji'); }
}
