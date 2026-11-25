import { matchPickQuote } from './pick-odds.js';

const DAY = 86400000, MINUTE = 60000;
const ROUTES = new Set(['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/pol.1', 'soccer/usa.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1']);
const count = value => Number.isInteger(value) && value >= 0;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value.slice(0, 10) ? parsed : NaN;
};
const halfLine = value => typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 15.5 && value % 1 === 0.5;
const ratio = support => support.sample ? support.hits / support.sample : 0;
const minimum = support => Math.min(ratio(support.home), ratio(support.away));
const counts = (rows, predicate) => ({ hits: rows.filter(predicate).length, sample: rows.length });

function validRows(form, event, cutoff) {
  const separate = event.route === 'soccer/pol.1';
  const idPattern = separate ? /^tsdb-\d{4,14}$/ : /^\d{4,14}$/;
  const legacy = ['soccer/pol.1', 'soccer/usa.1'].includes(event.route);
  if (!form || !count(form.sample) || form.sample < 3 || form.sample > 10 || !Array.isArray(form.recent) || form.recent.length !== form.sample) return null;
  const ids = new Set(), rows = [];
  for (const row of form.recent) {
    if (!row || typeof row.id !== 'string' || !row.id.startsWith(`${event.route}:`) || !idPattern.test(row.id.slice(event.route.length + 1))
      || row.id === event.id || ids.has(row.id) || row.route !== event.route || !Number.isFinite(time(row.date)) || time(row.date) >= cutoff
      || ![row.scoreFor, row.scoreAgainst].every(value => count(value) && value <= 30)
      || row.scoreScope != null && row.scoreScope !== 'regulation_90' || row.regulationOnly === false
      || !legacy && (row.scoreScope !== 'regulation_90' || row.regulationOnly !== true)
      || separate && row.sourceEventId !== row.id.slice(event.route.length + 1)) return null;
    ids.add(row.id);
    rows.push({ id: row.id, matchId: row.id, date: row.date, opponent: typeof row.opponent === 'string' ? row.opponent : '',
      scoreFor: row.scoreFor, scoreAgainst: row.scoreAgainst, total: row.scoreFor + row.scoreAgainst,
      ...(typeof row.isHome === 'boolean' ? { isHome: row.isHome } : {}) });
  }
  rows.sort((a, b) => time(b.date) - time(a.date) || a.id.localeCompare(b.id));
  const wins = rows.filter(row => row.scoreFor > row.scoreAgainst).length, draws = rows.filter(row => row.scoreFor === row.scoreAgainst).length;
  if (![form.wins, form.draws, form.losses].every(count) || form.wins !== wins || form.draws !== draws || form.losses !== rows.length - wins - draws
    || time(form.lastMatchAt) !== time(rows[0].date)) return null;
  const averages = [mean(rows.map(row => row.scoreFor)), mean(rows.map(row => row.scoreAgainst))];
  if (![form.averageFor, form.averageAgainst, form.averageMargin].every(Number.isFinite)
    || Math.abs(form.averageFor - averages[0]) > 0.03 || Math.abs(form.averageAgainst - averages[1]) > 0.03
    || Math.abs(form.averageMargin - averages[0] + averages[1]) > 0.03) return null;
  return rows;
}

function metrics(rows, line) {
  return { sample: rows.length, wins: rows.filter(row => row.scoreFor > row.scoreAgainst).length,
    draws: rows.filter(row => row.scoreFor === row.scoreAgainst).length, losses: rows.filter(row => row.scoreFor < row.scoreAgainst).length,
    averageFor: mean(rows.map(row => row.scoreFor)), averageAgainst: mean(rows.map(row => row.scoreAgainst)),
    averageTotal: mean(rows.map(row => row.total)), averageMargin: mean(rows.map(row => row.scoreFor - row.scoreAgainst)),
    btts: rows.filter(row => row.scoreFor > 0 && row.scoreAgainst > 0).length,
    cleanSheets: rows.filter(row => row.scoreAgainst === 0).length, failedToScore: rows.filter(row => row.scoreFor === 0).length,
    over: rows.filter(row => row.total > line).length, under: rows.filter(row => row.total < line).length };
}

function team(form, rows, side, name, line) {
  const venueRows = rows.filter(row => row.isHome === (side === 'home'));
  return { id: form.id, name, sample: rows.length, overall: metrics(rows, line), last5: metrics(rows.slice(0, 5), line),
    venue: { label: side === 'home' ? 'u siebie' : 'na wyjeździe', reliable: venueRows.length >= 3, ...metrics(venueRows, line) },
    latestDate: rows[0].date, oldestDate: rows.at(-1).date, recent: rows };
}

