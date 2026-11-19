import { analyzePlayers } from '../src/server/analysis.js';
import { ROUTES, isAllowedRoute } from '../src/data/catalog.js';
import { fetchJSON } from '../src/data/fetch.js';
import { failure, getOnly, scalar } from '../src/server/http.js';
import { extractAvailability } from '../src/server/match-context.js';
import { extractOdds } from '../src/server/odds.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, route, id;
  try {
    sport = scalar(req.query.sport);
    route = scalar(req.query.route, ROUTES[sport]?.[0]);
    id = scalar(req.query.id);
    if (!isAllowedRoute(sport, route)) throw new Error('Nieznana liga');
    if (!/^\d{4,14}$/.test(id)) throw new Error('Nieprawidłowe ID');
  } catch (error) { return failure(res, 400, error.message); }
  try {
    const data = await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/${route}/summary?event=${id}`, { timeoutMs: 8000, retries: 1 });
    if (!data.header && !data.boxscore) return failure(res, 404, 'Brak szczegółów tego spotkania');
    const players = (data.boxscore?.players || []).flatMap(group => (group.statistics || []).flatMap(s => (s.athletes || []).slice(0, 40).map(p => ({
      id: p.athlete?.id, team: group.team?.displayName || '', name: p.athlete?.displayName || '',
      stats: p.stats || [], labels: s.labels || [], didNotPlay: p.didNotPlay || false,
    }))));
    const teamStats = (data.boxscore?.teams || []).map(t => ({ team: t.team?.displayName || '', statistics: (t.statistics || []).map(s => ({ name: s.label || s.name, value: s.displayValue ?? s.value })) }));
    const injuries = (data.injuries || []).flatMap(t => (t.injuries || []).map(i => ({ team: t.team?.displayName || '', name: i.athlete?.displayName || '', status: i.status || '' })));
    const fetchedAt = new Date().toISOString();
    const availability = extractAvailability(data, { id, sport, fetchedAt });
    const competition = Array.isArray(data.header?.competitions) ? data.header.competitions.find(row => String(row?.id) === id) : null;
    const home = competition?.competitors?.find?.(row => row.homeAway === 'home');
    const away = competition?.competitors?.find?.(row => row.homeAway === 'away');
    const odds = competition && home && away ? extractOdds(data, {
      sport, route, id: `${route}:${id}`, homeId: String(home.id), awayId: String(away.id), startTime: competition.date,
    }, { now: Date.parse(fetchedAt) }) : null;
    res.setHeader('Cache-Control', odds?.status === 'available' ? 'public, s-maxage=60' : 'public, s-maxage=300');
    res.json({ players, teamStats, injuries, availability, odds, playerAnalysis: analyzePlayers(players, sport), source: 'ESPN', fetchedAt, note: 'Statystyki opisowe. Lista kontuzji odzwierciedla stan źródła w chwili pobrania, nie historyczny stan przed meczem.' });
  } catch { return failure(res, 502, 'Nie udało się pobrać szczegółów z ESPN'); }
}
