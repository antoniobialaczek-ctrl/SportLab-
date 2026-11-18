import { escapeHTML as esc } from './analysis-view.js';

const DAY = 86400000;
const OPEN_VERDICT = 'Odpuść zakład — brak potwierdzonej przewagi';
const LIMITATIONS = [
  'Brak zweryfikowanego modelu przedmeczowego i aktualnego kursu — nie można ocenić opłacalności zakładu.',
  'Forma nie uwzględnia siły rywali, potwierdzonych składów i kontuzji. Kierunek do sprawdzenia nie jest rekomendacją zakładu.',
];
const integer = value => Number.isInteger(value) && value >= 0;
const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
const countsValid = form => form && integer(form.sample) && ['wins', 'draws', 'losses'].every(key => integer(form[key]))
  && form.wins + form.draws + form.losses === form.sample;
const venueValid = form => countsValid(form) && form.sample >= 3 && form.sample <= 10;
const result = (status, verdict, reasons, candidate = null) => ({ status, verdict, candidate, reasons, limitations: [...LIMITATIONS] });

/** A transparent descriptive watchlist. This function never unlocks a forecast,
 * invents a probability or decides that a bet offers value without a price.
 */
export function assessBetting(analysis, event, { now = Date.now() } = {}) {
  const current = typeof now === 'number' ? now : Date.parse(now);
  const start = Date.parse(event?.date);
  if (!Number.isFinite(current) || !Number.isFinite(start)) return result('unavailable', 'Brak danych do oceny zakładu', ['Nie można potwierdzić terminu spotkania.']);
  if (event.state !== 'pre' || start <= current) return result('closed', 'Brak typu przedmeczowego — mecz już się rozpoczął lub zakończył', ['Nie tworzymy typów po rozpoczęciu spotkania ani na podstawie jego wyniku.']);
  if (start - current > 2 * DAY) return result('pass', OPEN_VERDICT, ['Mecz rozpocznie się za więcej niż 48 godzin. Wróć bliżej terminu, aby sprawdzić aktualne dane.']);
  if (!['nba', 'nhl', 'football', 'tennis'].includes(event.sport) || !analysis || analysis.status !== 'available') return result('unavailable', 'Brak danych do oceny zakładu', ['Brakuje pełnego porównania wcześniejszych wyników obu uczestników.']);

  const cutoff = Date.parse(analysis.cutoff);
  const identityMatches = analysis.sport === event.sport && analysis.route === event.route
    && typeof event.route === 'string' && typeof event.homeId === 'string' && typeof event.awayId === 'string'
    && event.homeId !== event.awayId && analysis.home?.id === event.homeId && analysis.away?.id === event.awayId
    && (!analysis.fixtureId || analysis.fixtureId === event.id);
  if (!identityMatches || !Number.isFinite(cutoff) || cutoff > current || cutoff > start) return result('unavailable', 'Brak danych do oceny zakładu', ['Analiza nie potwierdza właściwych uczestników, ligi lub przedmeczowego punktu odcięcia.']);
  if (current - cutoff > 15 * 60000) return result('pass', OPEN_VERDICT, ['Porównanie ma więcej niż 15 minut. Odśwież dane przed ponownym sprawdzeniem rynku.']);
  if (event.sport === 'tennis') return result('pass', OPEN_VERDICT, ['Sama forma meczowa nie wystarcza do wyboru rynku tenisowego. Brakuje porównania na tej samej nawierzchni i potwierdzonego kontekstu turnieju.']);

  const { home, away } = analysis;
  const formsValid = [home, away].every(form => countsValid(form) && form.sample === 10
    && [form.averageFor, form.averageAgainst, form.averageMargin].every(Number.isFinite)
    && form.averageFor >= 0 && form.averageAgainst >= 0
    && Math.abs(form.averageFor - form.averageAgainst - form.averageMargin) <= 0.03
    && Array.isArray(form.recent) && form.recent.length === 10
    && form.recent.every(row => Number.isFinite(Date.parse(row.date)) && Date.parse(row.date) < cutoff)
    && Number.isFinite(Date.parse(form.lastMatchAt)) && Date.parse(form.lastMatchAt) < cutoff
    && Date.parse(form.lastMatchAt) === Math.max(...form.recent.map(row => Date.parse(row.date)))
    && form.restDays === Math.floor((cutoff - Date.parse(form.lastMatchAt)) / DAY));
  if (!formsValid) return result('pass', OPEN_VERDICT, ['Do wyznaczenia kierunku potrzebujemy po 10 spójnych wcześniejszych meczów każdej strony.']);
  if ([home, away].some(form => current - Date.parse(form.lastMatchAt) > 14 * DAY)) return result('pass', OPEN_VERDICT, ['Ostatni dostępny występ co najmniej jednej strony jest starszy niż 14 dni. Forma może być nieaktualna.']);
  const winsDifference = home.wins - away.wins;
  const marginDifference = home.averageMargin - away.averageMargin;
  if (!analysis.comparison?.sampleComplete || analysis.comparison.formWinsDifference !== winsDifference
    || !Number.isFinite(analysis.comparison.averageMarginDifference)
    || Math.abs(analysis.comparison.averageMarginDifference - marginDifference) > 0.03) return result('pass', OPEN_VERDICT, ['Porównanie formy nie jest kompletne lub spójne.']);
  const side = winsDifference >= 3 ? 'home' : winsDifference <= -3 ? 'away' : null;
  if (!side || Math.sign(winsDifference) !== Math.sign(marginDifference)) return result('pass', OPEN_VERDICT, ['Ostatnie wyniki nie wskazują wyraźnego, zgodnego kierunku: różnica zwycięstw musi wynosić co najmniej 3 na równych próbach, a średnia różnica wyniku musi ją potwierdzać.']);
  const chosen = side === 'home' ? home : away;
  const other = side === 'home' ? away : home;
  if (chosen.averageMargin <= 0 || other.averageMargin >= 0) return result('pass', OPEN_VERDICT, ['Średnie różnice wyników obu stron nie potwierdzają przeciwstawnego obrazu formy.']);
  const venue = chosen.splits?.[side];
  if (!venueValid(home.splits?.home) || !venueValid(away.splits?.away)
    || (event.sport === 'football' ? venue.wins + venue.draws <= venue.losses : venue.wins <= venue.losses)) return result('pass', OPEN_VERDICT, ['Brakuje dostatecznego potwierdzenia formy gospodarzy u siebie i gości na wyjeździe (minimum po 3 mecze).']);
  if (!Number.isFinite(chosen.restDays) || chosen.restDays < 2) return result('pass', OPEN_VERDICT, ['Strona z lepszym bilansem ma mniej niż 2 dni od poprzedniego meczu albo brakuje danych o przerwie.']);

  const name = side === 'home' ? event.home : event.away;
  if (typeof name !== 'string' || !name.trim()) return result('unavailable', 'Brak danych do oceny zakładu', ['Nie można potwierdzić nazwy uczestnika.']);
  const market = event.sport === 'football' ? (side === 'home' ? '1X' : 'X2') : 'winner';
  const label = event.sport === 'football' ? `${name} nie przegra — ${market} (90 minut)`
    : `${name} — zwycięstwo (${event.sport === 'nhl' ? 'z dogrywką i karnymi' : 'z dogrywką'})`;
  const unit = event.sport === 'nba' ? 'punktów' : 'goli';
  return result('watch', OPEN_VERDICT, [
    `${name}: ${chosen.wins} zwycięstw w 10 ostatnich dostępnych meczach; druga strona: ${other.wins} w 10.`,
    `Średnia różnica ${unit}: ${decimal(chosen.averageMargin)} wobec ${decimal(other.averageMargin)}.`,
    `${side === 'home' ? 'U siebie' : 'Na wyjeździe'}: ${venue.wins} zwycięstw, ${venue.draws} remisów i ${venue.losses} porażek w próbie ${venue.sample} meczów.`,
  ], { side, name, market, label });
}

