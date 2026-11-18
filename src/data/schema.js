import { isAllowedRoute } from './catalog.js';

export const SCHEMA_VERSION = 1;
const ID = /^[\w.-]{1,80}$/;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Validate stored data at every trust boundary; never coerce missing values to zero. */
export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Nieprawidłowy rekord meczu');
  const fail = message => { throw new Error(`${event.id || 'mecz'}: ${message}`); };
  if (!isAllowedRoute(event.sport, event.route)) fail('nieznana dyscyplina lub liga');
  if (event.league !== event.route.split('/').at(-1)) fail('liga nie odpowiada źródłu');
  if (typeof event.sourceEventId !== 'string' || !ID.test(event.sourceEventId)) fail('brak stabilnego ID meczu');
  if (event.id !== `${event.route}:${event.sourceEventId}`) fail('niestabilny klucz meczu');
  for (const field of ['homeId', 'awayId']) if (typeof event[field] !== 'string' || !ID.test(event[field])) fail(`nieprawidłowy ${field}`);
  if (event.homeId === event.awayId) fail('ten sam uczestnik po obu stronach');
  for (const field of ['home', 'away']) if (typeof event[field] !== 'string' || !event[field].trim() || event[field].length > 200) fail(`brak nazwy ${field}`);
  for (const field of ['homeScore', 'awayScore']) if (!Number.isInteger(event[field]) || event[field] < 0 || event[field] > 300) fail(`nieprawidłowy wynik ${field}`);
  if (event.sport !== 'football' && event.homeScore === event.awayScore) fail('remis w dyscyplinie bez remisów');
  if (event.sport === 'tennis' && (Math.max(event.homeScore, event.awayScore) < 2 || Math.max(event.homeScore, event.awayScore) > 3 || Math.min(event.homeScore, event.awayScore) > 2)) fail('nieprawidłowy wynik setowy');
  if (event.status !== 'completed') fail('mecz nie jest zakończony');
  if (typeof event.neutralSite !== 'boolean') fail('brak informacji o neutralnym obiekcie');
  for (const field of ['startTime', 'resultAvailableAt']) if (!validDate(event[field])) fail(`nieprawidłowy czas ${field}`);
  if (Date.parse(event.resultAvailableAt) <= Date.parse(event.startTime)) fail('wynik dostępny przed rozegraniem meczu');
  if (!['conservative-24h', 'verified-timestamp', 'historical-snapshot'].includes(event.availabilityBasis)) fail('nieznana podstawa dostępności wyniku');
  if (event.availabilityBasis === 'conservative-24h' && Date.parse(event.resultAvailableAt) !== Date.parse(event.startTime) + 86_400_000) fail('nieprawidłowy bufor dostępności wyniku');
  if (!event.source || event.source.provider !== 'ESPN' || !validDate(event.source.fetchedAt)) fail('brak pochodzenia danych');
  let sourceURL;
  try { sourceURL = new URL(event.source.url); } catch { fail('nieprawidłowy URL źródła'); }
  if (sourceURL.protocol !== 'https:' || sourceURL.hostname !== 'site.api.espn.com' || !sourceURL.pathname.startsWith(`/apis/site/v2/sports/${event.route}/`)) fail('niezaufany URL źródła');
  if (Date.parse(event.source.fetchedAt) < Date.parse(event.startTime)) fail('wynik pobrany przed meczem');
  return event;
}

export function validateHistory(history, sport) {
  if (!history || history.schemaVersion !== SCHEMA_VERSION || !Array.isArray(history.events)) throw new Error('Nieobsługiwany format historii');
  const seen = new Set();
  for (const event of history.events) {
    validateEvent(event);
    if (event.sport !== sport) throw new Error('Historia zawiera inną dyscyplinę');
    if (seen.has(event.id)) throw new Error(`Powielony klucz meczu: ${event.id}`);
    seen.add(event.id);
  }
  return history;
}

/** Preserve stable identities; corrections to scores are allowed and remain auditable. */
export function mergeEvents(previous, incoming) {
  const merged = new Map();
  for (const batch of [previous, incoming]) {
    const seen = new Set();
    for (let event of batch) {
      validateEvent(event);
      if (seen.has(event.id)) throw new Error(`Powielony klucz meczu: ${event.id}`);
      seen.add(event.id);
      const old = merged.get(event.id);
      if (old && ['sport', 'route', 'sourceEventId', 'homeId', 'awayId'].some(field => old[field] !== event[field])) throw new Error(`Konflikt tożsamości meczu: ${event.id}`);
      if (old) {
        const changed = ['homeScore', 'awayScore', 'startTime', 'resultAvailableAt', 'neutralSite'].filter(field => old[field] !== event[field]);
        const revisions = [...(old.revisions || [])];
        if (changed.length) revisions.push({
          observedAt: event.source.fetchedAt,
          previousFetchedAt: old.source.fetchedAt,
          fields: Object.fromEntries(changed.map(field => [field, { before: old[field], after: event[field] }])),
        });
        if (revisions.length) event = { ...event, revisions };
      }
      merged.set(event.id, event);
    }
  }
  return [...merged.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id));
}
