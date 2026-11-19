export const JOURNAL_VERSION = 2;
export const MAX_RECORDS = 500;
const MINUTE = 60000;
const SPORTS = { nba: ['basketball/nba'], nhl: ['hockey/nhl'], football: ['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1', 'soccer/pol.1', 'soccer/usa.1'] };
const MARKETS = { winner: ['home', 'away'], result_90: ['home', 'draw', 'away'], double_chance_90: ['home_draw', 'draw_away'] };
const RECORD_KEYS = ['id', 'personal', 'fixtureId', 'sport', 'route', 'homeId', 'awayId', 'home', 'away', 'startTime', 'createdAt', 'quotedAt', 'bookmaker', 'market', 'outcome', 'odds', 'stake', 'status', 'settlement', 'conflict', 'scope', 'line', 'playerId', 'teamId', 'metric', 'playerName'];
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fixtureDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const time = value => typeof value === 'number' ? value : Date.parse(value);
const iso = value => new Date(value).toISOString();
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validOdds = odds => typeof odds === 'number' && Number.isFinite(odds) && odds >= 1.01 && odds <= 1000;
const validStake = stake => typeof stake === 'number' && Number.isFinite(stake) && stake >= 0.01 && stake <= 100 && Math.abs(stake * 100 - Math.round(stake * 100)) < 1e-8;
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const allowedMarket = (sport, market, outcome) => (sport === 'football' ? ['result_90', 'double_chance_90'].includes(market) : ['nba', 'nhl'].includes(sport) && market === 'winner') && MARKETS[market]?.includes(outcome);

const numericId = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const tsdbId = value => typeof value === 'string' && /^tsdb-\d{1,14}$/.test(value);
const legacyMarket = market => Object.hasOwn(MARKETS, market);
const matchScope = sport => sport === 'football' ? 'regulation_90' : sport === 'nhl' ? 'including_overtime_shootout' : 'including_overtime';
const propScope = sport => sport === 'nhl' ? 'including_overtime_excluding_shootout' : matchScope(sport);
const METRICS = { nba: ['PTS', 'AST', 'REB'], nhl: ['S'], football: ['SH'] };
const halfLine = (value, maximum = 999.5) => typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= maximum && value % 1 === 0.5;
const playerFields = ['playerId', 'teamId', 'metric', 'playerName'];
const SETTLEMENT_KEYS = ['settledAt', 'resultAvailableAt', 'source', 'homeScore', 'awayScore', 'scope', 'value', 'line', 'outcome', 'playerId', 'teamId', 'metric'];

