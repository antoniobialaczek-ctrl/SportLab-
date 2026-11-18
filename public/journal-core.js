export const JOURNAL_VERSION = 1;
export const MAX_RECORDS = 500;
const MINUTE = 60000;
const SPORTS = { nba: ['basketball/nba'], nhl: ['hockey/nhl'], football: ['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1'] };
const MARKETS = { winner: ['home', 'away'], result_90: ['home', 'draw', 'away'], double_chance_90: ['home_draw', 'draw_away'] };
const RECORD_KEYS = ['id', 'personal', 'fixtureId', 'sport', 'route', 'homeId', 'awayId', 'home', 'away', 'startTime', 'createdAt', 'quotedAt', 'bookmaker', 'market', 'outcome', 'odds', 'stake', 'status', 'settlement', 'conflict'];
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

function identity(record) {
  return object(record) && SPORTS[record.sport]?.includes(record.route)
    && typeof record.fixtureId === 'string' && record.fixtureId.startsWith(`${record.route}:`) && /^\d{4,14}$/.test(record.fixtureId.slice(record.route.length + 1))
    && ['homeId', 'awayId'].every(key => typeof record[key] === 'string' && /^\d{1,14}$/.test(record[key])) && record.homeId !== record.awayId;
}
function sourceValid(source, route, now) {
  if (!object(source) || source.provider !== 'ESPN' || !date(source.fetchedAt) || Date.parse(source.fetchedAt) > now) return false;
  try { const url = new URL(source.url); return url.protocol === 'https:' && url.hostname === 'site.api.espn.com' && !url.username && !url.password && url.pathname.startsWith(`/apis/site/v2/sports/${route}/`); }
  catch { return false; }
}
function won(record, homeScore, awayScore) {
  const outcome = homeScore > awayScore ? 'home' : homeScore === awayScore ? 'draw' : 'away';
  return record.outcome === outcome || record.outcome === 'home_draw' && outcome !== 'away' || record.outcome === 'draw_away' && outcome !== 'home';
}
function validateRecord(record) {
  if (!object(record) || Object.keys(record).some(key => !RECORD_KEYS.includes(key)) || !identity(record)
    || !text(record.id, 80) || !/^[\w-]{8,80}$/.test(record.id) || record.personal !== true
    || !text(record.home, 200) || !text(record.away, 200) || !allowedMarket(record.sport, record.market, record.outcome)
    || !validOdds(record.odds) || !validStake(record.stake)
    || !['startTime', 'createdAt', 'quotedAt'].every(key => date(record[key]))
    || Date.parse(record.createdAt) >= Date.parse(record.startTime) || Date.parse(record.quotedAt) > Date.parse(record.createdAt)
    || Date.parse(record.createdAt) - Date.parse(record.quotedAt) > 15 * MINUTE
    || !(record.bookmaker === null || text(record.bookmaker, 100)) || !['pending', 'won', 'lost', 'void'].includes(record.status)) fail('Nieprawidłowy wpis dziennika');
  if (record.status === 'pending' ? record.settlement !== null : !object(record.settlement)) fail('Niespójny stan rozliczenia');
  if (record.settlement) {
    const s = record.settlement;
    if (!date(s.settledAt) || !date(s.resultAvailableAt) || Date.parse(s.settledAt) < Date.parse(s.resultAvailableAt)
      || Date.parse(s.resultAvailableAt) <= Date.parse(record.createdAt) || Date.parse(s.resultAvailableAt) <= Date.parse(record.startTime)
      || !sourceValid(s.source, record.route, Date.parse(s.settledAt))) fail('Nieprawidłowy dowód rozliczenia');
    // Cancellations are not represented by the normalized history. Never invent a void.
    if (record.status === 'void' || ![s.homeScore, s.awayScore].every(value => Number.isInteger(value) && value >= 0 && value <= 300)
      || record.sport !== 'football' && s.homeScore === s.awayScore || record.status !== (won(record, s.homeScore, s.awayScore) ? 'won' : 'lost')) fail('Wynik nie odpowiada rozliczeniu');
  }
  if (record.conflict !== null && (!object(record.conflict) || !date(record.conflict.detectedAt) || record.conflict.reason !== 'source-result-changed' || record.status === 'pending')) fail('Nieprawidłowy konflikt rozliczenia');
  return record;
}

export function emptyJournal() { return freeze({ schemaVersion: JOURNAL_VERSION, records: [] }); }

export function validateJournal(value) {
  if (!object(value) || value.schemaVersion !== JOURNAL_VERSION || !Array.isArray(value.records) || value.records.length > MAX_RECORDS || Object.keys(value).some(key => !['schemaVersion', 'records'].includes(key))) fail('Nieprawidłowy format dziennika');
  const seen = new Set();
  for (const record of value.records) { validateRecord(record); if (seen.has(record.id)) fail('Powielone ID wpisu'); seen.add(record.id); }
  return freeze(clone(value));
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
    status: 'pending', settlement: null, conflict: null,
  };
  validateRecord(record);
  return freeze(record);
}

export function appendRecord(journal, record) {
  const safe = validateJournal(journal); validateRecord(record);
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
    || !['conservative-24h', 'verified-timestamp', 'historical-snapshot'].includes(row.availabilityBasis)
    || !sourceValid(row.source, row.route, current) || Date.parse(row.source.fetchedAt) < Date.parse(row.startTime)
    || ![row.homeScore, row.awayScore].every(value => Number.isInteger(value) && value >= 0 && value <= 300)
    || record.sport !== 'football' && row.homeScore === row.awayScore) return null;
  return { status: won(record, row.homeScore, row.awayScore) ? 'won' : 'lost', homeScore: row.homeScore, awayScore: row.awayScore,
    resultAvailableAt: row.resultAvailableAt, source: clone(row.source), settledAt: iso(current) };
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
      if (record.settlement.homeScore !== result.homeScore || record.settlement.awayScore !== result.awayScore || record.status !== result.status)
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
