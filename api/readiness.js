import { SPORTS, failure, getOnly, scalar } from '../src/server/http.js';
import { ROUTES } from '../src/server/catalog.js';
import { readForwardReport, readReports } from '../src/server/storage.js';
import { buildReadiness } from '../src/server/readiness.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, league;
  try {
    sport = scalar(req.query.sport, 'all'); league = scalar(req.query.league, 'all');
    if (sport !== 'all' && !SPORTS.includes(sport)) throw new Error('Nieznana dyscyplina');
    if (league !== 'all' && (sport === 'all' || !ROUTES[sport].some(route => route.split('/').at(-1) === league))) throw new Error('Nieznana liga');
  } catch (error) { return failure(res, 400, error.message); }
  const results = await Promise.allSettled([readReports(), readForwardReport()]);
  try {
    const [history, forward] = results.map(result => result.status === 'fulfilled' ? result.value : null);
    const data = buildReadiness(history, forward);
    if (sport !== 'all') {
      const entry = { ...data.sports[sport], leagues: data.sports[sport].leagues.filter(row => league === 'all' || row.league === league) };
      data.sports = { [sport]: entry };
      data.status = league === 'all' ? entry.status : entry.leagues[0]?.status || 'unavailable';
    }
    res.setHeader('Cache-Control', data.status === 'unavailable' ? 'no-store' : 'public, s-maxage=120');
    res.json(data);
  } catch { return failure(res, 503, 'Stan walidacji jest chwilowo niedostępny'); }
}
