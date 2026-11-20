import { matchPickQuote } from './pick-odds.js';

const validMinimum = value => typeof value === 'number' && Number.isFinite(value) && value >= 1.01 && value <= 1000;
const bands = new Set(['all', 'lower', 'higher']);
const labels = { lower: 'Niższy kurs (poniżej 2,00)', higher: 'Wyższy kurs (od 2,00)' };
const result = (eligible, status, reason, quote = null, band = null) => ({ eligible, status, reason, quote, band, label: band ? labels[band] : null });

/** Filter observed prices only. A price band does not establish betting risk,
 * model accuracy, probability or value. Quote freshness metadata stays intact.
 */
export function screenPick(pick, event, { oddsData, minOdds = 1.5, band = 'all', now = Date.now() } = {}) {
  if (!validMinimum(minOdds) || !bands.has(band)) return result(false, 'invalid-settings', 'Podaj minimalny kurs od 1,01 do 1000 i poprawny zakres kursów.');
  const quote = matchPickQuote(oddsData, event, pick, { now });
  if (quote.status !== 'matched') return result(false, 'missing-price', quote.reason || 'Brak dopasowanego odczytu kursu.');
  const priceBand = quote.decimal < 2 ? 'lower' : 'higher';
  if (quote.decimal < minOdds) return result(false, 'below-minimum', 'Odczytany kurs jest niższy od wybranego minimum.', quote, priceBand);
  if (band !== 'all' && band !== priceBand) return result(false, 'outside-band', 'Odczytany kurs jest poza wybranym zakresem.', quote, priceBand);
  return result(true, 'priced', null, quote, priceBand);
}

/** Preserve original descriptors and order; only price eligibility changes. */
export function filterPricedPicks(picks, event, options = {}) {
  return Array.isArray(picks) ? picks.filter(pick => screenPick(pick, event, options).eligible) : [];
}
