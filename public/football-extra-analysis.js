const DAY = 86400000;
const ROUTES = new Set(['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/usa.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1']);
const DEFINITIONS = [
  { key: 'corners', label: 'Rzuty rożne', market: 'total_corners_90', unit: 'rzutu rożnego', defaultLine: 9.5, maximum: 99.5, cap: 50 },
  { key: 'yellowCards', label: 'Żółte kartki — licznik ESPN', market: 'total_yellow_cards_90', unit: 'żółtej kartki wg ESPN', defaultLine: 3.5, maximum: 59.5, cap: 30 },
  { key: 'shots', label: 'Strzały łącznie', market: 'total_shots_90', unit: 'strzału', defaultLine: 23.5, maximum: 199.5, cap: 100 },
  { key: 'shotsOnTarget', label: 'Strzały celne', market: 'total_shots_on_target_90', unit: 'strzału celnego', defaultLine: 7.5, maximum: 99.5, cap: 50 },
];
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) return NaN;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value.slice(0, 10) ? stamp : NaN;
};
const numericId = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const named = value => typeof value === 'string' && value.trim() && value.length <= 200;
const integer = value => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null; };
const quote = () => ({ status: 'unavailable', decimal: null, reason: 'Sprawdź kurs i zasady dokładnie tego rynku u bukmachera. Źródło nie dostarcza tu zweryfikowanej ceny.' });
const share = support => support.sample ? support.hits / support.sample : 0;
const minimum = support => Math.min(share(support.home), share(support.away));
const count = (rows, predicate) => ({ hits: rows.filter(predicate).length, sample: rows.length });

function verifiedRows(team, event, side, observed) {
  if (!team || team.id !== event[`${side}Id`] || !Array.isArray(team.matches) || team.matches.length > 10
    || team.sample != null && team.sample !== team.matches.length) return null;
  const ids = new Set(), rows = [];
  for (const row of team.matches) {
    const at = time(row?.date), fetched = time(row?.sourceFetchedAt);
    if (!row || typeof row.matchId !== 'string' || !row.matchId.startsWith(`${event.route}:`)
      || !/^\d{4,14}$/.test(row.matchId.slice(event.route.length + 1)) || row.matchId === event.id || ids.has(row.matchId)
      || row.route !== event.route || row.scope !== 'regulation_90' || row.regulationOnly === false
      || !Number.isFinite(at) || at >= observed || at >= time(event.date) || !Number.isFinite(fetched) || fetched > observed || fetched <= at
      || typeof row.isHome !== 'boolean' || !named(row.opponent) || !row.stats || typeof row.stats !== 'object' || Array.isArray(row.stats)) return null;
    ids.add(row.matchId); rows.push(row);
  }
  return rows.sort((a, b) => time(b.date) - time(a.date) || a.matchId.localeCompare(b.matchId));
}

function valuesFor(row, definition) {
  const value = row.stats[definition.key];
  if (!value || ![value.own, value.opponent].every(number => integer(number) && number <= definition.cap)) return null;
  if (definition.key === 'shotsOnTarget' && row.stats.shots
    && [row.stats.shots.own, row.stats.shots.opponent].every(number => integer(number) && number <= 100)
    && (value.own > row.stats.shots.own || value.opponent > row.stats.shots.opponent)) return null;
  return { own: value.own, against: value.opponent };
}

function summarize(rows, line) {
  const totals = rows.map(row => row.total), averageTotal = mean(totals);
  return { sample: rows.length, averageOwn: mean(rows.map(row => row.own)), averageAgainst: mean(rows.map(row => row.against)), averageTotal,
    medianTotal: median(totals), totalStdDev: rows.length ? Math.sqrt(mean(totals.map(value => (value - averageTotal) ** 2))) : null,
    minimumTotal: rows.length ? Math.min(...totals) : null, maximumTotal: rows.length ? Math.max(...totals) : null,
    over: totals.filter(value => value > line).length, under: totals.filter(value => value < line).length };
}
function teamSummary(rows, side, definition, line) {
  const recent = rows.flatMap(row => {
    const value = valuesFor(row, definition);
    return value ? [{ matchId: row.matchId, date: row.date, opponent: row.opponent, isHome: row.isHome,
      own: value.own, against: value.against, total: value.own + value.against }] : [];
  });
  const venue = recent.filter(row => row.isHome === (side === 'home'));
  return { ...summarize(recent, line), last5: summarize(recent.slice(0, 5), line),
    venue: { ...summarize(venue, line), reliable: venue.length >= 3, label: side === 'home' ? 'u siebie' : 'na wyjeździe' },
    latestDate: recent[0]?.date || null, oldestDate: recent.at(-1)?.date || null, recent };
}

/** Current descriptive comparisons of source statistics. No quote, probability,
 * automatic journal settlement or betting-points definition is inferred.
 */
