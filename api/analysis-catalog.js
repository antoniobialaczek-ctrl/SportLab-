import { ROUTES } from '../src/server/catalog.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { readSiteHistory } from '../src/server/site-history.js';
import { buildAnalysisCatalog } from '../src/server/analysis-catalog.js';
import { loadEkstraklasaHistory } from '../src/server/ekstraklasa-history.js';

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
  if (sport === 'cs2') return res.json({ events: [], status: 'unavailable', reason: 'Brak podłączonego źródła historii CS2.' });
  try {
    let history;
    if (routes.includes('soccer/pol.1')) {
      const [extra, original] = await Promise.all([loadEkstraklasaHistory(), routes.some(route => route !== 'soccer/pol.1') ? readSiteHistory(sport, { routes: routes.filter(route => route !== 'soccer/pol.1') }) : Promise.resolve(null)]);
      history = { events: [...(original?.events || []), ...extra.events], updatedAt: [original?.updatedAt, extra.fetchedAt].filter(Boolean).sort().at(-1),
        runtimeData: { sources: [original?.runtimeData, extra.runtimeData].filter(Boolean), fallback: Boolean(original?.runtimeData?.fallback || extra.runtimeData.fallback) } };
    } else history = await readSiteHistory(sport, { routes: routes.filter(route => route !== 'soccer/pol.1') });
    const events = buildAnalysisCatalog(history.events, { sport, routes, cutoff, limit });
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.json({ events, status: events.length ? 'available' : 'unavailable', cutoff, historyUpdatedAt: history.updatedAt, runtimeData: history.runtimeData,
      reason: events.length ? null : 'Brak zakończonych meczów w zapisanej historii przed wybraną datą.',
      note: 'To archiwum zakończonych spotkań, a nie terminarz wybranego dnia. Analizy wykorzystują wyłącznie mecze wcześniejsze niż analizowane spotkanie.' });
  } catch { return failure(res, 503, 'Nie udało się odczytać archiwum analiz'); }
}
