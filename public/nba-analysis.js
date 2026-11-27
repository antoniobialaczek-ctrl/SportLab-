import { matchPickQuote } from './pick-odds.js';

const DAY = 86400000, ROUTE = 'basketball/nba', SCOPE = 'including_overtime';
const count = value => Number.isInteger(value) && value >= 0;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null; };
const number = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value.slice(0, 10) ? parsed : NaN;
};
const halfLine = value => typeof value === 'number' && Number.isFinite(value) && value >= 1.5 && value <= 599.5 && value % 1 === 0.5;
const share = support => support.sample ? support.hits / support.sample : 0;
const minimum = support => Math.min(share(support.home), share(support.away));
const support = (rows, predicate) => ({ hits: rows.filter(predicate).length, sample: rows.length });

function validRows(form, event, cutoff) {
  if (!form || !count(form.sample) || form.sample < 3 || form.sample > 10 || !Array.isArray(form.recent) || form.recent.length !== form.sample) return null;
  const seen = new Set(), rows = [];
  for (const row of form.recent) {
    if (!row || typeof row.id !== 'string' || !row.id.startsWith(`${ROUTE}:`) || !/^\d{4,14}$/.test(row.id.slice(ROUTE.length + 1))
      || row.id === event.id || seen.has(row.id) || row.route !== ROUTE || !Number.isFinite(time(row.date)) || time(row.date) >= cutoff
      || ![row.scoreFor, row.scoreAgainst].every(value => count(value) && value <= 300) || row.scoreFor === row.scoreAgainst
      || row.scoreScope != null && row.scoreScope !== SCOPE || row.regulationOnly === true
      || row.status != null && row.status !== 'completed'
      || ['observedAt', 'resultAvailableAt'].some(key => row[key] != null && (!Number.isFinite(time(row[key])) || time(row[key]) > cutoff))) return null;
    seen.add(row.id);
    rows.push({ id: row.id, matchId: row.id, route: ROUTE, date: row.date, scoreFor: row.scoreFor, scoreAgainst: row.scoreAgainst,
      total: row.scoreFor + row.scoreAgainst, opponent: typeof row.opponent === 'string' ? row.opponent : '',
      ...(typeof row.isHome === 'boolean' ? { isHome: row.isHome } : {}) });
  }
  rows.sort((a, b) => time(b.date) - time(a.date) || a.id.localeCompare(b.id));
  const wins = rows.filter(row => row.scoreFor > row.scoreAgainst).length;
  const averageFor = mean(rows.map(row => row.scoreFor)), averageAgainst = mean(rows.map(row => row.scoreAgainst));
  if (![form.wins, form.losses, form.draws].every(count) || form.draws !== 0 || form.wins !== wins || form.losses !== rows.length - wins
    || time(form.lastMatchAt) !== time(rows[0].date) || ![form.averageFor, form.averageAgainst, form.averageMargin].every(Number.isFinite)
    || Math.abs(form.averageFor - averageFor) > 0.03 || Math.abs(form.averageAgainst - averageAgainst) > 0.03
    || Math.abs(form.averageMargin - averageFor + averageAgainst) > 0.03) return null;
  return rows;
}

function metrics(rows, line) {
  const totals = rows.map(row => row.total), averageTotal = mean(totals);
  return { sample: rows.length, wins: rows.filter(row => row.scoreFor > row.scoreAgainst).length, losses: rows.filter(row => row.scoreFor < row.scoreAgainst).length,
    averageFor: mean(rows.map(row => row.scoreFor)), averageAgainst: mean(rows.map(row => row.scoreAgainst)), averageTotal,
    averageMargin: mean(rows.map(row => row.scoreFor - row.scoreAgainst)), medianTotal: median(totals),
    totalStdDev: rows.length ? Math.sqrt(mean(totals.map(value => (value - averageTotal) ** 2))) : null,
    minimumTotal: rows.length ? Math.min(...totals) : null, maximumTotal: rows.length ? Math.max(...totals) : null,
    over: rows.filter(row => row.total > line).length, under: rows.filter(row => row.total < line).length };
}

