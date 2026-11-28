const MINUTE = 60000;
const OBSERVATION_MAX_AGE = 5 * MINUTE;
const DRAFTKINGS_RULES = Object.freeze({
  kind: 'provider-rules', provider: 'DraftKings', jurisdiction: 'Kansas, US',
  url: 'https://boothillcasino.com/wp-content/uploads/2026/10/KS-DKE-House-Rules-v13.0-EN-CLEAN-9.2.26.pdf',
  section: 'Basketball — General Basketball Settlement Rules, page 47',
  checkedAt: '2026-11-18T00:00:00.000Z',
  note: 'Zasady pełnego meczu koszykówki tego dostawcy. Nie potwierdzają dostępności oferty w innym kraju ani indywidualnych wyjątków kuponu.',
});
const DRAFTKINGS_FOOTBALL_RULES = Object.freeze({
  kind: 'provider-rules', provider: 'DraftKings', jurisdiction: 'US',
  url: 'https://support.draftkings.com/dk/en-us/how-are-soccer-bets-settled?id=kb_article_view&sysparm_article=KB0010834',
  section: '3-Way Moneyline and Over / Under', checkedAt: '2026-11-25T13:35:31.744Z',
  note: 'Standardowe rynki dotyczą 90 minut z doliczonym czasem, bez dogrywki i karnych. Indywidualne wyjątki oferty wymagają sprawdzenia.',
});
const DRAFTKINGS_NHL_RULES = Object.freeze({
  kind: 'provider-rules', provider: 'DraftKings', jurisdiction: 'Kansas, US',
  url: 'https://boothillcasino.com/wp-content/uploads/2026/10/KS-DKE-House-Rules-v13.0-EN-CLEAN-9.2.26.pdf',
  section: 'Hockey — General Hockey Settlement Rules, page 115', checkedAt: '2026-11-28T00:10:16.000Z',
  note: 'Standardowe rynki NHL obejmują dogrywkę i karne. Rozstrzygnięcie karnymi dodaje jeden gol zwycięzcy i sumie meczu. Wyjątki rynku wymagają odrębnego sprawdzenia.',
});
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
  if (sport === 'football' && /\b(?:including|incl\.?|with)\s+(?:extra\s*time|overtime|penalt|shootout)|qualif|to\s+advance|win\s+cup/i.test(label)) return 'unknown';
  if (sport === 'football' && /\b90\s*(?:minutes|minut|min)\b/i.test(label)) return 'regulation_90';
  if (sport === 'nba' && /\b(?:including|incl\.?)\s+overtime\b/i.test(label)) return 'including_overtime';
  if (sport === 'nhl' && /\b(?:excluding|excl\.?|without)\s+(?:the\s+)?(?:shootouts?|overtime|OT)\b|\bregulation\b|\b60\s*(?:minutes?|mins?)\b/i.test(label)) return 'unknown';
  if (sport === 'nhl' && /\b(?:including|incl\.?)\s+overtime\b/i.test(label) && /\bshootouts?\b/i.test(label)) return 'including_overtime_shootout';
  return 'unknown';
}

function marketScope(market, row, fixture, kind, now) {
  const explicit = scopeFor(market, fixture.sport);
  if (explicit !== 'unknown') return { scope: explicit, scopeBasis: { kind: 'source-market-label', label: clean(market.displayName) } };
  const name = clean(row.provider?.displayName) || clean(row.provider?.name);
  const expectedLabel = kind === 'winner' ? 'moneyline' : 'total';
  if (fixture.sport === 'football' && /^soccer\//.test(fixture.route) && String(row.provider?.id) === '100'
    && name?.toLowerCase() === 'draftkings' && clean(row.header?.text)?.toLowerCase() === 'game odds'
    && clean(market.displayName)?.toLowerCase() === expectedLabel && market.period == null && row.period == null
    && now >= Date.parse(DRAFTKINGS_FOOTBALL_RULES.checkedAt) && now - Date.parse(DRAFTKINGS_FOOTBALL_RULES.checkedAt) <= 30 * 86400000) {
    return { scope: 'regulation_90', scopeBasis: { ...DRAFTKINGS_FOOTBALL_RULES } };
  }
  if (fixture.sport === 'nhl' && fixture.route === 'hockey/nhl' && String(row.provider?.id) === '100'
    && name?.toLowerCase() === 'draftkings' && clean(row.header?.text)?.toLowerCase() === 'game odds'
    && clean(market.displayName)?.toLowerCase() === expectedLabel && market.period == null && row.period == null
    && now >= Date.parse(DRAFTKINGS_NHL_RULES.checkedAt) && now - Date.parse(DRAFTKINGS_NHL_RULES.checkedAt) <= 30 * 86400000) {
    return { scope: 'including_overtime_shootout', scopeBasis: { ...DRAFTKINGS_NHL_RULES } };
  }
  // The documented default is bound to this provider and its full-game ESPN
  // market, not inferred merely from the league. Period and special markets
  // are deliberately excluded, as are rules that have not been rechecked.
  if (fixture.sport === 'nba' && fixture.route === 'basketball/nba' && String(row.provider?.id) === '100'
    && name?.toLowerCase() === 'draftkings' && clean(row.header?.text)?.toLowerCase() === 'game odds'
    && clean(market.displayName)?.toLowerCase() === expectedLabel && market.period == null && row.period == null
    && now >= Date.parse(DRAFTKINGS_RULES.checkedAt) && now - Date.parse(DRAFTKINGS_RULES.checkedAt) <= 30 * 86400000) {
    return { scope: 'including_overtime', scopeBasis: { ...DRAFTKINGS_RULES } };
  }
  return { scope: 'unknown', scopeBasis: { kind: 'unverified', reason: 'Brak jednoznacznej informacji o zasadach rozliczenia tego rynku.' } };
}

