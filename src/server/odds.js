const MINUTE = 60000;
const clean = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null;

/** ESPN's moneyLine values use American odds, never a probability. */
export function americanToDecimal(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[+-]?\d+$/.test(String(value))) return null;
  const american = Number(value);
  if (!Number.isSafeInteger(american) || Math.abs(american) < 100) return null;
  const decimal = american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
  if (!Number.isFinite(decimal) || decimal < 1.01 || decimal > 1000) return null;
  return { american, decimal: Math.round(decimal * 1000000) / 1000000 };
}

function scopeFor(market, sport) {
  const label = clean(market?.displayName) || '';
  if (sport === 'football' && /\b90\s*(?:minutes|minut|min)\b/i.test(label)) return 'regulation_90';
  if (sport === 'nba' && /\b(?:including|incl\.?)\s+overtime\b/i.test(label)) return 'including_overtime';
  if (sport === 'nhl' && /\b(?:including|incl\.?)\s+overtime\b/i.test(label) && /\bshootouts?\b/i.test(label)) return 'including_overtime_shootout';
  return 'unknown';
}

function quoteTime(row, market, observedAt, startTime) {
  const values = [market?.lastUpdated, market?.updatedAt, row.lastUpdated, row.updatedAt].filter(value => value != null);
  if (!values.length) return { quotedAt: null, freshness: 'unverified' };
  const times = values.map(value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/.test(value)) return NaN;
    const normalized = value.length === 17 ? value.replace('Z', ':00.000Z') : value.length === 20 ? value.replace('Z', '.000Z') : value;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === normalized ? timestamp : NaN;
  });
  const time = times[0], observed = Date.parse(observedAt);
  if (times.some(value => !Number.isFinite(value) || value !== time) || time > observed || time >= Date.parse(startTime)) return { quotedAt: null, freshness: 'unverified' };
  return { quotedAt: new Date(time).toISOString(), freshness: observed - time <= 10 * MINUTE ? 'fresh' : 'stale' };
}

function participantMatches(group, id) {
  const supplied = [group?.teamId, group?.team?.id].filter(value => value != null);
  return supplied.length > 0 && supplied.every(value => String(value) === id);
}

/** Read-only observed prices. Unknown settlement rules or quote timestamps are
 * never promoted into a fresh executable quote or an EV calculation.
 */
export function extractOdds(data, fixture, { now = Date.now() } = {}) {
  const current = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(current)) throw new Error('Nieprawidłowy czas pobrania kursów');
  const fetchedAt = new Date(current).toISOString();
  const base = { fixtureId: fixture.id, sport: fixture.sport, route: fixture.route, homeId: fixture.homeId, awayId: fixture.awayId,
    startTime: fixture.startTime, source: 'ESPN — nieoficjalne API', fetchedAt, quotes: [],
    notes: ['Kursy są odczytem informacyjnym ze źródła, nie ofertą zakładu. Dostępność bukmachera i zasady rynku trzeba sprawdzić samodzielnie.',
      'Czas pobrania nie zastępuje czasu aktualizacji kursu. Nie przenosimy tych odczytów automatycznie do dziennika ani obliczeń opłacalności.'] };
  const unavailable = reason => ({ ...base, status: 'unavailable', reason });
  if (!['nba', 'nhl', 'football'].includes(fixture.sport)) return unavailable('Brak obsługi porównywalnych kursów dla tej dyscypliny.');
  const sourceId = fixture.id.slice(fixture.route.length + 1);
  const competitions = data?.header?.competitions;
  if (String(data?.header?.id || '') !== sourceId || !Array.isArray(competitions)) return unavailable('Nie można powiązać kursów z właściwym spotkaniem.');
  const matches = competitions.filter(row => String(row.id) === sourceId);
  if (matches.length !== 1) return unavailable('Źródło nie potwierdza jednoznacznego spotkania.');
  const competition = matches[0], participants = competition.competitors;
  if (!Array.isArray(participants) || participants.length !== 2) return unavailable('Nie można potwierdzić uczestników kursu.');
  const home = participants.find(row => row.homeAway === 'home'), away = participants.find(row => row.homeAway === 'away');
  if (!home || !away || String(home.id) !== fixture.homeId || String(away.id) !== fixture.awayId
    || (home.team?.id != null && String(home.team.id) !== fixture.homeId) || (away.team?.id != null && String(away.team.id) !== fixture.awayId)
    || !Number.isFinite(Date.parse(fixture.startTime)) || Date.parse(competition.date) !== Date.parse(fixture.startTime)) return unavailable('Uczestnicy lub termin źródłowego kursu nie zgadzają się z meczem.');
  const status = competition.status?.type;
  if (status?.state !== 'pre' || status.completed !== false || /CANCEL|POSTPON|DELAY|TBD/i.test(status.name || '') || Date.parse(competition.date) <= current) {
    return { ...base, status: 'closed', reason: 'Kursy przedmeczowe nie są udostępniane dla rozpoczętego, zakończonego lub przełożonego spotkania.' };
  }
  const rows = Array.isArray(data.pickcenter) ? data.pickcenter : [];
  const quotes = [], conflicting = new Set(), seen = new Map();
  for (const row of rows.slice(0, 20)) {
    const provider = clean(row?.provider?.displayName) || clean(row?.provider?.name), market = row?.moneyline;
    if (!provider || !market || !participantMatches(row.homeTeamOdds, fixture.homeId) || !participantMatches(row.awayTeamOdds, fixture.awayId)) continue;
    const scope = scopeFor(market, fixture.sport);
    // A football two-way winner can mean qualification; NHL two-way/three-way
    // prices also differ. Do not infer either market's settlement convention.
    if (fixture.sport === 'football' && scope !== 'regulation_90') continue;
    if (fixture.sport === 'nhl' && scope !== 'including_overtime_shootout') continue;
    const sides = fixture.sport === 'football' ? ['home', 'draw', 'away'] : ['home', 'away'];
    if (fixture.sport !== 'football' && market.draw != null) continue;
    const outcomes = sides.map(side => {
      const price = americanToDecimal(market[side]?.close?.odds);
      if (!price) return null;
      const legacy = side === 'home' ? row.homeTeamOdds?.moneyLine : side === 'away' ? row.awayTeamOdds?.moneyLine : undefined;
      if (legacy != null && americanToDecimal(legacy)?.american !== price.american) return null;
      return { side, name: side === 'home' ? clean(home.team?.displayName) || 'Gospodarze' : side === 'away' ? clean(away.team?.displayName) || 'Goście' : 'Remis', ...price };
    });
    if (outcomes.some(value => !value)) continue;
    const quote = { provider, marketLabel: clean(market.displayName) || 'Moneyline', scope, ...quoteTime(row, market, fetchedAt, fixture.startTime),
      observedAt: fetchedAt, outcomes, readOnly: true, usableForComparison: false };
    const key = `${String(row.provider?.id || provider)}:${scope}`;
    const serialized = JSON.stringify(quote);
    if (seen.has(key)) { if (seen.get(key) !== serialized) conflicting.add(key); continue; }
    seen.set(key, serialized); quotes.push({ key, quote });
  }
  base.quotes = quotes.filter(row => !conflicting.has(row.key)).slice(0, 5).map(row => row.quote);
  return base.quotes.length ? { ...base, status: 'available', reason: 'Źródło udostępniło odczyt kursów. Sprawdź zakres rynku i czas aktualizacji poniżej.' }
    : unavailable('Źródło nie udostępniło pełnego, jednoznacznego rynku dla tego spotkania. Kurs można wpisać ręcznie w dzienniku.');
}