function renderBetting(data, detailed) {
  const candidate = data.candidate ? `<p class="betting-candidate"><span>Rynek do sprawdzenia:</span> <b>${esc(data.candidate.label)}</b></p><p class="small">Kierunek z formy, bez potwierdzenia opłacalności zakładu.</p>` : '';
  const reasons = detailed ? `<ul>${data.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : `<p class="small">${esc(data.reasons[0])}</p>`;
  const limitations = detailed ? `<p class="small">${data.limitations.map(esc).join(' ')}</p><details><summary>Jak wybieramy rynek do sprawdzenia?</summary><p class="small">To jawna reguła opisowa, bez potwierdzonej skuteczności typowania: po 10 wcześniejszych meczów, co najmniej 3 zwycięstwa różnicy, zgodne średnie różnice wyniku i próby dom/wyjazd po minimum 3 mecze. Ostatnie występy nie mogą być starsze niż 14 dni, a wybrana strona potrzebuje minimum 2 dni przerwy. Reguła nie wyznacza prawdopodobieństwa ani kursu granicznego.</p></details>` : '';
  const heading = detailed ? 'h3' : 'h4';
  return `<section class="betting-box ${detailed ? '' : 'compact '}betting-${data.status}"><${heading}>Co warto obstawić?</${heading}><p class="betting-verdict"><b>${esc(data.verdict)}</b></p>${candidate}${reasons}${limitations}</section>`;
}

export function bettingHTML(analysis, event, options) { return renderBetting(assessBetting(analysis, event, options), false); }
export function bettingDetailHTML(analysis, event, options) { return renderBetting(assessBetting(analysis, event, options), true); }
