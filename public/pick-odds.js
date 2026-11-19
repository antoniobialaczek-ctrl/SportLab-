import { escapeHTML as esc } from './analysis-view.js';

const MINUTE = 60000;
const MAX_OBSERVATION_AGE = 5 * MINUTE;
const SCOPES = new Set(['including_overtime', 'including_overtime_shootout', 'including_overtime_excluding_shootout', 'regulation_90']);
const ROUTES = { nba: ['basketball/nba'], nhl: ['hockey/nhl'], football: ['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1'] };
const METRICS = { nba: new Set(['PTS', 'AST', 'REB']), nhl: new Set(['S', 'G', 'A']), football: new Set(['SH', 'G', 'A']) };
const text = (value, maximum = 120) => typeof value === 'string' && value.trim() && value.length <= maximum ? value.trim() : null;
const numericId = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const decimal = value => typeof value === 'number' && Number.isFinite(value) && value >= 1.01 && value <= 1000;
const line = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000;
const stamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value.slice(0, 10) ? parsed : NaN;
};
const iso = value => new Date(value).toISOString();
const unavailable = (reason, status = 'unavailable') => ({ status, decimal: null, provider: null, quotedAt: null, observedAt: null, freshness: null, source: null, reason, readOnly: true, usableForComparison: false });

function selectionFor(pick, event, options) {
  if (!pick || typeof pick !== 'object' || Array.isArray(pick)) return null;
  const kind = pick.kind || (pick.playerId && pick.metric ? 'player' : null);
  if (!SCOPES.has(pick.scope)) return null;
  if (kind === 'result') {
    if (pick.market === 'winner' && ['home', 'away', ...(event.sport === 'football' ? ['draw'] : [])].includes(pick.side)) {
      return { market: 'winner', selection: pick.side, scope: pick.scope, line: null };
    }
    const doubleChance = { '1X': 'home_draw', X2: 'draw_away', '12': 'home_away' }[pick.market];
    if (event.sport === 'football' && doubleChance && pick.scope === 'regulation_90') return { market: 'double_chance_90', selection: doubleChance, scope: pick.scope, line: null };
    return null;
  }
  if (kind === 'total' && pick.market === 'total_points' && event.sport === 'nba' && ['over', 'under'].includes(pick.direction) && line(pick.line)) {
    return { market: 'total_points', selection: pick.direction, scope: pick.scope, line: pick.line };
  }
  if (kind === 'player' && (pick.market == null || pick.market === 'player_prop') && METRICS[event.sport]?.has(pick.metric)
    && numericId(pick.playerId) && ['over', 'under'].includes(pick.direction) && line(pick.line)) {
    const teamId = pick.teamId ?? options.teamId;
    if (!numericId(teamId) || ![event.homeId, event.awayId].includes(teamId) || pick.teamId != null && options.teamId != null && pick.teamId !== options.teamId) return null;
    return { market: 'player_prop', selection: pick.direction, scope: pick.scope, line: pick.line, playerId: pick.playerId, teamId, metric: pick.metric };
  }
  return null;
}

function matchesMarket(quote, wanted) {
  if (!quote || quote.market !== wanted.market || quote.scope !== wanted.scope) return false;
  if (wanted.line === null ? quote.line != null : quote.line !== wanted.line) return false;
  if (wanted.market === 'player_prop' && (quote.playerId !== wanted.playerId || quote.teamId !== wanted.teamId || quote.metric !== wanted.metric)) return false;
  return true;
}

function quoteTiming(quote, data, current, start, observed) {
  const quoted = quote.quotedAt == null ? null : stamp(quote.quotedAt);
  if (quoted !== null && (!Number.isFinite(quoted) || quoted > observed || quoted >= start || current - quoted > 10 * MINUTE)) return null;
  if (quote.freshness === 'stale') return null;
  for (const validUntil of [data.observationValidUntil, quote.observationValidUntil]) {
    if (validUntil == null) continue;
    const until = stamp(validUntil);
    if (!Number.isFinite(until) || until < current || until > start || until > observed + MAX_OBSERVATION_AGE) return null;
  }
  const ownLimit = quote.maxObservationAgeMs ?? data.maxObservationAgeMs;
  if (ownLimit != null && (!Number.isFinite(ownLimit) || ownLimit <= 0 || ownLimit > MAX_OBSERVATION_AGE || current - observed > ownLimit)) return null;
  return { quotedAt: quoted === null ? null : iso(quoted), freshness: quoted === null ? 'unverified' : 'fresh' };
}