function team(form, rows, side, name, line, cutoff) {
  const venueRows = rows.filter(row => row.isHome === (side === 'home'));
  const hoursSinceLatestStart = (cutoff - time(rows[0].date)) / 3600000;
  return { id: form.id, name, sample: rows.length, overall: metrics(rows, line), last5: metrics(rows.slice(0, 5), line),
    venue: { label: side === 'home' ? 'u siebie' : 'na wyjeździe', reliable: venueRows.length >= 3, ...metrics(venueRows, line) },
    recent: rows, latestDate: rows[0].date, oldestDate: rows.at(-1).date, hoursSinceLatestStart, restDays: Math.floor(hoursSinceLatestStart / 24) };
}

function chooseLine(options, event, current, rows) {
  const matches = line => ['over', 'under'].every(direction => matchPickQuote(options.oddsData, event,
    { kind: 'total', market: 'total_points', scope: SCOPE, line, direction }, { now: current }).status === 'matched');
  if (options.totalLine !== undefined) return halfLine(options.totalLine)
    ? { line: options.totalLine, lineOrigin: options.totalLineOrigin === 'source' && matches(options.totalLine) ? 'source' : 'manual' } : null;
  for (const quote of (Array.isArray(options.oddsData?.quotes) ? options.oddsData.quotes : []).slice(0, 510)) {
    if (quote?.market === 'total_points' && quote.scope === SCOPE && halfLine(quote.line) && matches(quote.line)) return { line: quote.line, lineOrigin: 'source' };
  }
  const referenceAverage = mean(rows.map(row => row.total)), line = Math.floor(referenceAverage) + 0.5;
  return halfLine(line) ? { line, lineOrigin: 'analytical', referenceAverage } : null;
}

function winnerLean(teams, event, options, current, stale) {
  const { home, away } = teams, winShare = metrics => metrics.wins / metrics.sample;
  const samples = { home: home.sample, away: away.sample }, shortSample = Math.min(samples.home, samples.away) < 8;
  const difference = winShare(home.overall) - winShare(away.overall), margin = home.overall.averageMargin - away.overall.averageMargin;
  const recentDifference = winShare(home.last5) - winShare(away.last5), venueKnown = home.venue.reliable && away.venue.reliable;
  const base = { status: 'balanced', kind: 'result', market: 'winner', scope: SCOPE, side: null, name: null,
    label: 'Forma bez zgodnego faworyta', samples, shortSample,
    reasons: [`${home.name}: ${home.overall.wins} zwycięstw i ${home.overall.losses} porażek w ${home.sample} meczach; ${away.name}: ${away.overall.wins} zwycięstw i ${away.overall.losses} porażek w ${away.sample}.`,
      `Średnia różnica punktów: ${number(home.overall.averageMargin)} wobec ${number(away.overall.averageMargin)}.`], counterevidence: [],
    quote: { status: 'unavailable', decimal: null, reason: 'Brak zgodnego kierunku na zwycięstwo.' } };
  if (stale) return { ...base, status: 'unavailable', reasons: ['Ostatni dostępny mecz co najmniej jednej strony jest starszy niż 14 dni.'] };
  const side = difference >= 0.2 - 1e-9 && margin >= 2 ? 'home' : difference <= -0.2 + 1e-9 && margin <= -2 ? 'away' : null;
  if (!side) return { ...base, counterevidence: ['Bilans zwycięstw i różnica punktów nie wskazują zgodnie jednej strony.'] };
  const sign = side === 'home' ? 1 : -1;
  if (sign * recentDifference < 0 || venueKnown && sign * (winShare(home.venue) - winShare(away.venue)) < -0.2 - 1e-9) return { ...base,
    counterevidence: ['Najnowsza forma lub dostateczna próba dom/wyjazd wskazuje przeciwny kierunek.'] };
  const chosen = teams[side], other = teams[side === 'home' ? 'away' : 'home'];
  const pick = { ...base, status: 'lean', side, name: chosen.name, label: `${chosen.name} — kierunek na zwycięstwo (z dogrywką)`,
    reasons: [`${chosen.name}: ${chosen.overall.wins} zwycięstw w ${chosen.sample} meczach; rywal: ${other.overall.wins} w ${other.sample}.`,
      `${chosen.name} zdobywa średnio ${number(chosen.overall.averageFor)} pkt i traci ${number(chosen.overall.averageAgainst)} pkt; średnia różnica ${number(chosen.overall.averageMargin)} wobec ${number(other.overall.averageMargin)} u rywala.`,
      `Ostatnie ${chosen.last5.sample} mecze: ${chosen.last5.wins} zwycięstw; rywal: ${other.last5.wins} w ${other.last5.sample}.`],
    counterevidence: [`${chosen.name}: ${chosen.overall.losses} porażek w ${chosen.sample} wcześniejszych meczach.`,
      ...(shortSample ? [`Krótka próba: ${samples.home} i ${samples.away} meczów. To wstępny kierunek z formy.`] : []),
      ...(!venueKnown ? ['Brakuje po 3 potwierdzonych meczów do porównania dom/wyjazd.'] : []),
      ...(chosen.hoursSinceLatestStart < 48 ? [`Od początku ostatniego dostępnego meczu ${chosen.name} upłynęło ${number(chosen.hoursSinceLatestStart)} godzin do odczytu; to opis terminarza, bez pomiaru zmęczenia.`] : []),
      'Brak potwierdzonej korekty na składy, kontuzje i siłę rywali.'],
  };
  pick.quote = matchPickQuote(options.oddsData, event, pick, { now: current });
  return pick;
}

