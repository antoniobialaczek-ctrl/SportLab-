import { isAllowedRoute } from '../src/server/catalog.js';
import { failure, getOnly, scalar } from '../src/server/http.js';
import { readSiteHistory } from '../src/server/site-history.js';
import { isEkstraklasaId } from '../src/server/ekstraklasa-source.js';
import { loadEkstraklasaHistory } from '../src/server/ekstraklasa-history.js';
import { fetchJournalResult, journalScoreScope } from '../src/server/journal-result-source.js';

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
      ...(journalScoreScope(row.sport) ? { scope: journalScoreScope(row.sport) } : {}),
      source: { provider: row.source.provider, url: row.source.url, fetchedAt: row.source.fetchedAt },
    }));
  const found = new Set(rows.map(row => row.id));
  return { rows, missing: ids.filter(id => !found.has(id)) };
}

async function requestedHistory(sport, ids) {
  const needsEkstraklasa = ids.some(id => id.startsWith('soccer/pol.1:'));
  const needsESPN = ids.some(id => !id.startsWith('soccer/pol.1:'));
  const [original, extra] = await Promise.all([needsESPN ? readSiteHistory(sport, { routes: [...new Set(ids.filter(id => !id.startsWith('soccer/pol.1:')).map(id => id.slice(0, id.lastIndexOf(':'))))] }) : null, needsEkstraklasa ? loadEkstraklasaHistory() : null]);
  if (!extra) return original;
  return { events: [...(original?.events || []), ...extra.events], available: Boolean(original?.available || extra.events.length),
    updatedAt: [original?.updatedAt, extra.fetchedAt].filter(Boolean).sort().at(-1) || null,
    runtimeData: { origin: original ? 'mixed' : extra.runtimeData.origin,
      fallback: Boolean(original?.runtimeData?.fallback || extra.runtimeData.fallback),
      sources: [original?.runtimeData, extra.runtimeData].filter(Boolean) } };
}

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, ids, details;
  try {
    sport = scalar(req.query.sport);
    const input = scalar(req.query.ids);
    const detailMode = scalar(req.query.details, '0');
    if (!['0', '1'].includes(detailMode)) throw new Error('Nieprawidłowy tryb odczytu szczegółów');
    details = detailMode === '1';
    if (!['nba', 'football', 'nhl', 'tennis'].includes(sport)) throw new Error('Nieznana dyscyplina');
    ids = input.split(',');
    if (!input || input.length > 2500 || ids.length > 50 || new Set(ids).size !== ids.length) throw new Error('Podaj od 1 do 50 różnych ID meczów');
    if (details && (ids.length > 2 || sport === 'tennis')) throw new Error('Szczegółowy odczyt obejmuje najwyżej 2 mecze sportów drużynowych');
    for (const id of ids) {
      const colon = id.lastIndexOf(':');
      const route = id.slice(0, colon), sourceId = id.slice(colon + 1);
      if (colon < 1 || !isAllowedRoute(sport, route) || !(route === 'soccer/pol.1' ? isEkstraklasaId(sourceId) : /^\d{4,14}$/.test(sourceId))) throw new Error('Nieprawidłowe ID meczu lub liga');
    }
  } catch (error) { return failure(res, 400, error.message); }
  try {
    const detailRequests = details ? ids.filter(id => !id.startsWith('soccer/pol.1:')) : [];
    const [history, observations] = await Promise.all([requestedHistory(sport, ids), Promise.all(detailRequests.map(async id => {
      try { return { id, row: await fetchJournalResult(sport, id), failed: false }; }
      catch { return { id, row: null, failed: true }; }
    }))]);
    const selected = selectJournalResults(history, ids), errors = [];
    for (const observation of observations) {
      if (observation.failed) { errors.push({ id: observation.id, reason: 'Bieżący boxscore jest chwilowo niedostępny; brak statystyki nie rozlicza typu zawodnika.' }); continue; }
      // A verified final response may correct old history. A received response
      // which does not prove completion must not reuse an older final score.
      selected.rows = selected.rows.filter(row => row.id !== observation.id);
      if (observation.row) selected.rows.push(observation.row);
    }
    const found = new Set(selected.rows.map(row => row.id));
    selected.missing = ids.filter(id => !found.has(id));
    res.setHeader('Cache-Control', history.available && !history.runtimeData?.fallback && !errors.length ? `public, s-maxage=${details ? 30 : 60}` : 'no-store');
    const source = ids.every(id => id.startsWith('soccer/pol.1:')) ? 'Zakończone wyniki TheSportsDB'
      : ids.some(id => id.startsWith('soccer/pol.1:')) ? 'Zakończone wyniki ESPN i TheSportsDB' : 'Znormalizowane zakończone wyniki ESPN';
    res.json({ ...selected, fetchedAt: new Date().toISOString(), source,
      historyAvailable: history.available, historyUpdatedAt: history.updatedAt,
      runtimeData: history.runtimeData || null,
      detailsRequested: details, errors,
      note: 'Brak wyniku oznacza oczekiwanie lub brak danych, nigdy przegrany zakład. Wyniki służą rozliczeniu własnego dziennika, nie pomiarowi modeli.' });
  } catch { return failure(res, 503, 'Historia wyników jest niedostępna lub nie przeszła weryfikacji. Dziennik pozostaje nierozliczony.'); }
}
