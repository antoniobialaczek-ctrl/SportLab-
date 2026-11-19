import { americanToDecimal } from './odds.js';

const MINUTE = 60000;
const MAX_AGE = 5 * MINUTE;
// A presentation limit for a source record, not proof that the bookmaker
// changed or reconfirmed its price within this period.
const MAX_SOURCE_RECORD_AGE = 24 * 60 * MINUTE;
const TYPES = {
  nba: new Map([['218', { name: 'Points Milestones', metric: 'PTS' }], ['219', { name: 'Assists Milestones', metric: 'AST' }], ['220', { name: 'Rebounds Milestones', metric: 'REB' }]]),
  nhl: new Map([['231', { name: 'Shots on Goal Milestones', metric: 'S' }]]),
  football: new Map([['266', { name: 'Shots Milestones', metric: 'SH' }]]),
};
const FOOTBALL_ROUTES = new Set(['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1']);
const MAX_QUOTES = 500;
const RULES = Object.freeze({
  kind: 'provider-rules', provider: 'DraftKings', jurisdiction: 'Kansas, US',
  url: 'https://boothillcasino.com/wp-content/uploads/2026/10/KS-DKE-House-Rules-v13.0-EN-CLEAN-9.2.26.pdf',
  checkedAt: '2026-11-19T00:00:00.000Z',
});
const SCOPES = {
  nba: { scope: 'including_overtime', section: 'Basketball — General Basketball Settlement Rules and Player Props Markets, page 47', note: 'Pełny mecz NBA z dogrywką; indywidualne progi punktów, asyst i zbiórek.' },
  nhl: { scope: 'including_overtime_excluding_shootout', section: 'Hockey — Goalscorer and Player Performance Markets, pages 115–116', note: 'Indywidualne strzały na bramkę NHL z dogrywką, bez serii karnych.' },
  football: { scope: 'regulation_90', section: 'Soccer — General Soccer Settlement Rules, page 138', note: 'Indywidualne strzały piłkarza w czasie podstawowym i doliczonym; bez dogrywki i serii karnych.' },
};
const numericId = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const instant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10) ? time : NaN;
};
function corePath(value) {
  try {
    const url = new URL(value?.$ref);
    return ['https:', 'http:'].includes(url.protocol) && url.hostname === 'sports.core.api.espn.com'
      && !url.port && !url.username && !url.password && !url.hash ? url.pathname : null;
  } catch { return null; }
}
function fixtureIdentity(summary, fixture, now) {
  if (!TYPES[fixture?.sport] || !(fixture.sport === 'nba' && fixture.route === 'basketball/nba' || fixture.sport === 'nhl' && fixture.route === 'hockey/nhl' || fixture.sport === 'football' && FOOTBALL_ROUTES.has(fixture.route)) || !numericId(fixture.homeId) || !numericId(fixture.awayId)
    || fixture.homeId === fixture.awayId || typeof fixture.id !== 'string') return null;
  const id = fixture.id.slice(fixture.route.length + 1);
  if (fixture.id !== `${fixture.route}:${id}` || !numericId(id) || String(summary?.header?.id || '') !== id) return null;
  const rows = summary.header.competitions;
  if (!Array.isArray(rows) || rows.filter(row => String(row?.id || '') === id).length !== 1) return null;
  const competition = rows.find(row => String(row?.id || '') === id), start = instant(fixture.startTime);
  if (!Number.isFinite(start) || instant(competition.date) !== start || !Array.isArray(competition.competitors) || competition.competitors.length !== 2) return null;
  for (const [side, wanted] of [['home', fixture.homeId], ['away', fixture.awayId]]) {
    const matches = competition.competitors.filter(row => row?.homeAway === side);
    if (matches.length !== 1 || String(matches[0].id) !== wanted || String(matches[0].team?.id || '') !== wanted) return null;
  }
  const status = competition.status?.type;
  const closed = start <= now || status?.state !== 'pre' || status.completed !== false || /CANCEL|POSTPON|DELAY|TBD/i.test(status.name || '');
  const providers = (Array.isArray(summary.pickcenter) ? summary.pickcenter : []).filter(row => String(row?.provider?.id || '') === '100');
  const provider = providers.length > 0 && providers.every(row => (row.provider.displayName || row.provider.name) === 'DraftKings'
    && row.header?.text === 'Game Odds' && row.period == null);
  const [sport, league] = fixture.route.split('/');
  return { id, start, closed, provider, season: summary.header.season?.year, core: `/v2/sports/${sport}/leagues/${league}` };
}
function rosterMembership(rosters, fixture, season) {
  if (!Array.isArray(rosters) || rosters.length !== 2) return null;
  const map = new Map(), conflicts = new Set();
  for (const teamId of [fixture.homeId, fixture.awayId]) {
    const matches = rosters.filter(roster => String(roster?.team?.id || '') === teamId);
    if (matches.length !== 1 || !Array.isArray(matches[0].athletes) || matches[0].athletes.length > 100
      || season != null && matches[0].season?.year !== season) return null;
    const athletes = matches[0].athletes.flatMap(row => Array.isArray(row?.items) ? row.items : [row]);
    if (athletes.length > 100) return null;
    for (const athlete of athletes) {
      const id = String(athlete?.id || '');
      if (!numericId(id)) continue;
      if (athlete.team?.id != null && String(athlete.team.id) !== teamId) { conflicts.add(id); continue; }
      if (map.has(id) && map.get(id) !== teamId) conflicts.add(id); else map.set(id, teamId);
    }
  }
  for (const id of conflicts) map.delete(id);
  return map;
}

