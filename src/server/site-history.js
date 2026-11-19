import { readHistory } from './storage.js';
import { loadMLSHistory } from './mls-history.js';
import { ROUTES, MLS_ROUTE } from './catalog.js';

export async function readSiteHistory(sport, { route, routes = route ? [route] : ROUTES[sport] } = {}) {
  if (sport !== 'football' || !routes.includes(MLS_ROUTE)) return readHistory(sport);
  const [extra, original] = await Promise.all([loadMLSHistory(), routes.some(value => value !== MLS_ROUTE) ? readHistory(sport) : null]);
  return { events: [...(original?.events || []), ...extra.events], available: Boolean(original?.available || extra.events.length),
    updatedAt: [original?.updatedAt, extra.fetchedAt].filter(Boolean).sort().at(-1),
    exclusions: [...(original?.exclusions || []), ...(extra.exclusions || [])],
    coverage: { original: original?.coverage || null, mls: extra.coverage },
    runtimeData: { origin: original ? 'mixed' : extra.runtimeData?.origin || 'local',
      fallback: Boolean(original?.runtimeData?.fallback || extra.runtimeData?.fallback),
      sources: [original?.runtimeData, extra.runtimeData].filter(Boolean) }, modelExperimentEligible: false };
}
