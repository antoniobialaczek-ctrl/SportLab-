import { isAllowedRoute } from '../src/data/catalog.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { readHistory } from '../src/server/storage.js';
import { buildPlayerForm } from '../src/server/player-form.js';
import { isEkstraklasaId } from '../src/server/ekstraklasa-source.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, route, teamId, cutoff, count;
  try {
    sport = scalar(req.query.sport); route = scalar(req.query.route); teamId = scalar(req.query.teamId);
    cutoff = scalar(req.query.cutoff, new Date().toISOString());
    const requested = scalar(req.query.count, '10');
    if (!isAllowedRoute(sport, route)) throw new Error('Nieznana liga');
    if (!(route === 'soccer/pol.1' ? isEkstraklasaId(teamId) : /^\d{1,14}$/.test(teamId))) throw new Error('Nieprawidłowe ID drużyny');
    if (!/^(?:[1-9]|10)$/.test(requested)) throw new Error('Analiza może obejmować od jednego do dziesięciu ostatnich meczów');
    if (parseTimestamp(cutoff) > Date.now()) throw new Error('Punkt odcięcia nie może być późniejszy niż teraz');
    count = Number(requested);
  } catch (error) { return failure(res, 400, error.message); }
  try {
    if (route === 'soccer/pol.1') return res.json({ status: 'unavailable', sport, route, teamId, cutoff, players: [], sampledMatches: [], attemptedMatches: [], errors: [],
      fetchedAt: new Date().toISOString(), source: 'TheSportsDB', reason: 'Darmowe źródło Ekstraklasy nie udostępnia statystyk zawodników. Dostępna jest forma drużyn i porównanie wcześniejszych wyników.' });
    const history = sport === 'tennis' ? { events: [], updatedAt: null, runtimeData: { origin: 'local', fallback: false } } : await readHistory(sport);
    const result = await buildPlayerForm(history.events, { sport, route, teamId, cutoff, count });
    res.setHeader('Cache-Control', result.errors.length || result.status !== 'available' ? 'no-store' : 'public, s-maxage=900');
    res.json({ ...result, historyUpdatedAt: history.updatedAt, updateSource: history.runtimeData });
  } catch { return failure(res, 503, 'Historia do analizy zawodników jest niedostępna lub uszkodzona'); }
}
