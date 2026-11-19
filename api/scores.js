import { ESPN_UNAVAILABLE_HISTORY_ROUTES, ROUTES } from '../src/server/catalog.js';
import { fetchJSON } from '../src/data/fetch.js';
import { failure, getOnly, parseDate, scalar } from '../src/server/http.js';
import { liveEvents } from '../src/server/scores.js';
import { getEkstraklasaDay, getEkstraklasaNext } from '../src/server/ekstraklasa-service.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, routes, date;
  try {
    sport = scalar(req.query.sport, 'football');
    const league = scalar(req.query.league, 'all');
    date = parseDate(scalar(req.query.date));
    if (!Object.hasOwn(ROUTES, sport)) throw new Error('Nieznana dyscyplina');
    routes = league === 'all' ? ROUTES[sport] : ROUTES[sport].filter(r => r.split('/').at(-1) === league);
    if (league !== 'all' && !routes.length) throw new Error('Nieznana liga');
  } catch (error) { return failure(res, 400, error.message); }
  if (sport === 'cs2') return res.json({ events: [], errors: ['CS2: brak podłączonego źródła danych z potwierdzonym darmowym dostępem'], status: 'unavailable', source: 'none', fetchedAt: new Date().toISOString() });
  const events = [], errors = [], coverage = {};
  await Promise.all(routes.map(async route => {
    if (route === 'soccer/pol.1') {
      try {
        const data = await getEkstraklasaDay(date);
        events.push(...data.events); coverage[route] = data.coverage;
      } catch { errors.push('soccer/pol.1: TheSportsDB jest chwilowo niedostępne; spróbuj odświeżyć za kilka minut.'); }
      return;
    }
    if (ESPN_UNAVAILABLE_HISTORY_ROUTES[route]) {
      errors.push(`${route}: ${ESPN_UNAVAILABLE_HISTORY_ROUTES[route].reason}`);
      return;
    }
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${route}/scoreboard?dates=${date.replaceAll('-', '')}&limit=1000`;
      const data = await fetchJSON(url, { timeoutMs: 6000, retries: 1 });
      events.push(...liveEvents(data, { sport, route, date }));
    } catch { errors.push(`${route}: źródło chwilowo niedostępne`); }
  }));
  if (errors.length === routes.length) return failure(res, 502, 'Źródła wyników są niedostępne. Spróbuj ponownie później.');
  let nextEvent = null;
  if (sport === 'football' && routes.length === 1 && routes[0] === 'soccer/pol.1' && !events.length && !errors.length) {
    try { nextEvent = (await getEkstraklasaNext()).events.find(event => event.state === 'pre') || null; } catch { /* The requested day's response remains valid without discovery. */ }
  }
  res.setHeader('Cache-Control', errors.length ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=120');
  res.json({ events: [...new Map(events.map(e => [e.id, e])).values()].sort((a, b) => a.date.localeCompare(b.date)), errors, coverage,
    nextEvent, source: routes.includes('soccer/pol.1') ? routes.length === 1 ? 'TheSportsDB' : 'ESPN i TheSportsDB — darmowe źródła' : 'ESPN (nieoficjalne API)', fetchedAt: new Date().toISOString() });
}
