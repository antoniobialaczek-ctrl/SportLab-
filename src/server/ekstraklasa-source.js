// Separate descriptive feed. These observations do not enter the frozen ESPN
// model experiment and do not claim to reconstruct past publication times.
export const EKSTRAKLASA_SOURCE = Object.freeze({
  provider: 'TheSportsDB', leagueId: '4422', route: 'soccer/pol.1',
  name: 'Ekstraklasa', documentation: 'https://www.thesportsdb.com/documentation',
  terms: 'https://www.thesportsdb.com/docs_terms_of_use.php',
  attribution: 'Dane: TheSportsDB', requestsPerMinute: 30,
  dayLimit: 3, nextLimit: 1, seasonLimit: 15,
});
const BASE = 'https://www.thesportsdb.com/api/v1/json/123/';
export const isEkstraklasaId = value => typeof value === 'string' && /^tsdb-\d{1,14}$/.test(value);
const digits = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(`${day}T00:00:00.000Z`)) && new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
const name = value => typeof value === 'string' && value.trim() && value.length <= 200 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;
const score = value => typeof value === 'string' && /^\d{1,2}$/.test(value) && Number(value) <= 30 ? Number(value) : null;

export function ekstraklasaDayURL(day) {
  if (!validDay(day)) throw new Error('Nieprawidłowa data Ekstraklasy');
  return `${BASE}eventsday.php?d=${day}&l=${EKSTRAKLASA_SOURCE.leagueId}`;
}
export const ekstraklasaNextURL = () => `${BASE}eventsnextleague.php?id=${EKSTRAKLASA_SOURCE.leagueId}`;
export function ekstraklasaEventURL(id) {
  if (!isEkstraklasaId(id)) throw new Error('Nieprawidłowy identyfikator meczu Ekstraklasy');
  return `${BASE}lookupevent.php?id=${id.slice(5)}`;
}
export function ekstraklasaTeamLastURL(id) {
  if (!isEkstraklasaId(id)) throw new Error('Nieprawidłowy identyfikator drużyny Ekstraklasy');
  return `${BASE}eventslast.php?id=${id.slice(5)}`;
}

function trustedSourceURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Nieprawidłowy URL źródła Ekstraklasy'); }
  if (url.origin !== 'https://www.thesportsdb.com' || url.username || url.password || url.hash
    || !['eventsday.php', 'eventsnextleague.php', 'lookupevent.php', 'eventslast.php'].some(path => url.pathname === `/api/v1/json/123/${path}`)) {
    throw new Error('Niedozwolone źródło Ekstraklasy');
  }
  if (url.pathname.endsWith('/eventsday.php') && (!validDay(url.searchParams.get('d')) || url.searchParams.get('l') !== '4422')
    || url.pathname.endsWith('/eventsnextleague.php') && url.searchParams.get('id') !== '4422'
    || ['/lookupevent.php', '/eventslast.php'].some(path => url.pathname.endsWith(path)) && !digits(url.searchParams.get('id'))) throw new Error('Nieprawidłowe parametry źródła Ekstraklasy');
  return url;
}