export function buildFootballExtraAnalysis(data, event, options = {}) {
  const now = options.now == null ? Date.now() : typeof options.now === 'number' ? options.now : Date.parse(options.now);
  const start = time(event?.date), observed = time(data?.observedAt);
  const result = (status, reason, extra = {}) => ({ sport: 'football', route: event?.route, fixtureId: event?.id,
    scope: 'regulation_90', status, reason, metrics: [], notes: [], ...extra });
  if (!Number.isFinite(now) || !Number.isFinite(start)) return result('unavailable', 'Nie można potwierdzić terminu spotkania.');
  if (event.state !== 'pre' || start <= now) return result('closed', 'Mecz rozpoczęty; porównanie przedmeczowe jest zamknięte.');
  if (event.route === 'soccer/pol.1') return result('unavailable', 'Źródło Ekstraklasy nie dostarcza potwierdzonych dodatkowych statystyk do tego porównania.');
  if (start - now > 2 * DAY || event.sport !== 'football' || !ROUTES.has(event.route)
    || !numericId(event.homeId) || !numericId(event.awayId) || event.homeId === event.awayId || !named(event.home) || !named(event.away)
    || typeof event.id !== 'string' || !event.id.startsWith(`${event.route}:`) || !/^\d{4,14}$/.test(event.id.slice(event.route.length + 1))
    || !data || data.sport !== 'football' || data.route !== event.route || data.fixtureId !== event.id
    || data.homeId !== event.homeId || data.awayId !== event.awayId || time(data.fixtureStart) !== start
    || data.scope !== 'regulation_90' || data.currentDescriptive !== true || data.modelExperimentEligible !== false
    || !['available', 'partial'].includes(data.status) || !Number.isFinite(observed) || observed > now || observed >= start
    || time(data.fetchedAt) !== observed) return result('unavailable', data?.status === 'unavailable' && typeof data.reason === 'string' ? data.reason : 'Dane nie potwierdzają właściwego meczu, drużyn i statystyk po 90 minutach.');
  if (now - observed > 15 * 60000) return result('unavailable', 'Odśwież statystyki: odczyt ma ponad 15 minut.');
  if (options.lines != null && (typeof options.lines !== 'object' || Array.isArray(options.lines))) return result('unavailable', 'Nieprawidłowy zestaw linii porównania.');
  const rows = { home: verifiedRows(data.teams?.home, event, 'home', observed), away: verifiedRows(data.teams?.away, event, 'away', observed) };
  if (!rows.home || !rows.away) return result('unavailable', 'Historia zawiera niepotwierdzoną ligę, zakres, czas lub powielony mecz.');
  const shared = new Map(rows.home.map(row => [row.matchId, row]));
  const common = rows.away.filter(row => shared.has(row.matchId));
  for (const row of common) {
    const other = shared.get(row.matchId);
    if (time(row.date) !== time(other.date) || row.isHome === other.isHome) return result('unavailable', 'Wspólne spotkanie ma sprzeczną datę lub role drużyn.');
    for (const definition of DEFINITIONS) {
      const first = valuesFor(other, definition), second = valuesFor(row, definition);
      if (first && second && (first.own !== second.against || first.against !== second.own)) return result('unavailable', 'Wspólne spotkanie ma sprzeczne statystyki obu drużyn.');
    }
  }
  const metrics = DEFINITIONS.map(definition => {
    const manual = options.lines != null && Object.hasOwn(options.lines, definition.key), line = manual ? options.lines[definition.key] : definition.defaultLine;
    const base = { key: definition.key, label: definition.label, market: definition.market, scope: 'regulation_90', line,
      lineOrigin: manual ? 'manual' : 'analytical', minimum: 0.5, maximum: definition.maximum, step: 1, best: null, candidates: [],
      settlementVerified: false, comparisonOnly: true, quote: quote() };
    if (typeof line !== 'number' || !Number.isFinite(line) || line < 0.5 || line > definition.maximum || line % 1 !== 0.5) {
      return { ...base, status: 'unavailable', reason: `Podaj linię połówkową od 0,5 do ${decimal(definition.maximum)}.`, home: null, away: null, coverage: { reason: 'Nieprawidłowa linia.' } };
    }
    const home = teamSummary(rows.home, 'home', definition, line), away = teamSummary(rows.away, 'away', definition, line);
    const enough = home.sample >= 3 && away.sample >= 3, full = home.sample >= 8 && away.sample >= 8;
    const stale = [home, away].some(team => !team.latestDate || now - time(team.latestDate) > 30 * DAY);
    const reason = !enough ? 'Brakuje co najmniej 3 kompletnych obserwacji tej statystyki każdej drużyny.'
      : stale ? 'Ostatnia dostępna obserwacja tej statystyki ma ponad 30 dni.' : !full ? 'Krótka próba: mniej niż 8 obserwacji tej statystyki co najmniej jednej drużyny.' : null;
    const candidates = enough ? ['over', 'under'].map(direction => {
      const over = direction === 'over', predicate = row => over ? row.total > line : row.total < line;
      const support = { home: count(home.recent, predicate), away: count(away.recent, predicate) };
      const recentSupport = { home: count(home.recent.slice(0, 5), predicate), away: count(away.recent.slice(0, 5), predicate) };
      const venueSupport = { home: count(home.recent.filter(row => row.isHome), predicate), away: count(away.recent.filter(row => !row.isHome), predicate) };
      const trend = [home, away].every(team => over ? team.last5.averageTotal > line : team.last5.averageTotal < line);
      const recentAgainst = minimum(recentSupport) < 0.6 || !trend;
      const venueAgainst = Object.values(venueSupport).some(value => value.sample >= 3 && share(value) < 0.5);
      const aligned = minimum(support) >= 0.6 && !recentAgainst && !venueAgainst;
      return { kind: 'total', market: definition.market, scope: 'regulation_90', metric: definition.key, direction, line, lineOrigin: base.lineOrigin,
        label: `${over ? 'Powyżej' : 'Poniżej'} ${decimal(line)} ${definition.unit} w meczu (90 minut)`,
        signal: aligned ? 'aligned' : minimum(support) >= 0.5 ? 'mixed' : 'weak', eligible: full && !stale && aligned,
        support, recentSupport, venueSupport,
        reasons: [`${event.home}: ${support.home.hits}/${support.home.sample}; ${event.away}: ${support.away.hits}/${support.away.sample} wcześniejszych sum zgodnych z kierunkiem.`,
          `Ostatnie ${home.last5.sample} i ${away.last5.sample}: ${recentSupport.home.hits}/${recentSupport.home.sample} oraz ${recentSupport.away.hits}/${recentSupport.away.sample}; średnie sumy ${decimal(home.last5.averageTotal)} i ${decimal(away.last5.averageTotal)}.`,
          manual ? 'Porównano Twoją dokładną linię.' : `Stała linia referencyjna ${decimal(line)}; nie dobierano łatwiejszego progu dla poprawy liczników.`],
        counterevidence: [`Przeciw kierunkowi: ${event.home} ${home.sample - support.home.hits}/${home.sample}; ${event.away} ${away.sample - support.away.hits}/${away.sample}.`,
          `Zakresy wcześniejszych sum: ${home.minimumTotal}–${home.maximumTotal} oraz ${away.minimumTotal}–${away.maximumTotal}.`,
          ...(recentAgainst ? ['Ostatnie wyniki lub ich średnie nie potwierdzają zgodnie kierunku obu drużyn.'] : []),
          ...(venueAgainst ? ['Co najmniej jedna próba dom/wyjazd ma przeciwny obraz.'] : []),
          ...(!home.venue.reliable || !away.venue.reliable ? ['Brakuje po 3 obserwacji do pełnego porównania dom/wyjazd.'] : []),
          definition.key === 'yellowCards' ? 'Nie zweryfikowano sposobu liczenia drugiej żółtej, czerwonych kartek ani punktów kartkowych u bukmachera; to osobny licznik ESPN.' : 'Przebieg meczu, składy i siła rywali nie zostały skorygowane w tym porównaniu.'],
        quote: quote(), settlementVerified: false, comparisonOnly: true };
    }) : [];
    candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || minimum(b.support) - minimum(a.support));
    return { ...base, home, away, candidates, best: candidates.find(candidate => candidate.eligible) || null,
      status: !enough ? 'unavailable' : !full || stale ? 'limited' : 'available', reason,
      coverage: { reason, homeSample: home.sample, awaySample: away.sample, requestedHomeMatches: rows.home.length, requestedAwayMatches: rows.away.length,
        missingHome: rows.home.length - home.sample, missingAway: rows.away.length - away.sample, minimumSample: 8, stale, sharedMatches: common.length } };
  });
  const available = metrics.some(metric => metric.status === 'available'), factual = metrics.some(metric => metric.home?.sample || metric.away?.sample);
  const notes = ['Statystyki i sumy dotyczą 90 minut z doliczonym czasem, bez dogrywki i karnych. Liczniki opisują historię, bez potwierdzonej skuteczności prognoz.',
    'Linie referencyjne są stałe lub wpisane ręcznie. Nie są ofertą bukmachera; nie wyliczamy prawdopodobieństw, kursu uczciwego ani opłacalności.',
    'Żółte kartki to licznik ESPN, nie suma żółtych i czerwonych ani punkty kartkowe. Reguły drugiej żółtej i rozliczenia rynku wymagają sprawdzenia.',
    'Rożne, strzały i kartki mogą być rozliczane przez bukmachera według innej definicji niż statystyka źródła. Brak kursu nie jest zastępowany ceną innego rynku.',
    'Porównanie nie koryguje wpływu sędziego, składów, fazy meczu ani siły wcześniejszych rywali.'];
  if (common.length) notes.push(`W obu próbach występuje ${common.length} wspólnych spotkań. Te obserwacje nie są niezależne.`);
  return result(available ? 'available' : factual ? 'limited' : 'unavailable', available ? null : factual ? 'Dostępna jest częściowa historia dodatkowych statystyk.' : 'Źródło nie udostępniło kompletnych dodatkowych statystyk.',
    { metrics, notes, observedAt: data.observedAt, sourceComplete: false, modelExperimentEligible: false, currentDescriptive: true });
}