function outcomesFor(quote, wanted, event) {
  if (!Array.isArray(quote.outcomes) || quote.outcomes.length < 2 || quote.outcomes.length > 6) return null;
  const allowed = wanted.market === 'winner' ? ['home', 'away', ...(event.sport === 'football' ? ['draw'] : [])]
    : wanted.market === 'double_chance_90' ? ['home_draw', 'home_away', 'draw_away'] : ['over', 'under'];
  const values = new Map();
  for (const outcome of quote.outcomes) {
    if (!outcome || !decimal(outcome.decimal)) return null;
    const selection = wanted.market === 'winner' || wanted.market === 'double_chance_90' ? outcome.side : outcome.direction ?? outcome.side;
    if (!allowed.includes(selection) || outcome.direction != null && outcome.side != null && outcome.direction !== outcome.side
      || outcome.line != null && outcome.line !== wanted.line) return null;
    if (wanted.market === 'player_prop' && (outcome.playerId != null && outcome.playerId !== wanted.playerId
      || outcome.teamId != null && outcome.teamId !== wanted.teamId || outcome.metric != null && outcome.metric !== wanted.metric)) return null;
    if (values.has(selection) && values.get(selection) !== outcome.decimal) return null;
    values.set(selection, outcome.decimal);
  }
  if (allowed.some(selection => !values.has(selection))) return null;
  return values;
}

/** A price belongs to exactly one observed market. Historical hit counts,
 * nearby lines and quotes for another selection never substitute for a price.
 */
export function matchPickQuote(data, event, pick, options = {}) {
  const current = typeof options.now === 'number' ? options.now : options.now == null ? Date.now() : Date.parse(options.now);
  const start = stamp(event?.date ?? event?.startTime);
  if (!Number.isFinite(current) || !Number.isFinite(start)) return unavailable('Nie można potwierdzić terminu kursu.');
  if (event.state !== 'pre' || start <= current || data?.status === 'closed') return unavailable('Kurs przedmeczowy jest niedostępny po rozpoczęciu spotkania.', 'closed');
  if (!ROUTES[event.sport]?.includes(event.route) || typeof event.id !== 'string' || !event.id.startsWith(`${event.route}:`)
    || !/^\d{4,14}$/.test(event.id.slice(event.route.length + 1)) || !numericId(event.homeId) || !numericId(event.awayId) || event.homeId === event.awayId
    || event.date != null && event.startTime != null && stamp(event.date) !== stamp(event.startTime)) return unavailable('Nie można potwierdzić uczestników i ligi kursu.');
  const fetched = stamp(data?.fetchedAt);
  if (!data || data.status !== 'available' || data.fixtureId !== event.id || data.sport !== event.sport || data.route !== event.route
    || data.homeId !== event.homeId || data.awayId !== event.awayId || stamp(data.startTime) !== start
    || !Number.isFinite(fetched) || fetched > current + MINUTE || fetched >= start || current - fetched > MAX_OBSERVATION_AGE
    || !Array.isArray(data.quotes)) return unavailable('Brak świeżego odczytu dla dokładnie tego spotkania.');
  const wanted = selectionFor(pick, event, options);
  if (!wanted) return unavailable('Brak jednoznacznego rynku, wyboru lub zakresu rozliczenia tego typu.');
  const groups = new Map(), rejected = new Set();
  for (const quote of data.quotes.slice(0, 100)) {
    if (!matchesMarket(quote, wanted)) continue;
    const provider = text(quote.provider), providerId = text(quote.providerId, 80);
    if (!provider) continue;
    const key = (providerId || provider).toLocaleLowerCase('en-US');
    const observed = stamp(quote.observedAt);
    const values = outcomesFor(quote, wanted, event);
    const timing = Number.isFinite(observed) && observed <= current + MINUTE && observed <= fetched + MINUTE
      && observed < start && current - observed <= MAX_OBSERVATION_AGE ? quoteTiming(quote, data, current, start, observed) : null;
    if (!values || !timing || !values.has(wanted.selection)) { rejected.add(key); continue; }
    const signature = JSON.stringify([...values].sort(([a], [b]) => a.localeCompare(b)));
    const previous = groups.get(key);
    if (previous && previous.signature !== signature) { rejected.add(key); continue; }
    const candidate = { status: 'matched', decimal: values.get(wanted.selection), provider, providerId,
      ...timing, observedAt: iso(observed), source: text(data.source, 200), reason: null, readOnly: true, usableForComparison: false,
      market: wanted.market, selection: wanted.selection, line: wanted.line, scope: wanted.scope,
      scopeBasis: quote.scopeBasis || null, fixtureId: event.id, signature };
    if (!previous || observed > Date.parse(previous.observedAt) || candidate.freshness === 'fresh' && previous.freshness !== 'fresh') groups.set(key, candidate);
  }
  const matches = [...groups.entries()].filter(([key]) => !rejected.has(key)).map(([, value]) => value)
    .sort((a, b) => Number(b.freshness === 'fresh') - Number(a.freshness === 'fresh')
      || (Date.parse(b.quotedAt || b.observedAt) - Date.parse(a.quotedAt || a.observedAt))
      || b.observedAt.localeCompare(a.observedAt) || a.provider.localeCompare(b.provider, 'pl'));
  if (!matches.length) return unavailable('Źródło nie podało kursu dla tego samego rynku, wyboru, linii i zasad rozliczenia.');
  const { signature, ...matched } = matches[0];
  return matched;
}

