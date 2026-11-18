import { SPORTS, failure, getOnly, scalar } from '../src/server/http.js';
import { readForwardReport, readReports } from '../src/server/storage.js';

export default async function handler(req, res) {
  if (!getOnly(req, res)) return;
  let sport;
  try {
    sport = scalar(req.query.sport, 'all');
    if (sport !== 'all' && !SPORTS.includes(sport)) throw new Error('Nieznana dyscyplina');
  } catch (error) { return failure(res, 400, error.message); }
  try {
    const report = await readReports();
    let forward = null;
    try { forward = await readForwardReport(); } catch { /* The historical report remains usable if the separate ledger report is missing. */ }
    const names = sport === 'all' ? SPORTS : [sport];
    const stale = !report || Date.now() - Date.parse(report.generatedAt) > 7 * 86400000;
    const sports = Object.fromEntries(names.map(name => {
      const entry = report?.sports[name] || { sport: name, status: 'unavailable', reason: 'Brak obliczonego raportu historycznego.', metrics: null };
      // Only evaluation summaries are public. Fixture probabilities require separate validation.
      return [name, { ...entry, publication: { eligible: false, reasons: [...(entry.publication?.reasons || []), ...(stale ? ['Raport nie jest aktualny.'] : []), 'Bieżące prognozy wymagają osobnej walidacji przedmeczowej.'] } }];
    }));
    const results = Object.values(sports).filter(s => s.metrics?.count > 0).map(s => ({
      name: s.sport, games: s.samples.total, test: s.metrics.count, raw: s.rawMetrics?.brier,
      calibrated: s.metrics.brier, accuracy: s.metrics.accuracy, asOf: s.provenance?.lastEventAt,
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.json({ version: '3.1', generatedAt: report?.generatedAt || null, stale, sports, results,
      updateSource: report?.runtimeData || { origin: 'local', fallback: false },
      forward: forward ? { generatedAt: forward.generatedAt, kind: forward.kind, sports: forward.sports, validation: forward.validation || null, audit: forward.audit || null, note: forward.note, updateSource: forward.runtimeData } : null,
      method: 'Chronologiczny trening, kalibracja, wybór kalibracji i oddzielny test końcowy. Aktualizacja modelu dopiero po udostępnieniu wyniku wcześniejszego meczu.',
      note: 'Metryki pochodzą z testów na zapisanej historii, nie oznaczają skuteczności bieżących typów. Retrospektywne dane ESPN nie są certyfikowanym archiwum informacji przedmeczowych.' });
  } catch { return failure(res, 503, 'Raport testów jest niedostępny lub uszkodzony'); }
}