function identity(record) {
  const separate = record?.sport === 'football' && record.route === 'soccer/pol.1';
  return object(record) && SPORTS[record.sport]?.includes(record.route)
    && typeof record.fixtureId === 'string' && record.fixtureId.startsWith(`${record.route}:`)
    && (separate ? /^tsdb-\d{4,14}$/ : /^\d{4,14}$/).test(record.fixtureId.slice(record.route.length + 1))
    && ['homeId', 'awayId'].every(key => (separate ? tsdbId : numericId)(record[key])) && record.homeId !== record.awayId;
}
function sourceValid(source, record, now) {
  if (!object(source) || Object.keys(source).some(key => !['provider', 'url', 'fetchedAt'].includes(key))
    || !date(source.fetchedAt) || Date.parse(source.fetchedAt) > now || typeof source.url !== 'string' || source.url.length > 2000) return false;
  try {
    const url = new URL(source.url), sourceId = record.fixtureId.slice(record.route.length + 1);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (record.route === 'soccer/pol.1') {
      if (source.provider !== 'TheSportsDB' || url.origin !== 'https://www.thesportsdb.com') return false;
      const prefix = '/api/v1/json/123/';
      return url.pathname === prefix + 'lookupevent.php' && url.searchParams.get('id') === sourceId.slice(5)
        || url.pathname === prefix + 'eventsday.php' && url.searchParams.get('l') === '4422' && url.searchParams.get('d') === record.startTime.slice(0, 10)
        || url.pathname === prefix + 'eventslast.php' && [record.homeId.slice(5), record.awayId.slice(5)].includes(url.searchParams.get('id'));
    }
    if (source.provider !== 'ESPN' || url.origin !== 'https://site.api.espn.com') return false;
    const prefix = `/apis/site/v2/sports/${record.route}/`;
    if (url.pathname === prefix + 'summary') return url.searchParams.get('event') === sourceId;
    if (url.pathname !== prefix + 'scoreboard') return false;
    const day = url.searchParams.get('dates');
    if (record.route === 'soccer/usa.1' && /^\d{4}$/.test(day || '')) return day === record.startTime.slice(0, 4);
    if (!/^\d{8}$/.test(day || '')) return false;
    const parsed = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T00:00:00.000Z`);
    return Number.isFinite(parsed) && iso(parsed).slice(0, 10).replaceAll('-', '') === day
      && Math.abs(parsed - Date.parse(record.startTime.slice(0, 10) + 'T00:00:00.000Z')) <= 86400000;
  } catch { return false; }
}
function marketValid(record) {
  if (legacyMarket(record.market)) return allowedMarket(record.sport, record.market, record.outcome)
    && record.scope === matchScope(record.sport) && record.line === undefined && playerFields.every(key => record[key] === undefined);
  if (!['over', 'under'].includes(record.outcome)) return false;
  if (record.market === 'total_points') return record.sport === 'nba' && record.scope === 'including_overtime'
    && halfLine(record.line, 599.5) && playerFields.every(key => record[key] === undefined);
  if (record.market === 'total_goals') return ((record.sport === 'football' && ['soccer/pol.1', 'soccer/usa.1'].includes(record.route) && record.scope === 'regulation_90' && halfLine(record.line, 15.5))
    || (record.sport === 'nhl' && record.route === 'hockey/nhl' && record.scope === 'including_overtime_shootout' && halfLine(record.line, 25.5))) && playerFields.every(key => record[key] === undefined);
  return record.market === 'player_prop' && record.route !== 'soccer/pol.1' && halfLine(record.line)
    && numericId(record.playerId) && numericId(record.teamId) && [record.homeId, record.awayId].includes(record.teamId)
    && METRICS[record.sport]?.includes(record.metric) && text(record.playerName, 200) && record.scope === propScope(record.sport);
}
function won(record, homeScore, awayScore, value) {
  if (!legacyMarket(record.market)) return record.outcome === 'over' ? value > record.line : value < record.line;
  const outcome = homeScore > awayScore ? 'home' : homeScore === awayScore ? 'draw' : 'away';
  return record.outcome === outcome || record.outcome === 'home_draw' && outcome !== 'away' || record.outcome === 'draw_away' && outcome !== 'home';
}
function evidenceValue(record, proof) {
  if (legacyMarket(record.market)) return undefined;
  if (!Number.isInteger(proof.value) || proof.value < 0 || proof.value > 1000 || proof.line !== record.line || proof.outcome !== record.outcome) return null;
  if (record.market === 'player_prop') {
    if (proof.playerId !== record.playerId || proof.teamId !== record.teamId || proof.metric !== record.metric) return null;
    return proof.value;
  }
  return proof.value === proof.homeScore + proof.awayScore ? proof.value : null;
}
function validateRecord(record) {
  if (!object(record) || Object.keys(record).some(key => !RECORD_KEYS.includes(key)) || !identity(record)
    || !text(record.id, 80) || !/^[\w-]{8,80}$/.test(record.id) || record.personal !== true
    || !text(record.home, 200) || !text(record.away, 200) || !marketValid(record)
    || !validOdds(record.odds) || !validStake(record.stake)
    || !['startTime', 'createdAt', 'quotedAt'].every(key => date(record[key]))
    || Date.parse(record.createdAt) >= Date.parse(record.startTime) || Date.parse(record.quotedAt) > Date.parse(record.createdAt)
    || Date.parse(record.createdAt) - Date.parse(record.quotedAt) > 15 * MINUTE
    || !(record.bookmaker === null || text(record.bookmaker, 100)) || !['pending', 'won', 'lost', 'void'].includes(record.status)) fail('Nieprawidłowy wpis dziennika');
  if (record.status === 'pending' ? record.settlement !== null : !object(record.settlement)) fail('Niespójny stan rozliczenia');
  if (record.settlement) {
    const s = record.settlement, value = evidenceValue(record, s);
    if (Object.keys(s).some(key => !SETTLEMENT_KEYS.includes(key)) || !date(s.settledAt) || !date(s.resultAvailableAt) || Date.parse(s.settledAt) < Date.parse(s.resultAvailableAt)
      || Date.parse(s.resultAvailableAt) <= Date.parse(record.createdAt) || Date.parse(s.resultAvailableAt) <= Date.parse(record.startTime)
      || !sourceValid(s.source, record, Date.parse(s.settledAt)) || Date.parse(s.source.fetchedAt) < Date.parse(record.startTime) || s.scope !== record.scope) fail('Nieprawidłowy dowód rozliczenia');
    // Missing data and cancellations are never inferred to be losses or refunds.
    if (record.status === 'void' || ![s.homeScore, s.awayScore].every(score => Number.isInteger(score) && score >= 0 && score <= 300)
      || record.sport !== 'football' && s.homeScore === s.awayScore || value === null
      || record.status !== (won(record, s.homeScore, s.awayScore, value) ? 'won' : 'lost')) fail('Wynik nie odpowiada rozliczeniu');
  }
  if (record.conflict !== null && (!object(record.conflict) || Object.keys(record.conflict).some(key => !['detectedAt', 'reason'].includes(key))
    || !date(record.conflict.detectedAt) || record.conflict.reason !== 'source-result-changed' || record.status === 'pending')) fail('Nieprawidłowy konflikt rozliczenia');
  return record;
}
function upgradeLegacyRecord(record) {
  if (!object(record) || !legacyMarket(record.market)) fail('Starszy dziennik zawiera nieobsługiwany rynek');
  if (record.scope != null && record.scope !== matchScope(record.sport)) fail('Niezgodny zakres starszego wpisu');
  const result = { ...clone(record), scope: matchScope(record.sport) };
  if (result.settlement) {
    if (result.settlement.scope != null && result.settlement.scope !== result.scope) fail('Niezgodny zakres starszego wyniku');
    result.settlement.scope = result.scope;
  }
  return result;
}

export function emptyJournal() { return freeze({ schemaVersion: JOURNAL_VERSION, records: [] }); }

export function validateJournal(value) {
  if (!object(value) || ![1, JOURNAL_VERSION].includes(value.schemaVersion) || !Array.isArray(value.records) || value.records.length > MAX_RECORDS || Object.keys(value).some(key => !['schemaVersion', 'records'].includes(key))) fail('Nieprawidłowy format dziennika');
  const records = value.schemaVersion === 1 ? value.records.map(upgradeLegacyRecord) : clone(value.records);
  const seen = new Set();
  for (const record of records) { validateRecord(record); if (seen.has(record.id)) fail('Powielone ID wpisu'); seen.add(record.id); }
  return freeze({ schemaVersion: JOURNAL_VERSION, records });
}

export function createRecord(event, input, { now = Date.now(), id = globalThis.crypto?.randomUUID?.() } = {}) {
  const current = time(now);
  const start = Date.parse(event?.date);
  if (!Number.isFinite(current) || !Number.isFinite(start) || !fixtureDate(event?.date) || event?.state !== 'pre' || start <= current) fail('Wpis można zapisać wyłącznie przed rozpoczęciem meczu');
  if (!object(input)) fail('Brak danych wpisu');
  const record = {
    id, personal: true, fixtureId: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId,
    home: event.home, away: event.away, startTime: iso(start), createdAt: iso(current), quotedAt: input.quotedAt || iso(current),
    bookmaker: input.bookmaker?.trim() || null, market: input.market, outcome: input.outcome, odds: input.odds, stake: input.stake,
    scope: input.scope ?? (legacyMarket(input.market) ? matchScope(event.sport) : null),
    ...(!legacyMarket(input.market) ? { line: input.line } : {}),
    ...(input.market === 'player_prop' ? { playerId: input.playerId, teamId: input.teamId, metric: input.metric, playerName: input.playerName } : {}),
    status: 'pending', settlement: null, conflict: null,
  };
  validateRecord(record);
  return freeze(record);
}

export function appendRecord(journal, record) {
  const safe = validateJournal(journal);
  record = legacyMarket(record?.market) && record.scope == null ? upgradeLegacyRecord(record) : record;
  validateRecord(record);
  if (record.status !== 'pending' || record.conflict !== null) fail('Nowy wpis musi oczekiwać na wynik');
  const old = safe.records.find(row => row.id === record.id);
  if (old) { if (canonical(old) !== canonical(record)) fail('Konflikt istniejącego wpisu'); return safe; }
  if (safe.records.length >= MAX_RECORDS) fail(`Dziennik mieści maksymalnie ${MAX_RECORDS} wpisów`);
  return validateJournal({ schemaVersion: JOURNAL_VERSION, records: [...safe.records, record] });
}

export function mergeJournals(current, incoming) {
  const safe = validateJournal(current), added = validateJournal(incoming), records = [...safe.records];
  const byId = new Map(records.map(record => [record.id, record]));
  for (const record of added.records) {
    const old = byId.get(record.id);
    if (old && canonical(old) !== canonical(record)) fail('Import zmienia istniejący wpis — nie scalono danych');
    if (!old) { records.push(record); byId.set(record.id, record); }
  }
  return validateJournal({ schemaVersion: JOURNAL_VERSION, records });
}

function settlementResult(record, row, current) {
  if (!object(row) || row.id !== record.fixtureId || row.sport !== record.sport || row.route !== record.route || row.homeId !== record.homeId || row.awayId !== record.awayId
    || row.startTime !== record.startTime || row.status !== 'completed'
    || !date(row.resultAvailableAt) || Date.parse(row.resultAvailableAt) > current || Date.parse(row.resultAvailableAt) <= Date.parse(record.startTime) || Date.parse(row.resultAvailableAt) <= Date.parse(record.createdAt)
    || !['conservative-24h', 'verified-timestamp', 'historical-snapshot', 'observed-result'].includes(row.availabilityBasis)
    || !sourceValid(row.source, record, current) || Date.parse(row.source.fetchedAt) < Date.parse(row.startTime)
    || ![row.homeScore, row.awayScore].every(value => Number.isInteger(value) && value >= 0 && value <= 300)
    || record.sport !== 'football' && row.homeScore === row.awayScore
    || row.scope != null && row.scope !== matchScope(record.sport)) return null;
  const target = { scope: record.scope };
  let value;
  if (record.market === 'player_prop') {
    if (!Array.isArray(row.playerStats) || row.playerStats.length > 300) return null;
    const matches = row.playerStats.filter(stat => object(stat) && stat.playerId === record.playerId && stat.teamId === record.teamId && stat.metric === record.metric);
    if (matches.length !== 1 || Object.keys(matches[0]).some(key => !['playerId', 'teamId', 'metric', 'value', 'scope'].includes(key)) || matches[0].scope !== record.scope || !Number.isInteger(matches[0].value) || matches[0].value < 0 || matches[0].value > 1000) return null;
    value = matches[0].value;
    Object.assign(target, { value, line: record.line, outcome: record.outcome, playerId: record.playerId, teamId: record.teamId, metric: record.metric });
  } else if (!legacyMarket(record.market)) {
    if (row.scope !== record.scope) return null;
    value = row.homeScore + row.awayScore;
    Object.assign(target, { value, line: record.line, outcome: record.outcome });
  }
  return { status: won(record, row.homeScore, row.awayScore, value) ? 'won' : 'lost', homeScore: row.homeScore, awayScore: row.awayScore,
    ...target, resultAvailableAt: row.resultAvailableAt, source: clone(row.source), settledAt: iso(current) };
}

export function settleJournal(journal, resultRows, { now = Date.now() } = {}) {
  const safe = validateJournal(journal), current = time(now);
  if (!Number.isFinite(current) || !Array.isArray(resultRows) || resultRows.length > MAX_RECORDS) fail('Nieprawidłowe dane rozliczenia');
  const byId = new Map();
  const duplicates = new Set();
  for (const row of resultRows) { if (byId.has(row?.id)) duplicates.add(row.id); else byId.set(row?.id, row); }
  const records = safe.records.map(record => {
    if (duplicates.has(record.fixtureId)) return record;
    const result = settlementResult(record, byId.get(record.fixtureId), current);
    if (!result) return record;
    if (record.settlement) {
      if (['homeScore', 'awayScore', 'scope', 'value', 'line', 'outcome', 'playerId', 'teamId', 'metric'].some(key => record.settlement[key] !== result[key]) || record.status !== result.status)
        return record.conflict ? record : { ...record, conflict: { detectedAt: iso(current), reason: 'source-result-changed' } };
      return record;
    }
    const { status, ...settlement } = result;
    return { ...record, status, settlement };
  });
  return validateJournal({ schemaVersion: JOURNAL_VERSION, records });
}

export function summarizeJournal(journal) {
  const { records } = validateJournal(journal);
  const settled = records.filter(record => ['won', 'lost'].includes(record.status) && !record.conflict);
  const wins = settled.filter(record => record.status === 'won').length;
  const settledStake = settled.reduce((sum, record) => sum + record.stake, 0);
  const profit = settled.reduce((sum, record) => sum + (record.status === 'won' ? record.stake * (record.odds - 1) : -record.stake), 0);
  return {
    total: records.length, pending: records.filter(record => record.status === 'pending').length, settled: settled.length,
    won: wins, lost: settled.length - wins, void: records.filter(record => record.status === 'void').length,
    conflicted: records.filter(record => record.conflict).length, unitsStaked: records.reduce((sum, record) => sum + record.stake, 0),
    settledStake, profit, roi: settledStake ? profit / settledStake : null, hitRate: settled.length ? wins / settled.length : null,
    personal: true, note: 'Wyniki własnych wpisów na tym urządzeniu. Nie są skutecznością modeli; zapis lokalny można zmodyfikować poza aplikacją. Konflikty rozliczenia pominięto w statystykach.',
  };
}

export function evaluatePrice(odds, forecast = null, { event = null, market = null, outcome = null, now = Date.now() } = {}) {
  if (!validOdds(odds)) fail('Kurs dziesiętny musi wynosić od 1,01 do 1000');
  const unavailable = reason => ({ status: 'unavailable', breakEven: 1 / odds, modelProbability: null, expectedValue: null, reason });
  const current = time(now), start = Date.parse(event?.date);
  if (!event || event.state !== 'pre' || !Number.isFinite(current) || !Number.isFinite(start) || start <= current) return unavailable('Brak aktualnego spotkania przedmeczowego do porównania.');
  if (!forecast || forecast.status !== 'published') return unavailable('Kurs pozwala wyliczyć próg rentowności. Brak zweryfikowanej prognozy, więc nie oceniamy opłacalności.');
  const generated = Date.parse(forecast.generatedAt), validUntil = Date.parse(forecast.validUntil);
  if (forecast.fixtureId !== event.id || forecast.sport !== event.sport || forecast.route !== event.route || forecast.homeId !== event.homeId || forecast.awayId !== event.awayId || forecast.startTime !== iso(start)
    || !allowedMarket(event.sport, market, outcome) || forecast.market !== market || forecast.outcome !== outcome
    || !date(forecast.generatedAt) || !date(forecast.validUntil) || generated > current || generated >= start || current - generated > 15 * MINUTE || validUntil < current || validUntil > start
    || forecast.verification?.pointInTimeVerified !== true || forecast.verification?.publicationEligible !== true || !text(forecast.verification?.modelVersion, 100)
    || typeof forecast.probability !== 'number' || !Number.isFinite(forecast.probability) || forecast.probability < 0 || forecast.probability > 1) return unavailable('Prognoza nie potwierdza tego meczu, rynku, terminu lub warunków publikacji.');
  return { status: 'available', breakEven: 1 / odds, modelProbability: forecast.probability, expectedValue: forecast.probability * odds - 1,
    reason: 'Porównanie zweryfikowanej prognozy z ręcznie podanym kursem; nie uwzględnia podatków, opłat ani zmiany kursu.' };
}