/** ESPN's unordered Total Points/Assists/Rebounds pairs have no direction
 * field. Their order never identifies over/under. Only an explicit N+
 * milestone can establish a one-sided price for the equivalent over N-0.5.
 */
export function extractPlayerOdds({ summary, props, rosters } = {}, fixture, { now = Date.now() } = {}) {
  const current = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(current)) throw new Error('Nieprawidłowy czas odczytu kursów zawodników');
  const fetchedAt = new Date(current).toISOString(), identity = fixtureIdentity(summary, fixture, current);
  const base = { fixtureId: fixture?.id, sport: fixture?.sport, route: fixture?.route, homeId: fixture?.homeId, awayId: fixture?.awayId,
    startTime: fixture?.startTime, source: 'ESPN core — nieoficjalne API', fetchedAt, maxQuotes: MAX_QUOTES, truncated: false, maxSourceRecordAgeMs: MAX_SOURCE_RECORD_AGE,
    observationValidUntil: new Date(Math.min(current + MAX_AGE, identity?.start ?? current)).toISOString(), maxObservationAgeMs: MAX_AGE,
    quotes: [], unavailableMarkets: [], notes: ['Ceny informacyjne. Rynek N+ oznacza co najmniej N w danej statystyce, czyli powyżej N−0,5. Nie wyznaczamy prawdopodobieństw ani opłacalności z samych kursów.',
      'Czas aktualizacji rekordu ESPN nie jest niezależnym potwierdzeniem czasu zmiany ceny u bukmachera. Zasady udziału zawodnika i bieżącą ofertę trzeba sprawdzić.'] };
  const unavailable = reason => ({ ...base, status: 'unavailable', reason, unavailableMarkets: [{ market: 'player_prop', reason }] });
  if (!identity) return unavailable('Nie można potwierdzić dokładnego meczu i jego uczestników.');
  if (identity.closed) return { ...base, status: 'closed', reason: 'Ceny przedmeczowe są ukryte dla rozpoczętych, zakończonych lub przełożonych spotkań.' };
  if (!identity.provider || current < Date.parse(RULES.checkedAt) || current - Date.parse(RULES.checkedAt) > 30 * 86400000) return unavailable('Brak aktualnie sprawdzonej tożsamości dostawcy lub zasad rozliczenia rynku.');
  if (!props || !Array.isArray(props.items) || !Number.isInteger(props.count) || props.count < 0 || props.count > 3000
    || props.items.length !== props.count || props.pageIndex !== 1 || props.pageCount !== 1) return unavailable('Źródło nie zwróciło pełnego zestawu kursów zawodników.');
  const membership = rosterMembership(rosters, fixture, identity.season);
  if (!membership) return unavailable('Źródło nie potwierdza bieżącej przynależności zawodników do obu drużyn.');
  const seen = new Map(), rejected = new Set();
  for (const row of props.items) {
    const definition = TYPES[fixture.sport].get(String(row?.type?.id || ''));
    if (!definition || row.type.name !== definition.name || row.period != null) continue;
    if (corePath(row.competition) !== `${identity.core}/events/${identity.id}/competitions/${identity.id}`
      || corePath(row.provider) !== `${identity.core}/casinos/100`) continue;
    const athletePath = corePath(row.athlete), athlete = new RegExp(`^${identity.core.replaceAll('.', '\\.')}\\/(?:seasons\\/(\\d{4})\\/)?athletes\\/(\\d{1,14})$`).exec(athletePath || '');
    if (!athlete || athlete[1] && identity.season != null && Number(athlete[1]) !== identity.season) continue;
    const playerId = athlete[2], teamId = membership.get(playerId);
    if (!teamId || row.team && !new RegExp(`^${identity.core.replaceAll('.', '\\.')}\/(?:seasons/\\d{4}/)?teams/${teamId}$`).test(corePath(row.team) || '')) continue;
    const target = row.current?.target, threshold = target?.value;
    if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 1000 || target.displayValue !== `${threshold}+`
      || row.odds?.total?.value != null && row.odds.total.value !== `${threshold}+`) continue;
    const line = threshold - 0.5, key = `${playerId}:${teamId}:${definition.metric}:${line}`;
    const price = americanToDecimal(row.current?.over?.american ?? row.odds?.american?.value), recordUpdated = instant(row.lastUpdated);
    const rawDecimal = row.current?.over?.decimal ?? row.odds?.decimal?.value;
    const sourceDecimal = (typeof rawDecimal === 'number' || typeof rawDecimal === 'string') && /^\d+(?:\.\d{1,2})?$/.test(String(rawDecimal)) ? Number(rawDecimal) : NaN;
    if (!price || !Number.isFinite(sourceDecimal) || Math.abs(sourceDecimal - price.decimal) > 0.011
      || !Number.isFinite(recordUpdated) || recordUpdated > current || recordUpdated >= identity.start || current - recordUpdated > MAX_SOURCE_RECORD_AGE) { rejected.add(key); continue; }
    const quote = { provider: 'DraftKings', providerId: '100', market: 'player_prop', marketLabel: definition.name,
      playerId, teamId, metric: definition.metric, line, quoteKind: 'milestone', threshold,
      scope: SCOPES[fixture.sport].scope, scopeBasis: { ...RULES, section: SCOPES[fixture.sport].section, note: `${SCOPES[fixture.sport].note} Sprawdź zasady udziału zawodnika i lokalną dostępność oferty.` },
      quotedAt: null, freshness: 'unverified', sourceRecordUpdatedAt: new Date(recordUpdated).toISOString(),
      timestampBasis: 'source-record-lastUpdated', maxSourceRecordAgeMs: MAX_SOURCE_RECORD_AGE, observedAt: fetchedAt,
      observationValidUntil: new Date(Math.min(current + MAX_AGE, identity.start)).toISOString(), maxObservationAgeMs: MAX_AGE,
      outcomes: [{ side: 'over', direction: 'over', line, threshold, playerId, teamId, metric: definition.metric,
        name: `Co najmniej ${threshold}`, ...price }], readOnly: true, usableForComparison: false };
    const previous = seen.get(key);
    if (previous && (previous.outcomes[0].american !== price.american || previous.sourceRecordUpdatedAt !== quote.sourceRecordUpdatedAt)) rejected.add(key);
    else seen.set(key, quote);
  }
  const verified = [...seen.entries()].filter(([key]) => !rejected.has(key)).map(([, quote]) => quote);
  base.quotes = verified.slice(0, MAX_QUOTES); base.truncated = verified.length > MAX_QUOTES;
  return base.quotes.length ? { ...base, status: 'available', reason: 'Jednoznaczne odczyty kursów na indywidualne progi zawodników.' }
    : unavailable('Brak jednoznacznych cen N+ z poprawnym czasem aktualizacji, linią i przynależnością zawodnika.');
}

