import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { getFootballExtraStats } from '../src/server/football-extra-stats.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let query;
  try {
    query = { sport: scalar(req.query.sport, 'football'), route: scalar(req.query.route), homeId: scalar(req.query.homeId), awayId: scalar(req.query.awayId),
      fixtureId: scalar(req.query.fixtureId), fixtureStart: new Date(parseTimestamp(scalar(req.query.fixtureStart))).toISOString() };
    // Service validation runs synchronously before any source access.
    const pending = getFootballExtraStats(query);
    const data = await pending;
    res.setHeader('Cache-Control', data.status === 'available' ? 'public, s-maxage=60' : 'no-store');
    return res.json(data);
  } catch (error) {
    return failure(res, /Nieprawidłow|UTC/.test(error.message) ? 400 : 503, /Nieprawidłow|UTC/.test(error.message) ? error.message : 'Dodatkowe statystyki piłkarskie są chwilowo niedostępne');
  }
}
