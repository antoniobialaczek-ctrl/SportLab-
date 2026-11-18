import { isAllowedRoute } from '../src/data/catalog.js';
import { failure, getOnly, parseTimestamp, scalar } from '../src/server/http.js';
import { readHistory } from '../src/server/storage.js';
import { summarizeParticipant } from '../src/server/analysis.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport, route, participantId, cutoff;
  try {
    sport = scalar(req.query.sport); route = scalar(req.query.route); participantId = scalar(req.query.participantId);
    cutoff = scalar(req.query.cutoff, new Date().toISOString());
    if (!isAllowedRoute(sport, route)) throw new Error('Nieznana liga');
    if (!/^\d{1,14}$/.test(participantId)) throw new Error('Nieprawidłowe ID uczestnika');
    if (parseTimestamp(cutoff) > Date.now()) throw new Error('Punkt odcięcia nie może być późniejszy niż teraz');
  } catch (error) { return failure(res, 400, error.message); }
  try {
    const history = await readHistory(sport);
    const summary = summarizeParticipant(history.events, { participantId, route, cutoff });
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.json({ ...summary, available: history.available, excludedRecords: history.exclusions?.length || 0, historyUpdatedAt: history.updatedAt, source: 'Zapisane wyniki ESPN' });
  } catch { return failure(res, 503, 'Historia jest niedostępna lub uszkodzona'); }
}