async function readSource(url, fetchImpl) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['sports.core.api.espn.com', 'site.api.espn.com'].includes(parsed.hostname)
    || parsed.port || parsed.username || parsed.password || parsed.hash) throw new Error('Niedozwolony adres źródła kursów');
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(3500) });
  if (!response.ok) throw new Error('Nie udało się pobrać kursów zawodników');
  const body = await response.text();
  if (body.length > 2000000) throw new Error('Odpowiedź źródła przekracza limit');
  return JSON.parse(body);
}

/** Usually three bounded public reads: the prop collection and two current
 * rosters. The already-read summary proves fixture/provider identity first.
 * Network failures leave other match analysis available to the caller.
 */
export async function fetchPlayerOdds(summary, fixture, { now, clock = Date.now, fetchImpl = globalThis.fetch } = {}) {
  const observed = () => now == null ? clock() : typeof now === 'number' ? now : Date.parse(now);
  const identity = fixtureIdentity(summary, fixture, observed());
  if (!identity || identity.closed || !identity.provider) return extractPlayerOdds({ summary }, fixture, { now: observed() });
  try {
    const url = `https://sports.core.api.espn.com${identity.core}/events/${identity.id}/competitions/${identity.id}/odds/100/propBets?limit=1000`;
    const first = await readSource(url, fetchImpl);
    if (!Array.isArray(first.items) || first.pageIndex !== 1 || !Number.isInteger(first.pageCount) || first.pageCount < 1 || first.pageCount > 3 || first.count > 3000) throw new Error('Niepełna kolekcja źródłowa');
    const pages = await Promise.all(Array.from({ length: first.pageCount - 1 }, (_, i) => readSource(`${url}&page=${i + 2}`, fetchImpl)));
    if (pages.some((page, index) => !Array.isArray(page.items) || page.pageIndex !== index + 2 || page.pageCount !== first.pageCount || page.count !== first.count || page.pageSize !== first.pageSize)) throw new Error('Sprzeczna paginacja źródła');
    const props = { count: first.count, pageIndex: 1, pageCount: 1, items: [first, ...pages].flatMap(page => page.items) };
    const rosters = await Promise.all([fixture.homeId, fixture.awayId].map(id => readSource(`https://site.api.espn.com/apis/site/v2/sports/${fixture.route}/teams/${id}/roster`, fetchImpl)));
    return extractPlayerOdds({ summary, props, rosters }, fixture, { now: observed() });
  } catch {
    const result = extractPlayerOdds({ summary }, fixture, { now: observed() });
    return { ...result, reason: 'Kursy zawodników są chwilowo niedostępne w źródle.', unavailableMarkets: [{ market: 'player_prop', reason: 'Nie udało się potwierdzić pełnych danych kursów i składów źródłowych.' }] };
  }
}
