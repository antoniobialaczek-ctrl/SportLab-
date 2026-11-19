import { isAllowedRoute } from './catalog.js';
import { predictFixture } from '../models/index.js';

const DAY = 86400000;
const bound = (query, reason, now) => ({
  status: 'withheld', probability: null, reason,
  fixtureId: query.id, sport: query.sport, route: query.route,
  market: query.market || null, outcome: query.outcome || null,
  generatedAt: new Date(now).toISOString(),
});

/** The existing preregistered protocol deliberately stops at review. Public
 * evaluation summaries do not constitute approval to publish fixture vectors.
 * There is currently no independently reviewed public release artifact.
 */
export function forecastReadiness(query, report, forward, { now = Date.now() } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(Date.parse(query.startTime))) throw new Error('Nieprawidłowy czas prognozy');
  if (Date.parse(query.startTime) <= now) return bound(query, 'Prognoza przedmeczowa nie jest dostępna po rozpoczęciu spotkania.', now);
  const entry = report?.sports?.[query.sport];
  const reportAt = Date.parse(report?.generatedAt);
  if (!entry || !Number.isFinite(reportAt) || reportAt > now || now - reportAt > 7 * DAY) return bound(query, 'Brak aktualnego raportu walidacji modelu. Można obliczyć wyłącznie próg rentowności wpisanego kursu.', now);
  const phase = forward?.validation?.leagues?.find(row => row.route === query.route)?.phase;
  const reason = phase === 'completed-awaiting-review'
    ? 'Niezależny test jest zamknięty i oczekuje przeglądu. Samo zakończenie próby nie zatwierdza publikacji prognoz.'
    : phase === 'failed' ? 'Model nie spełnił kryteriów niezależnego testu. Prognozy pozostają wstrzymane.'
      : 'Brak zatwierdzonej niezależnej walidacji przedmeczowej. Opłacalność względem modelu pozostaje niedostępna; nie zastępujemy prognozy historyczną trafnością.';
  return { ...bound(query, reason, now), validationPhase: phase || 'unavailable', publication: { eligible: false } };
}

/** Bind a client-selected fixture to a freshly fetched provider scoreboard.
 * This adapter is intentionally separate from readiness: blocked requests do
 * not cause an unnecessary provider fetch. No client neutral-site flag is used.
 */
export function verifyLiveFixture(query, data, { now = Date.now() } = {}) {
  if (!isAllowedRoute(query.sport, query.route) || !Array.isArray(data?.events)) throw new Error('Brak zweryfikowanego terminarza');
  const matches = [];
  for (const event of data.events) {
    const competitions = query.sport === 'tennis'
      ? (event.groupings || []).filter(group => group.grouping?.slug === (query.route === 'tennis/atp' ? 'mens-singles' : 'womens-singles')).flatMap(group => group.competitions || [])
      : event.competitions || [];
    for (const competition of competitions) {
      if (`${query.route}:${competition.id}` !== query.id) continue;
      matches.push({ event, competition });
    }
  }
  if (matches.length !== 1) throw new Error('Nie można jednoznacznie potwierdzić meczu');
  const { event, competition } = matches[0];
  const participants = competition.competitors;
  const home = participants?.find(row => row.homeAway === 'home');
  const away = participants?.find(row => row.homeAway === 'away');
  const startTime = competition.date || event.date;
  const status = competition.status?.type || event.status?.type;
  if (participants?.length !== 2 || String(home?.id) !== query.homeId || String(away?.id) !== query.awayId
    || query.homeId === query.awayId || !Number.isFinite(Date.parse(startTime))
    || Date.parse(startTime) !== Date.parse(query.startTime) || Date.parse(startTime) <= now
    || status?.state !== 'pre' || status?.completed === true || typeof competition.neutralSite !== 'boolean') throw new Error('Terminarz nie potwierdza uczestników, terminu, statusu lub miejsca spotkania');
  return { id: query.id, sport: query.sport, route: query.route, homeId: query.homeId, awayId: query.awayId, startTime: new Date(startTime).toISOString(), neutralSite: competition.neutralSite };
}

/** Connect the existing model trust boundary without publishing research
 * vectors. A future reviewed release must explicitly integrate approval and
 * market mapping; a retrospective status or an edited report is insufficient.
 */
export function inspectVerifiedModelBoundary(query, scoreboard, history, report, { now = Date.now() } = {}) {
  const fixture = verifyLiveFixture(query, scoreboard, { now });
  const prediction = predictFixture(fixture, history, report?.sports?.[query.sport], { now: new Date(now).toISOString() });
  return bound(query, prediction.status === 'withheld' ? prediction.reason : 'Model przeszedł własną granicę walidacji; nadal wymagany jest niezależny przegląd publikacji przedmeczowej.', now);
}
