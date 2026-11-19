import { ESPN_UNAVAILABLE_HISTORY_ROUTES, isAllowedRoute } from '../src/data/catalog.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { readHistory } from '../src/server/storage.js';
import { buildMatchAnalysis } from '../src/server/match-analysis.js';
import { isEkstraklasaId } from '../src/server/ekstraklasa-source.js';
import { loadEkstraklasaHistory } from '../src/server/ekstraklasa-history.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let query;
  try {
    const sport = scalar(req.query.sport), route = scalar(req.query.route);
    const homeId = scalar(req.query.homeId), awayId = scalar(req.query.awayId);
    const cutoff = scalar(req.query.cutoff, new Date().toISOString());
    const fixtureId = scalar(req.query.fixtureId) || null;
    if (!isAllowedRoute(sport, route)) throw new Error('Nieznana liga');
    if (![homeId, awayId].every(id => route === 'soccer/pol.1' ? isEkstraklasaId(id) : /^\d{1,14}$/.test(id)) || homeId === awayId) throw new Error('Nieprawidłowi uczestnicy meczu');
    if (parseTimestamp(cutoff) > Date.now()) throw new Error('Punkt odcięcia nie może być późniejszy niż teraz');
    if (fixtureId && (!fixtureId.startsWith(route + ':') || !(route === 'soccer/pol.1' ? isEkstraklasaId(fixtureId.slice(route.length + 1)) : /^\d{4,14}$/.test(fixtureId.slice(route.length + 1))))) throw new Error('Nieprawidłowe ID meczu');
    query = { sport, route, homeId, awayId, cutoff, fixtureId };
  } catch (error) { return failure(res, 400, error.message); }
  try {
    if (query.route === 'soccer/pol.1') {
      const history = await loadEkstraklasaHistory();
      const analysis = buildMatchAnalysis(history.events, query);
      analysis.notes.unshift('Wyniki TheSportsDB zaobserwowane od uruchomienia tego źródła. Osobna analiza opisowa Ekstraklasy; nie jest wynikiem testu modelu.');
      res.setHeader('Cache-Control', history.runtimeData.fallback ? 'public, s-maxage=30' : 'public, s-maxage=300');
      return res.json({ ...analysis, available: analysis.status !== 'unavailable', historyAvailable: history.events.length > 0,
        historyUpdatedAt: history.fetchedAt, coverage: history.coverage, source: 'TheSportsDB', runtimeData: history.runtimeData,
        modelExperimentEligible: false });
    }
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
