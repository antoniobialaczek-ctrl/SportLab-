import { isAllowedRoute } from '../src/data/catalog.js';
import { failure, getOnly, scalar } from '../src/server/http.js';
import { readHistory } from '../src/server/storage.js';

/** Return only specifically requested normalized results, never a full ledger
 * or arbitrary provider boxscore. Personal prices and selections stay local.
 */
export function selectJournalResults(history, ids, { now = Date.now() } = {}) {
  const wanted = new Set(ids);
  const rows = (history.events || []).filter(row => wanted.has(row.id) && row.status === 'completed'
    && Date.parse(row.startTime) < now && Date.parse(row.resultAvailableAt) <= now
    && Date.parse(row.source?.fetchedAt) <= now).map(row => ({
      id: row.id, sourceEventId: row.sourceEventId, sport: row.sport, route: row.route, league: row.league,
      homeId: row.homeId, awayId: row.awayId, home: row.home, away: row.away,
      homeScore: row.homeScore, awayScore: row.awayScore, startTime: row.startTime,
      status: row.status, resultAvailableAt: row.resultAvailableAt, availabilityBasis: row.availabilityBasis,
      neutralSite: row.neutralSite,
      source: { provider: row.source.provider, url: row.source.url, fetchedAt: row.source.fetchedAt },
    }));
  const found = new Set(rows.map(row => row.id));
  return { rows, missing: ids.filter(id => !found.has(id)) };
}

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, ids;
  try {
    sport = scalar(req.query.sport);
    const input = scalar(req.query.ids);
    if (!['nba', 'football', 'nhl', 'tennis'].includes(sport)) throw new Error('Nieznana dyscyplina');
    ids = input.split(',');
    if (!input || input.length > 2500 || ids.length > 50 || new Set(ids).size !== ids.length) throw new Error('Podaj od 1 do 50 różnych ID meczów');
    for (const id of ids) {
      const colon = id.lastIndexOf(':');
      if (colon < 1 || !isAllowedRoute(sport, id.slice(0, colon)) || !/^\d{4,14}$/.test(id.slice(colon + 1))) throw new Error('Nieprawidłowe ID meczu lub liga');
    }
  } catch (error) { return failure(res, 400, error.message); }
  try {
    const history = await readHistory(sport);
    const selected = selectJournalResults(history, ids);
    res.setHeader('Cache-Control', history.available && !history.runtimeData?.fallback ? 'public, s-maxage=60' : 'no-store');
    res.json({ ...selected, fetchedAt: new Date().toISOString(), source: 'Znormalizowane zakończone wyniki ESPN',
      historyAvailable: history.available, historyUpdatedAt: history.updatedAt,
      runtimeData: history.runtimeData || null,
      note: 'Brak wyniku oznacza oczekiwanie lub brak danych, nigdy przegrany zakład. Wyniki służą rozliczeniu własnego dziennika, nie pomiarowi modeli.' });
  } catch { return failure(res, 503, 'Historia wyników jest niedostępna lub nie przeszła weryfikacji. Dziennik pozostaje nierozliczony.'); }
}