/** Transparent comparison of verified earlier NBA results, not a calibrated
 * forecast. Price filters never suppress facts or substitute another market.
 */
export function buildNBAAnalysis(analysis, event, options = {}) {
  const current = options.now == null ? Date.now() : typeof options.now === 'number' ? options.now : Date.parse(options.now);
  const start = time(event?.date), cutoff = time(analysis?.cutoff);
  const result = (status, reason, extra = {}) => ({ sport: 'nba', route: ROUTE, fixtureId: event?.id, scope: SCOPE,
    status, reason, teams: null, winnerLean: null, best: null, candidates: [], notes: [], coverage: null, ...extra });
  if (!Number.isFinite(current) || !Number.isFinite(start)) return result('unavailable', 'Nie można potwierdzić terminu meczu.');
  if (event.state !== 'pre' || start <= current) return result('closed', 'Mecz rozpoczęty; analiza nie tworzy wskazania przedmeczowego.');
  if (start - current > 2 * DAY) return result('unavailable', 'Porównanie dostępne w ciągu 48 godzin przed meczem.');
  if (event.sport !== 'nba' || event.route !== ROUTE || typeof event.id !== 'string' || !/^basketball\/nba:\d{4,14}$/.test(event.id)
    || ![event.homeId, event.awayId].every(id => typeof id === 'string' && /^\d{1,14}$/.test(id)) || event.homeId === event.awayId
    || ![event.home, event.away].every(name => typeof name === 'string' && name.trim() && name.length <= 200)
    || !analysis || !['available', 'partial'].includes(analysis.status) || analysis.sport !== 'nba' || analysis.route !== ROUTE
    || analysis.fixtureId != null && analysis.fixtureId !== event.id || analysis.home?.id !== event.homeId || analysis.away?.id !== event.awayId
    || !Number.isFinite(cutoff) || cutoff > current || cutoff >= start
    || analysis.observedAt != null && (!Number.isFinite(time(analysis.observedAt)) || time(analysis.observedAt) > cutoff)) return result('unavailable', 'Historia nie potwierdza właściwego meczu, drużyn lub czasu odczytu.');
  if (current - cutoff > 15 * 60000) return result('unavailable', 'Odczyt historii ma ponad 15 minut. Odśwież analizę.');
  const homeRows = validRows(analysis.home, event, cutoff), awayRows = validRows(analysis.away, event, cutoff);
  if (!homeRows || !awayRows) return result('unavailable', 'Potrzeba co najmniej 3 spójnych wcześniejszych wyników NBA każdej drużyny.');
  const unique = new Map(homeRows.map(row => [row.id, row]));
  let sharedMatches = 0;
  for (const row of awayRows) {
    const prior = unique.get(row.id);
    if (prior && (time(prior.date) !== time(row.date) || prior.scoreFor !== row.scoreAgainst || prior.scoreAgainst !== row.scoreFor
      || typeof prior.isHome === 'boolean' && typeof row.isHome === 'boolean' && prior.isHome === row.isHome)) return result('unavailable', 'Wspólne spotkanie ma sprzeczny wynik lub role drużyn.');
    if (prior) sharedMatches++; else unique.set(row.id, row);
  }
  const selected = chooseLine(options, event, current, [...unique.values()]);
  if (!selected) return result('unavailable', 'Linia sumy punktów musi mieć połówkę i mieścić się od 1,5 do 599,5.');
  const { line, lineOrigin } = selected, teams = { home: team(analysis.home, homeRows, 'home', event.home, line, cutoff), away: team(analysis.away, awayRows, 'away', event.away, line, cutoff) };
  const full = homeRows.length >= 8 && awayRows.length >= 8, stale = [teams.home, teams.away].some(team => current - time(team.latestDate) > 14 * DAY);
  const notes = ['Oficjalne końcowe wyniki NBA z dogrywką. Porównanie opisuje wcześniejsze mecze; nie wyznacza szansy wygranej ani opłacalności.',
    'Nie uwzględniono potwierdzonej korekty na siłę rywali, składy i kontuzje. Suma punktów nie jest miarą liczby posiadań ani tempa gry.'];
  if (!full) notes.push('Krótka próba: mniej niż 8 meczów co najmniej jednej drużyny. Faworyt z formy pozostaje wstępnym porównaniem.');
  if (stale) notes.push('Ostatni dostępny mecz co najmniej jednej strony ma ponad 14 dni. Brak aktywnego kierunku.');
  if (sharedMatches) notes.push(`Wspólne spotkania w obu próbach: ${sharedMatches}. W średniej referencyjnej każdy taki mecz liczony jest raz.`);
  if (analysis.coverage?.complete !== true) notes.push('Źródło nie potwierdza kompletności wszystkich spotkań sezonu.');
  const venueRows = { home: homeRows.filter(row => row.isHome === true), away: awayRows.filter(row => row.isHome === false) }, candidates = [];
  function add(descriptor, homePredicate, awayPredicate, { gate = true, trend = true, extraReasons = [], extraCounter = [] } = {}) {
    const overall = { home: support(homeRows, homePredicate), away: support(awayRows, awayPredicate) };
    const recentSupport = { home: support(homeRows.slice(0, 5), homePredicate), away: support(awayRows.slice(0, 5), awayPredicate) };
    const venueSupport = { home: support(venueRows.home, homePredicate), away: support(venueRows.away, awayPredicate) };
    const recentAgainst = minimum(recentSupport) < 0.6 || !trend, venueAgainst = Object.values(venueSupport).some(value => value.sample >= 3 && share(value) < 0.5);
    const aligned = gate && minimum(overall) >= 0.6 && !recentAgainst && !venueAgainst;
    const counterevidence = [`Przeciw kierunkowi: ${event.home} ${overall.home.sample - overall.home.hits}/${overall.home.sample}; ${event.away} ${overall.away.sample - overall.away.hits}/${overall.away.sample} wcześniejszych wyników.`, ...extraCounter];
    if (recentAgainst) counterevidence.push('Ostatnie 5 wyników lub ich średnie nie potwierdzają zgodnie kierunku.');
    if (venueAgainst) counterevidence.push('Próba dom/wyjazd co najmniej jednej strony wskazuje przeciwny obraz.');
    if (!teams.home.venue.reliable || !teams.away.venue.reliable) counterevidence.push('Próba dom/wyjazd poniżej 3 meczów co najmniej jednej strony.');
    if (!gate) counterevidence.push('Bilans zwycięstw i różnica punktów nie wskazują tej strony.');
    const pick = { ...descriptor, scope: SCOPE, support: overall, recentSupport, venueSupport,
      reasons: [`${event.home}: ${overall.home.hits}/${overall.home.sample}; ${event.away}: ${overall.away.hits}/${overall.away.sample} wcześniejszych wyników zgodnych z kierunkiem.`, ...extraReasons],
      counterevidence, signal: aligned ? 'aligned' : minimum(overall) >= 0.5 ? 'mixed' : 'weak', eligible: full && !stale && aligned };
    pick.quote = matchPickQuote(options.oddsData, event, pick, { now: current }); candidates.push(pick);
  }
  const lean = winnerLean(teams, event, options, current, stale);
  for (const side of ['home', 'away']) {
    const chosen = teams[side], other = teams[side === 'home' ? 'away' : 'home'], isHome = side === 'home';
    add({ kind: 'result', market: 'winner', side, label: `${chosen.name} — zwycięstwo (z dogrywką)` },
      row => isHome ? row.scoreFor > row.scoreAgainst : row.scoreFor < row.scoreAgainst,
      row => isHome ? row.scoreFor < row.scoreAgainst : row.scoreFor > row.scoreAgainst,
      { gate: lean.status === 'lean' && lean.side === side, extraReasons: [
        `${chosen.name}: średnio ${number(chosen.overall.averageFor)} pkt zdobytych i ${number(chosen.overall.averageAgainst)} pkt straconych; różnica ${number(chosen.overall.averageMargin)} wobec ${number(other.overall.averageMargin)}.`,
        `Ostatnie ${chosen.last5.sample}: ${chosen.last5.wins} zwycięstw; rywal ${other.last5.wins}/${other.last5.sample}.`],
      extraCounter: ['Rywale w historycznych próbach byli różni; sama forma nie potwierdza skuteczności prognozy.'] });
  }
  for (const direction of ['over', 'under']) {
    const over = direction === 'over', predicate = row => over ? row.total > line : row.total < line;
    const trend = [teams.home, teams.away].every(team => over ? team.last5.averageTotal > line : team.last5.averageTotal < line);
    add({ kind: 'total', market: 'total_points', direction, line, lineOrigin, label: `${over ? 'Powyżej' : 'Poniżej'} ${number(line)} punktu w meczu (z dogrywką)` }, predicate, predicate,
      { trend, extraReasons: [`Średnie sumy punktów: ${number(teams.home.overall.averageTotal)} i ${number(teams.away.overall.averageTotal)}; ostatnie 5: ${number(teams.home.last5.averageTotal)} i ${number(teams.away.last5.averageTotal)}.`,
        `Mediany: ${number(teams.home.overall.medianTotal)} i ${number(teams.away.overall.medianTotal)}; odchylenia sum: ${number(teams.home.overall.totalStdDev)} i ${number(teams.away.overall.totalStdDev)} pkt.`,
        lineOrigin === 'source' ? 'To dokładna linia z dopasowanego odczytu kursów obu kierunków.' : lineOrigin === 'manual' ? 'To Twoja linia; cena wymaga dopasowania do dokładnie tego progu.' : 'Linia referencyjna to średnia historycznych sum zaokrąglona do połówki. Nie jest ofertą bukmachera.'],
      extraCounter: [`Zakresy wcześniejszych sum: ${teams.home.overall.minimumTotal}–${teams.home.overall.maximumTotal} i ${teams.away.overall.minimumTotal}–${teams.away.overall.maximumTotal} pkt.`,
        'Brakuje danych do potwierdzenia liczby posiadań, aktualnych składów i wpływu kontuzji.'] });
  }
  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || minimum(b.support) - minimum(a.support)
    || minimum(b.recentSupport) - minimum(a.recentSupport) || a.label.localeCompare(b.label, 'pl'));
  const best = candidates.find(candidate => candidate.eligible) || null;
  return result(!full || stale ? 'limited' : 'available', best ? null : stale ? 'Historia wymaga aktualizacji.' : !full ? 'Wstępna analiza z krótszej próby.' : 'Wyniki dają rozbieżne sygnały; sprawdź argumenty przy każdym rynku.',
    { teams, winnerLean: lean, best, candidates, line, lineOrigin, referenceAverage: mean([...unique.values()].map(row => row.total)), notes,
      coverage: { homeSample: homeRows.length, awaySample: awayRows.length, minimumSample: 8, complete: full, sourceComplete: analysis.coverage?.complete === true,
        stale, sharedMatches, observedAt: analysis.observedAt || analysis.cutoff } });
}