// No retry on 429: keep the previous complete observation and respect limits.
export async function fetchEkstraklasaJSON(url, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  trustedSourceURL(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`TheSportsDB zwróciło HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.Message || data.message || data.error
      || !(data.events === null || Array.isArray(data.events))) throw new Error('Nieprawidłowa odpowiedź TheSportsDB');
    return data;
  } finally { clearTimeout(timer); }
}

function startTime(row) {
  if (typeof row.strTimestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/.test(row.strTimestamp)) return null;
  const date = new Date(row.strTimestamp.endsWith('Z') ? row.strTimestamp : `${row.strTimestamp}Z`);
  if (!Number.isFinite(date.valueOf())) return null;
  const result = date.toISOString();
  if (row.dateEvent !== result.slice(0, 10) || !validDay(row.dateEvent)) return null;
  // Midnight is commonly a placeholder for an unannounced football kickoff.
  // A dated fixture with no explicit clock is not an exact pre-match binding.
  if (typeof row.strTime !== 'string' || row.strTime === '00:00:00' || row.strTime !== result.slice(11, 19)) return null;
  return result;
}

export function normalizeEkstraklasaResponse(data, { day = null, observedAt = new Date().toISOString(), sourceURL } = {}) {
  const url = trustedSourceURL(sourceURL);
  if (day !== null && (!validDay(day) || url.pathname !== '/api/v1/json/123/eventsday.php' || url.searchParams.get('d') !== day || url.searchParams.get('l') !== '4422')) throw new Error('Niezgodna data źródła Ekstraklasy');
  if (!data || typeof data !== 'object' || data.Message || data.message || data.error || !(data.events === null || Array.isArray(data.events))) throw new Error('Nieprawidłowa odpowiedź TheSportsDB');
  const now = Date.parse(observedAt);
  if (!Number.isFinite(now)) throw new Error('Nieprawidłowy czas obserwacji Ekstraklasy');
  const fetchedAt = new Date(now).toISOString(), rows = data.events || [];
  const grouped = new Map(), exclusions = [];
  if (rows.length > 1000) throw new Error('Nadmierna odpowiedź TheSportsDB');
  for (const row of rows) {
    const reject = reason => exclusions.push({ sourceEventId: digits(row?.idEvent) ? `tsdb-${row.idEvent}` : null, reason });
    if (!row || row.idLeague !== '4422' || row.strSport !== 'Soccer' || !digits(row.idEvent)
      || !digits(row.idHomeTeam) || !digits(row.idAwayTeam) || row.idHomeTeam === row.idAwayTeam || !name(row.strHomeTeam) || !name(row.strAwayTeam)) { reject('Niepotwierdzona liga lub tożsamość uczestników'); continue; }
    const date = startTime(row);
    if (!date || day && date.slice(0, 10) !== day) { reject('Brak zgodnego czasu UTC spotkania'); continue; }
    if (url.pathname.endsWith('/lookupevent.php') && url.searchParams.get('id') !== row.idEvent) { reject('Niezgodny identyfikator odpowiedzi meczu'); continue; }
    if (url.pathname.endsWith('/eventslast.php') && ![row.idHomeTeam, row.idAwayTeam].includes(url.searchParams.get('id'))) { reject('Niezgodny identyfikator drużyny w odpowiedzi'); continue; }
    const status = row.strStatus;
    const state = status === 'NS' ? 'pre' : status === 'FT' ? 'post' : ['1H', 'HT', '2H', 'IN'].includes(status) ? 'in' : null;
    if (!state || row.strPostponed !== 'no' || state === 'pre' && Date.parse(date) <= now || state !== 'pre' && Date.parse(date) >= now) { reject('Brak potwierdzonego statusu lub meczu o aktywnym terminie'); continue; }
    if (url.pathname.endsWith('/eventsnextleague.php') && state !== 'pre' || url.pathname.endsWith('/eventslast.php') && state !== 'post') { reject('Status nie odpowiada rodzajowi odczytu źródła'); continue; }
    const homeScore = score(row.intHomeScore), awayScore = score(row.intAwayScore);
    if (state === 'post' && (homeScore === null || awayScore === null || row.intHomeScoreExtra || row.intAwayScoreExtra)) { reject('Brak potwierdzonego wyniku czasu podstawowego'); continue; }
    const id = `tsdb-${row.idEvent}`;
    const event = {
      id: `soccer/pol.1:${id}`, sourceEventId: id, sourceRawEventId: row.idEvent,
      provider: 'TheSportsDB', sport: 'football', route: 'soccer/pol.1', league: 'Ekstraklasa', leagueId: 'pol.1',
      date, home: name(row.strHomeTeam), away: name(row.strAwayTeam), homeId: `tsdb-${row.idHomeTeam}`, awayId: `tsdb-${row.idAwayTeam}`,
      homeScore: state === 'pre' ? null : homeScore, awayScore: state === 'pre' ? null : awayScore,
      state, statusDetail: status === 'FT' ? 'Koniec meczu' : status === 'NS' ? 'Zaplanowany' : 'W trakcie — odczyt źródła',
      homeRecord: null, awayRecord: null,
      forecast: { status: 'withheld', reason: 'Osobne źródło opisowe — bez zweryfikowanego modelu Ekstraklasy.' },
      source: { provider: 'TheSportsDB', url: url.href, fetchedAt },
    };
    const previous = grouped.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) { grouped.set(id, null); reject('Sprzeczne duplikaty meczu'); }
    else if (!grouped.has(id)) grouped.set(id, event);
  }
  const events = [...grouped.values()].filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const history = events.filter(event => event.state === 'post').map(event => ({
    ...event, league: 'pol.1', startTime: event.date, status: 'completed',
    firstObservedAt: fetchedAt,
    resultAvailableAt: new Date(Math.max(Date.parse(event.date) + 86400000, now)).toISOString(),
    availabilityBasis: 'observed-result', neutralSite: true,
    neutralSiteBasis: 'unknown-assume-neutral',
  }));
  return {
    events, history, exclusions, fetchedAt, source: EKSTRAKLASA_SOURCE,
    coverage: { complete: false, limit: day === null ? ['/eventsnextleague.php', '/eventslast.php'].some(path => url.pathname.endsWith(path)) ? 1 : null : 3,
      possiblyTruncated: day !== null && rows.length >= 3,
      note: 'Darmowy odczyt TheSportsDB może być niepełny; dzienny endpoint zwraca do 3 spotkań. Obserwacje służą analizie opisowej, nie zamrożonemu testowi modeli.' },
  };
}