function pickDescriptor(pick, options) {
  const descriptor = {};
  const limits = { kind: 12, market: 40, side: 20, direction: 10, scope: 40, playerId: 14, metric: 12, teamId: 14 };
  for (const [key, maximum] of Object.entries(limits)) if (typeof pick?.[key] === 'string' && pick[key].length <= maximum) descriptor[key] = pick[key];
  if (descriptor.kind == null && descriptor.playerId && descriptor.metric) descriptor.kind = 'player';
  if (descriptor.teamId == null && numericId(options.teamId)) descriptor.teamId = options.teamId;
  if (typeof pick?.line === 'number' && Number.isFinite(pick.line)) descriptor.line = pick.line;
  return descriptor;
}

const displayedTime = value => value ? new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'niepodana';
const scopeLabel = { including_overtime: 'z dogrywką', including_overtime_shootout: 'z dogrywką i karnymi', regulation_90: '90 minut', including_overtime_excluding_shootout: 'z dogrywką, bez karnych' };
function contentHTML(result) {
  if (result.status !== 'matched') return `<span class="pick-odds-unavailable" title="${esc(result.reason)}">Kurs niedostępny</span>`;
  const title = `Odczyt: ${displayedTime(result.observedAt)}. Aktualizacja w źródle: ${displayedTime(result.quotedAt)}. ${result.freshness === 'unverified' ? 'Świeżość kursu niepotwierdzona. ' : ''}Zakres: ${scopeLabel[result.scope]}. Dane informacyjne — sprawdź ofertę.`;
  return `<strong class="pick-odds-value" title="${esc(title)}">Kurs ${result.decimal.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><small class="pick-odds-source" title="${esc(title)}">${esc(result.provider)} · odczyt</small>`;
}

export function pickOddsContentHTML(data, event, pick, options = {}) {
  return contentHTML(matchPickQuote(data, event, pick, options));
}

export function pickOddsHTML(data, event, pick, options = {}) {
  const result = matchPickQuote(data, event, pick, options);
  const eventId = typeof event?.id === 'string' && event.id.length <= 100 ? event.id : '';
  return `<span class="pick-odds pick-odds-${result.status}" data-pick-odds data-odds-event="${esc(eventId)}" data-odds-pick="${esc(JSON.stringify(pickDescriptor(pick, options)))}" data-odds-status="${result.status}">${contentHTML(result)}</span>`;
}