function halfPointLine(value, direction) {
  if (typeof value === 'string') {
    const match = /^([ou])?(\d+\.5)$/i.exec(value);
    if (!match || (match[1] && match[1].toLowerCase() !== direction[0])) return null;
    value = Number(match[2]);
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000 && value % 1 === 0.5 ? value : null;
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

function selectionMatches(value, sourceId, side, fixture) {
  const tags = value?.link?.tracking?.tags;
  if (!tags) return true;
  return (tags.gameId == null || String(tags.gameId) === sourceId)
    && (tags.betSide == null || tags.betSide === side)
    && (tags.league == null || tags.league === fixture.route.split('/').at(-1));
}

/** Read-only observed prices. Unknown settlement rules or quote timestamps are
 * never promoted into a fresh executable quote or an EV calculation.
 */
export function extractOdds(data, fixture, { now = Date.now() } = {}) {
  const current = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(current)) throw new Error('Nieprawidłowy czas pobrania kursów');
  const fetchedAt = new Date(current).toISOString();
  const start = Date.parse(fixture.startTime);
  const observationValidUntil = new Date(Number.isFinite(start) ? Math.min(current + OBSERVATION_MAX_AGE, start) : current).toISOString();
  const base = { fixtureId: fixture.id, sport: fixture.sport, route: fixture.route, homeId: fixture.homeId, awayId: fixture.awayId,
    startTime: fixture.startTime, source: 'ESPN — nieoficjalne API', fetchedAt, observationValidUntil, maxObservationAgeMs: OBSERVATION_MAX_AGE, quotes: [],
    unavailableMarkets: [{ market: 'player_prop', reason: 'Ten odczyt ESPN nie dostarcza zweryfikowanego rynku zawodnika z ID, statystyką, linią i ceną. Nie zastępujemy go kursem rynku meczowego.' }],
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
  function addQuote(row, market, provider, kind, outcomes, line) {
    const quote = { provider, providerId: String(row.provider?.id || ''), market: kind, line,
      marketLabel: clean(market.displayName) || (kind === 'winner' ? 'Moneyline' : 'Total'), ...marketScope(market, row, fixture, kind, current),
      ...quoteTime(row, market, fetchedAt, fixture.startTime), observedAt: fetchedAt, observationValidUntil,
      maxObservationAgeMs: OBSERVATION_MAX_AGE, outcomes, readOnly: true, usableForComparison: false };
    const key = `${String(row.provider?.id || provider)}:${kind}:${quote.scope}`;
    const serialized = JSON.stringify(quote);
    if (seen.has(key)) { if (seen.get(key) !== serialized) conflicting.add(key); return; }
    seen.set(key, serialized); quotes.push({ key, quote });
  }
  for (const row of rows.slice(0, 20)) {
    const provider = clean(row?.provider?.displayName) || clean(row?.provider?.name);
    if (!provider || !participantMatches(row.homeTeamOdds, fixture.homeId) || !participantMatches(row.awayTeamOdds, fixture.awayId)) continue;
    const market = row?.moneyline;
    const scope = market ? marketScope(market, row, fixture, 'winner', current).scope : 'unknown';
    // A football two-way winner can mean qualification; NHL two-way/three-way
    // prices also differ. Do not infer either market's settlement convention.
    const winnerAllowed = market && market.period == null && row.period == null
      && !/quarter|half|\bq[1-4]\b|\b[1-4]q\b|period|player|team\s+total|\b[1-4](?:st|nd|rd|th)\b/i.test(clean(market.displayName) || '')
      && (fixture.sport !== 'football' || scope === 'regulation_90')
      && (fixture.sport !== 'nhl' || scope === 'including_overtime_shootout');
    const sides = fixture.sport === 'football' ? ['home', 'draw', 'away'] : ['home', 'away'];
    const outcomes = !winnerAllowed || (fixture.sport !== 'football' && market.draw != null) ? [] : sides.map(side => {
      const close = market[side]?.close;
      if (!selectionMatches(close, sourceId, side, fixture)) return null;
      const price = americanToDecimal(close?.odds);
      if (!price) return null;
      const legacy = side === 'home' ? row.homeTeamOdds?.moneyLine : side === 'away' ? row.awayTeamOdds?.moneyLine : undefined;
      if (legacy != null && americanToDecimal(legacy)?.american !== price.american) return null;
      return { side, name: side === 'home' ? clean(home.team?.displayName) || 'Gospodarze' : side === 'away' ? clean(away.team?.displayName) || 'Goście' : 'Remis', ...price };
    });
    if (outcomes.length && outcomes.every(Boolean)) addQuote(row, market, provider, 'winner', outcomes, null);

    // Full-game totals must have two actual prices at the exact same
    // half-point line. Opening lines and spread prices never fill gaps.
    const total = row?.total;
    const totalLabel = clean(total?.displayName) || '';
    const allowedTotal = fixture.sport === 'nba' ? /^total(?:\s*\(including overtime\))?$/i.test(totalLabel)
      : ((fixture.sport === 'nhl' && /^total\b/i.test(totalLabel) && total && marketScope(total, row, fixture, 'total_goals', current).scope === 'including_overtime_shootout' && !/\b(?:shots?|saves?|assists?|points?|penalt(?:y|ies))\b/i.test(totalLabel))
        || (fixture.sport === 'football' && /^total(?:\s+goals)?\b/i.test(totalLabel) && total && marketScope(total, row, fixture, 'total_goals', current).scope === 'regulation_90'))
        && !/quarter|half|period|player|team\s+total|corner|card|\b[1-4](?:st|nd|rd|th)\b/i.test(totalLabel);
    if (!allowedTotal || !total
      || total.period != null || row.period != null) continue;
    const over = total.over?.close, under = total.under?.close;
    const line = halfPointLine(over?.line, 'over'), underLine = halfPointLine(under?.line, 'under');
    if (line === null || line !== underLine || fixture.sport === 'nhl' && line > 25.5 || fixture.sport === 'football' && line > 15.5 || (row.overUnder != null && halfPointLine(row.overUnder, 'over') !== line)) continue;
    const totalOutcomes = [['over', over, row.overOdds], ['under', under, row.underOdds]].map(([direction, value, legacy]) => {
      if (!selectionMatches(value, sourceId, direction, fixture)) return null;
      const price = americanToDecimal(value?.odds);
      if (!price || (legacy != null && americanToDecimal(legacy)?.american !== price.american)) return null;
      return { side: direction, direction, line, name: direction === 'over' ? 'Powyżej' : 'Poniżej', ...price };
    });
    if (totalOutcomes.every(Boolean)) addQuote(row, total, provider, fixture.sport === 'nba' ? 'total_points' : 'total_goals', totalOutcomes, line);
  }
  base.quotes = quotes.filter(row => !conflicting.has(row.key)).slice(0, 10).map(row => row.quote);
  for (const market of ['winner', fixture.sport === 'nba' ? 'total_points' : 'total_goals']) if (!base.quotes.some(quote => quote.market === market)) base.unavailableMarkets.push({ market, reason: 'Źródło nie dostarcza pełnej, jednoznacznej ceny dla tego rynku.' });
  return base.quotes.length ? { ...base, status: 'available', reason: 'Źródło udostępniło odczyt kursów. Sprawdź zakres rynku i czas aktualizacji poniżej.' }
    : unavailable('Źródło nie udostępniło pełnego, jednoznacznego rynku dla tego spotkania. Kurs można wpisać ręcznie w dzienniku.');
}
