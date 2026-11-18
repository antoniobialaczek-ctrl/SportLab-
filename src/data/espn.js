import { isAllowedRoute } from './catalog.js';
import { validateEvent } from './schema.js';

const FINAL_TEAM = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME']);
const excludedNotes = /\b(retired|retirement|walkover|walk over|w\/o|defaulted|abandoned|cancelled|canceled|ret\.)\b/i;
const score = value => {
  const raw = value && typeof value === 'object' ? value.value ?? value.displayValue : value;
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+$/.test(raw))) throw new Error('Brak liczbowego wyniku');
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Nieprawidłowy wynik');
  return parsed;
};

function tennisSets(home, away) {
  const h = home.linescores;
  const a = away.linescores;
  if (!Array.isArray(h) || !Array.isArray(a) || h.length !== a.length || h.length < 2 || h.length > 5) throw new Error('Brak pełnego zapisu setów');
  let homeScore = 0;
  let awayScore = 0;
  for (let i = 0; i < h.length; i++) {
    if (typeof h[i].winner !== 'boolean' || typeof a[i].winner !== 'boolean' || h[i].winner === a[i].winner) throw new Error('Niejednoznaczny zwycięzca seta');
    const hv = score(h[i].value);
    const av = score(a[i].value);
    if (hv === av || (hv > av) !== h[i].winner) throw new Error('Wynik seta nie zgadza się ze zwycięzcą');
    if (h[i].winner) homeScore++; else awayScore++;
  }
  if ((homeScore > awayScore) !== home.winner || (awayScore > homeScore) !== away.winner) throw new Error('Zwycięzca meczu nie odpowiada setom');
  return { homeScore, awayScore };
}

/** Return completed individual matches only; never interpret a tennis tournament as a match. */
export function normalizeScoreboard(data, { sport, route, fetchedAt = new Date().toISOString(), url, day } = {}) {
  if (!isAllowedRoute(sport, route)) throw new Error('Nieznana dyscyplina lub liga');
  if (!data || !Array.isArray(data.events)) throw new Error('Źródło nie zawiera listy wydarzeń');
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error('Nieprawidłowy czas pobrania');
  const events = [];
  const rejected = [];
  let skipped = 0;
  const seen = new Map();
  for (const tournament of data.events) {
    if (sport === 'tennis' ? !Array.isArray(tournament.groupings) : !Array.isArray(tournament.competitions)) throw new Error('Źródło zmieniło strukturę listy spotkań');
    const competitions = sport === 'tennis'
      ? (tournament.groupings || []).flatMap(group => (group.competitions || []).map(competition => ({ competition, group: group.grouping?.slug })))
      : (tournament.competitions || []).map(competition => ({ competition }));
    for (const { competition: c, group } of competitions) {
      const type = c.status?.type || (sport === 'tennis' ? undefined : tournament.status?.type);
      const singles = c.type?.slug || group;
      const expectedSingles = route === 'tennis/atp' ? 'mens-singles' : 'womens-singles';
      // Both endpoints can return both tours within a shared tournament. Neither
      // path nor uid determines the actual tour: the match/group slug does.
      if (sport === 'tennis' && (singles !== expectedSingles || (group && group !== expectedSingles))) { skipped++; continue; }
      const finalized = type?.state === 'post' && type?.completed === true && (sport === 'tennis' ? type.name === 'STATUS_FINAL' : FINAL_TEAM.has(type.name));
      if (!finalized || excludedNotes.test((c.notes || []).map(note => note.text || '').join(' '))) { skipped++; continue; }
      if (sport === 'football' && (
        Number(c.status?.period || tournament.status?.period || 0) > 2 || c.shootout === true ||
        /extra\s*time|penalt|shootout|\bAET\b/i.test([type.detail, type.shortDetail, type.description].filter(Boolean).join(' ')) ||
        (c.competitors || []).some(p => p.shootoutScore != null || p.penaltyScore != null)
      )) { skipped++; continue; }
      try {
        const startTime = new Date(c.date || c.startDate || (sport === 'tennis' ? undefined : tournament.date)).toISOString();
        // ESPN tennis returns the entire tournament even for one requested day.
        // Team sport date queries use ESPN's US schedule day, which may finish on
        // the next UTC day. Do not lose those games by applying a UTC-day filter.
        if ((sport === 'tennis' && day && startTime.slice(0, 10) !== day) || Date.parse(startTime) > Date.parse(fetchedAt)) { skipped++; continue; }
        if (!Array.isArray(c.competitors) || c.competitors.length !== 2) throw new Error('Mecz wymaga dwóch uczestników');
        const home = c.competitors.find(p => p.homeAway === 'home');
        const away = c.competitors.find(p => p.homeAway === 'away');
        if (!home || !away || home === away) throw new Error('Brak jednoznacznych stron meczu');
        if (sport === 'tennis' && (home.type !== 'athlete' || away.type !== 'athlete')) { skipped++; continue; }
        const scores = sport === 'tennis' ? tennisSets(home, away) : { homeScore: score(home.score), awayScore: score(away.score) };
        const sourceEventId = String(c.id || (sport === 'tennis' ? '' : tournament.id) || '');
        const event = validateEvent({
          id: `${route}:${sourceEventId}`,
          sourceEventId, sport, route, league: route.split('/').at(-1),
          season: String(tournament.season?.year || data.season?.year || startTime.slice(0, 4)),
          startTime,
          resultAvailableAt: new Date(Date.parse(startTime) + 86_400_000).toISOString(),
          availabilityBasis: 'conservative-24h',
          homeId: String(home.id || home.team?.id || home.athlete?.id || ''),
          awayId: String(away.id || away.team?.id || away.athlete?.id || ''),
          home: home.team?.displayName || home.athlete?.displayName || '',
          away: away.team?.displayName || away.athlete?.displayName || '',
          ...scores,
          // Some football responses omit neutrality. Avoid inventing a home
          // advantage: conservatively treat an unknown venue as neutral.
          neutralSite: sport === 'tennis' ? true : typeof c.neutralSite === 'boolean' ? c.neutralSite : true,
          neutralSiteBasis: sport === 'tennis' ? 'not-applicable' : typeof c.neutralSite === 'boolean' ? 'source' : 'unknown-assume-neutral',
          status: 'completed',
          source: { provider: 'ESPN', url, fetchedAt },
        });
        const previous = seen.get(event.id);
        if (previous) {
          if (['homeId', 'awayId', 'homeScore', 'awayScore', 'startTime'].some(field => previous[field] !== event[field])) throw new Error('Sprzeczne duplikaty meczu');
          skipped++;
          continue;
        }
        seen.set(event.id, event);
        events.push(event);
      } catch (error) {
        rejected.push({ id: String(c.id || tournament.id || 'unknown'), reason: error.message });
      }
    }
  }
  return { events, rejected, skipped };
}
