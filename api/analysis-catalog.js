import { ROUTES, ESPN_UNAVAILABLE_HISTORY_ROUTES } from '../src/data/catalog.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { readHistory } from '../src/server/storage.js';
import { buildAnalysisCatalog } from '../src/server/analysis-catalog.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, routes, cutoff, limit;
  try {
    sport = scalar(req.query.sport, 'nba');
    const league = scalar(req.query.league, 'all');
    cutoff = scalar(req.query.cutoff, new Date().toISOString());
    const rawLimit = scalar(req.query.limit, '12');
    if (!/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 24) throw new Error('Limit musi mieścić się w zakresie 1–24');
    limit = Number(rawLimit);
    if (!Object.hasOwn(ROUTES, sport)) throw new Error('Nieznana dyscyplina');
    routes = league === 'all' ? ROUTES[sport] : ROUTES[sport].filter(route => route.split('/').at(-1) === league);
    if (league !== 'all' && !routes.length) throw new Error('Nieznana liga');
    if (parseTimestamp(cutoff) > Date.now()) throw new Error('Punkt odcięcia nie może być późniejszy niż teraz');
  } catch (error) { return failure(res, 400, error.message); }
  if (sport === 'cs2' || routes.every(route => ESPN_UNAVAILABLE_HISTORY_ROUTES[route])) return res.json({ events: [], status: 'unavailable', reason: 'Brak zweryfikowanego źródła historii tej dyscypliny lub ligi.' });
  try {
    const history = await readHistory(sport);
    const events = buildAnalysisCatalog(history.events, { sport, routes, cutoff, limit });
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.json({ events, status: events.length ? 'available' : 'unavailable', cutoff, historyUpdatedAt: history.updatedAt, runtimeData: history.runtimeData,
      reason: events.length ? null : 'Brak zakończonych meczów w zapisanej historii przed wybraną datą.',
      note: 'To archiwum zakończonych spotkań, a nie terminarz wybranego dnia. Analizy wykorzystują wyłącznie mecze wcześniejsze niż analizowane spotkanie.' });
  } catch { return failure(res, 503, 'Nie udało się odczytać archiwum analiz'); }
}
