import { isAllowedRoute } from '../src/server/catalog.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { readSiteHistory } from '../src/server/site-history.js';
import { summarizeParticipant } from '../src/server/analysis.js';
import { loadEkstraklasaHistory } from '../src/server/ekstraklasa-history.js';
import { isEkstraklasaId } from '../src/server/ekstraklasa-source.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, route, participantId, cutoff;
  try {
    sport = scalar(req.query.sport); route = scalar(req.query.route); participantId = scalar(req.query.participantId);
    cutoff = scalar(req.query.cutoff, new Date().toISOString());
    if (!isAllowedRoute(sport, route)) throw new Error('Nieznana liga');
    if (!(route === 'soccer/pol.1' ? isEkstraklasaId(participantId) : /^\d{1,14}$/.test(participantId))) throw new Error('Nieprawidłowe ID uczestnika');
    if (parseTimestamp(cutoff) > Date.now()) throw new Error('Punkt odcięcia nie może być późniejszy niż teraz');
  } catch (error) { return failure(res, 400, error.message); }
  try {
    if (route === 'soccer/pol.1') {
      const history = await loadEkstraklasaHistory();
      const summary = summarizeParticipant(history.events, { participantId, route, cutoff });
      res.setHeader('Cache-Control', history.runtimeData.fallback ? 'public, s-maxage=30' : 'public, s-maxage=300');
      return res.json({ ...summary, available: summary.sample > 0, historyUpdatedAt: history.fetchedAt, source: 'TheSportsDB', coverage: history.coverage, modelExperimentEligible: false });
    }
    const history = await readSiteHistory(sport, { route });
    const summary = summarizeParticipant(history.events, { participantId, route, cutoff });
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.json({ ...summary, available: history.available, excludedRecords: history.exclusions?.length || 0, historyUpdatedAt: history.updatedAt, source: 'Zapisane wyniki ESPN' });
  } catch { return failure(res, 503, 'Historia jest niedostępna lub uszkodzona'); }
}