function chooseLine(options, event, current) {
  if (options.totalLine !== undefined) {
    if (!halfLine(options.totalLine)) return null;
    const exact = ['over', 'under'].every(direction => matchPickQuote(options.oddsData, event,
      { kind: 'total', market: 'total_goals', scope: 'regulation_90', line: options.totalLine, direction }, { now: current }).status === 'matched');
    return { line: options.totalLine, lineOrigin: options.totalLineOrigin === 'source' && exact ? 'source' : 'manual' };
  }
  for (const quote of (Array.isArray(options.oddsData?.quotes) ? options.oddsData.quotes : []).slice(0, 510)) {
    if (quote?.market !== 'total_goals' || quote.scope !== 'regulation_90' || !halfLine(quote.line)) continue;
    if (['over', 'under'].every(direction => matchPickQuote(options.oddsData, event,
      { kind: 'total', market: 'total_goals', scope: 'regulation_90', line: quote.line, direction }, { now: current }).status === 'matched')) return { line: quote.line, lineOrigin: 'source' };
  }
  return { line: 2.5, lineOrigin: 'analytical' };
}

/** Descriptive football comparison, independent of the price filter. These
 * counts never claim calibrated chances, a fair price, or expected profit.
 */
export function buildFootballAnalysis(analysis, event, options = {}) {
  const current = options.now == null ? Date.now() : typeof options.now === 'number' ? options.now : Date.parse(options.now);
  const start = time(event?.date), cutoff = time(analysis?.cutoff);
  const result = (status, reason, extra = {}) => ({ sport: 'football', route: event?.route, fixtureId: event?.id,
    scope: 'regulation_90', status, reason, best: null, candidates: [], teams: null, notes: [], coverage: null, ...extra });
  if (!Number.isFinite(current) || !Number.isFinite(start)) return result('unavailable', 'Nie można potwierdzić terminu spotkania.');
  if (event.state !== 'pre' || start <= current) return result('closed', 'Spotkanie już się rozpoczęło; wskazanie przedmeczowe jest zamknięte.');
  if (start - current > 2 * DAY) return result('unavailable', 'Analiza kierunków jest dostępna w ciągu 48 godzin przed meczem.');
  const separate = event.route === 'soccer/pol.1', participant = separate ? /^tsdb-\d{1,14}$/ : /^\d{1,14}$/, fixture = separate ? /^tsdb-\d{4,14}$/ : /^\d{4,14}$/;
  if (event.sport !== 'football' || !ROUTES.has(event.route) || typeof event.id !== 'string' || !event.id.startsWith(`${event.route}:`)
    || !fixture.test(event.id.slice(event.route.length + 1)) || ![event.homeId, event.awayId].every(id => typeof id === 'string' && participant.test(id))
    || event.homeId === event.awayId || ![event.home, event.away].every(name => typeof name === 'string' && name.trim() && name.length <= 200)
    || !analysis || !['available', 'partial'].includes(analysis.status) || analysis.sport !== 'football' || analysis.route !== event.route
    || analysis.fixtureId != null && analysis.fixtureId !== event.id || analysis.home?.id !== event.homeId || analysis.away?.id !== event.awayId
    || analysis.resultScope !== 'regulation_90' || !Number.isFinite(cutoff) || cutoff > current || cutoff >= start
    || analysis.observedAt != null && (!Number.isFinite(time(analysis.observedAt)) || time(analysis.observedAt) > cutoff)
    || separate && event.sourceEventId !== event.id.slice(event.route.length + 1)) return result('unavailable', 'Nie można potwierdzić meczu, uczestników lub wyników po 90 minutach.');
  if (current - cutoff > 15 * MINUTE) return result('unavailable', 'Odśwież analizę: odczyt wcześniejszych wyników ma ponad 15 minut.');
  const homeRows = validRows(analysis.home, event, cutoff), awayRows = validRows(analysis.away, event, cutoff);
  if (!homeRows || !awayRows) return result('unavailable', 'Analiza wymaga co najmniej 3 spójnych wcześniejszych wyników 90 minut każdej drużyny.');
  const shared = new Map(homeRows.map(row => [row.id, row]));
  for (const row of awayRows) {
    const other = shared.get(row.id);
    if (other && (time(other.date) !== time(row.date) || other.scoreFor !== row.scoreAgainst || other.scoreAgainst !== row.scoreFor
      || typeof other.isHome === 'boolean' && typeof row.isHome === 'boolean' && other.isHome === row.isHome)) return result('unavailable', 'Wspólne spotkanie ma sprzeczne wyniki lub role drużyn.');
  }
  const sharedMatches = awayRows.filter(row => shared.has(row.id)).length;
  const selectedLine = chooseLine(options, event, current);
  if (!selectedLine) return result('unavailable', 'Podaj linię sumy goli z połówką od 0,5 do 15,5.');
  const { line, lineOrigin } = selectedLine;
  const teams = { home: team(analysis.home, homeRows, 'home', event.home, line), away: team(analysis.away, awayRows, 'away', event.away, line) };
  const full = homeRows.length >= 8 && awayRows.length >= 8;
  const stale = [teams.home, teams.away].some(side => current - time(side.latestDate) > 30 * DAY);
  const notes = ['Porównanie wcześniejszych wyników po 90 minutach z doliczonym czasem, bez dogrywki i karnych. Liczniki nie są prawdopodobieństwami wygranej.',
    'Brak potwierdzonej korekty na siłę rywali, składy i kontuzje; sprawdź je przed decyzją.'];
  if (!full) notes.push('Krótka historia: mniej niż 8 meczów co najmniej jednej drużyny. Pokazano statystyki bez wyboru głównego kierunku.');
  if (stale) notes.push('Ostatni dostępny mecz co najmniej jednej strony jest starszy niż 30 dni. Brak głównego wskazania.');
  else if ([teams.home, teams.away].some(side => current - time(side.latestDate) > 14 * DAY)) notes.push('Co najmniej jedna drużyna nie ma w tej lidze dostępnego meczu z ostatnich 14 dni. Porównanie może pomijać nowsze występy w innych rozgrywkach.');
  if ([teams.home, teams.away].some(side => time(side.latestDate) - time(side.oldestDate) > 120 * DAY)) notes.push('Okno wyników obejmuje ponad 120 dni, w tym możliwy poprzedni sezon. Forma ma ograniczoną aktualność.');
  if (sharedMatches) notes.push(`Wspólnych meczów w obu zestawach: ${sharedMatches}. Te wyniki nie są niezależnymi obserwacjami.`);
  if (analysis.coverage?.complete !== true) notes.push('Źródło nie potwierdza kompletności historii tej ligi.');
  const venueRows = { home: homeRows.filter(row => row.isHome === true), away: awayRows.filter(row => row.isHome === false) };
  const candidates = [];
  function add(descriptor, homePredicate, awayPredicate, { gate = true, threshold = 0.6, trend = true, extraReasons = [], extraCounter = [] } = {}) {
    const support = { home: counts(homeRows, homePredicate), away: counts(awayRows, awayPredicate) };
    const recentSupport = { home: counts(homeRows.slice(0, 5), homePredicate), away: counts(awayRows.slice(0, 5), awayPredicate) };
    const venueSupport = { home: counts(venueRows.home, homePredicate), away: counts(venueRows.away, awayPredicate) };
    const venueAgainst = Object.values(venueSupport).some(value => value.sample >= 3 && ratio(value) < 0.5);
    const recentAgainst = minimum(recentSupport) < 0.6 || !trend;
    const aligned = gate && minimum(support) >= threshold && !recentAgainst && !venueAgainst;
    const reasons = [`${event.home}: ${support.home.hits} z ${support.home.sample}; ${event.away}: ${support.away.hits} z ${support.away.sample} wcześniejszych wyników zgodnych z kierunkiem.`,
      `Ostatnie 5: ${recentSupport.home.hits}/${recentSupport.home.sample} oraz ${recentSupport.away.hits}/${recentSupport.away.sample}.`, ...extraReasons];
    const counterevidence = [`Wyniki przeciw kierunkowi: ${event.home} ${support.home.sample - support.home.hits}/${support.home.sample}; ${event.away} ${support.away.sample - support.away.hits}/${support.away.sample}.`, ...extraCounter];
    if (recentAgainst) counterevidence.push('Ostatnie 5 wyników lub ich średnia nie potwierdza zgodnie kierunku obu drużyn.');
    if (venueAgainst) counterevidence.push('Co najmniej jedna próba dom/wyjazd wskazuje przeciwny obraz.');
    if (!teams.home.venue.reliable || !teams.away.venue.reliable) counterevidence.push('Próba dom/wyjazd poniżej 3 spotkań co najmniej jednej drużyny.');
    if (!gate) counterevidence.push('Bilans zwycięstw i różnica goli nie potwierdzają przewagi wskazanej strony.');
    const pick = { ...descriptor, scope: 'regulation_90', support, recentSupport, venueSupport, reasons, counterevidence,
      signal: aligned ? 'aligned' : minimum(support) >= 0.5 ? 'mixed' : 'weak', eligible: full && !stale && aligned };
    pick.quote = matchPickQuote(options.oddsData, event, pick, { now: current });
    candidates.push(pick);
  }
  const margin = teams.home.overall.averageMargin - teams.away.overall.averageMargin;
  const homeWins = teams.home.overall.wins / teams.home.sample, awayWins = teams.away.overall.wins / teams.away.sample;
  for (const side of ['home', 'away']) {
    const isHome = side === 'home', chosen = teams[side], other = teams[isHome ? 'away' : 'home'];
    const gate = (isHome ? margin >= 0.25 && homeWins - awayWins >= 0.1 : margin <= -0.25 && awayWins - homeWins >= 0.1);
    add({ kind: 'result', market: isHome ? '1X' : 'X2', side, label: `${chosen.name} nie przegra — ${isHome ? '1X' : 'X2'} (90 minut)` },
      row => isHome ? row.scoreFor >= row.scoreAgainst : row.scoreFor <= row.scoreAgainst,
      row => isHome ? row.scoreFor <= row.scoreAgainst : row.scoreFor >= row.scoreAgainst,
      { gate, threshold: 0.7, extraReasons: [`Średnia różnica goli: ${decimal(chosen.overall.averageMargin)} wobec ${decimal(other.overall.averageMargin)}.`] });
    add({ kind: 'result', market: 'winner', side, label: `${chosen.name} — zwycięstwo (90 minut)` },
      row => isHome ? row.scoreFor > row.scoreAgainst : row.scoreFor < row.scoreAgainst,
      row => isHome ? row.scoreFor < row.scoreAgainst : row.scoreFor > row.scoreAgainst,
      { gate, extraCounter: ['Remis oznacza przegraną tego wyboru; nie jest liczony jako zwycięstwo.'] });
  }
  add({ kind: 'result', market: 'winner', side: 'draw', label: 'Remis (90 minut)' }, row => row.scoreFor === row.scoreAgainst, row => row.scoreFor === row.scoreAgainst);
  for (const direction of ['over', 'under']) {
    const over = direction === 'over', predicate = row => over ? row.total > line : row.total < line;
    const trend = [teams.home, teams.away].every(side => over ? side.last5.averageTotal > line : side.last5.averageTotal < line);
    add({ kind: 'total', market: 'total_goals', direction, line, lineOrigin, label: `${over ? 'Powyżej' : 'Poniżej'} ${decimal(line)} gola w meczu (90 minut)` }, predicate, predicate,
      { trend, extraReasons: [`Średnie sumy goli w ostatnich 5 meczach: ${decimal(teams.home.last5.averageTotal)} i ${decimal(teams.away.last5.averageTotal)}.`,
        lineOrigin === 'source' ? 'Porównano dokładną linię z dopasowanego odczytu kursu.' : lineOrigin === 'manual' ? 'Porównano podaną linię; cenę należy sprawdzić dla dokładnie tego rynku.' : 'Stała linia analityczna 2,5; nie dobierano jej do największej liczby trafień.'] });
  }
  for (const side of ['yes', 'no']) {
    const predicate = row => (row.scoreFor > 0 && row.scoreAgainst > 0) === (side === 'yes');
    add({ kind: 'btts', market: 'btts_90', side, label: `Obie drużyny strzelą — ${side === 'yes' ? 'tak' : 'nie'} (90 minut)` }, predicate, predicate,
      { extraCounter: ['Historia „obie strzelą” dotyczy różnych przeciwników; sama nie potwierdza skuteczności tego rynku.'] });
  }
  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || minimum(b.support) - minimum(a.support)
    || minimum(b.recentSupport) - minimum(a.recentSupport) || a.label.localeCompare(b.label, 'pl'));
  const best = candidates.find(candidate => candidate.eligible) || null;
  const status = !full || stale ? 'limited' : 'available';
  return result(status, best ? null : !full ? 'Za mało wcześniejszych meczów do głównego wskazania.' : stale ? 'Historia wymaga aktualizacji przed wyborem kierunku.' : 'Sygnały są mieszane. Porównaj poniższe argumenty i odpuść mecz, jeśli nie znajdziesz potwierdzenia.',
    { teams, candidates, best, line, lineOrigin, notes,
      coverage: { homeSample: homeRows.length, awaySample: awayRows.length, minimumSample: 8, complete: full,
        sourceComplete: analysis.coverage?.complete === true, sharedMatches, stale, observedAt: analysis.observedAt || analysis.cutoff } });
}
