import { escapeHTML as esc } from './analysis-view.js';
import { matchPickQuote, pickOddsHTML } from './pick-odds.js';

const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pl-PL', { maximumFractionDigits: 1 }) : '—';
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const ratio = value => count(value?.hits) !== null && count(value?.sample) !== null && value.sample > 0 && value.hits <= value.sample ? `${value.hits}/${value.sample}` : '—';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit' }) : '—';
const texts = (values, limit = 6) => (Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()).slice(0, limit);
const list = (values, className, limit = 4) => {
  const items = texts(values, limit);
  return items.length ? `<ul class="${className}">${items.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : '';
};
const statusLabels = { available: 'Forma i punkty', limited: 'Ograniczona historia', unavailable: 'Brak porównywalnych danych', closed: 'Mecz rozpoczęty', loading: 'Wczytywanie analizy' };
const signals = { aligned: 'Zgodny kierunek', mixed: 'Sygnały mieszane', weak: 'Słabe wsparcie' };
const METHOD = 'Porównanie wcześniejszych wyników NBA z dogrywką. Skuteczność prognoz nie została potwierdzona.';

function bound(result, event) {
  return event?.sport === 'nba' && event.route === 'basketball/nba' && result?.sport === 'nba' && result.route === event.route
    && result.fixtureId === event.id && ['available', 'limited', 'unavailable', 'closed'].includes(result.status);
}
function price(pick, event, options) {
  return matchPickQuote(options.oddsData, event, pick, { now: options.now ?? Date.now() }).status === 'matched'
    ? pickOddsHTML(options.oddsData, event, pick, { now: options.now ?? Date.now() })
    : '<span class="nba-no-price">Sprawdź kurs na ten rynek</span>';
}
function support(pick, event) {
  return `<p class="nba-support">${esc(event.home)}: <b>${ratio(pick.support?.home)}</b> · ${esc(event.away)}: <b>${ratio(pick.support?.away)}</b><small>wcześniejszych wyników zgodnych z kierunkiem</small></p>`;
}
function explanation(pick, compact) {
  return `<div class="nba-explanation"><b>Co wspiera typ?</b>${list(pick.reasons, 'nba-reasons', compact ? 3 : 5)}</div><div class="nba-counter"><b>Co może przeszkodzić?</b>${list(pick.counterevidence, 'nba-counter-list', compact ? 1 : 4)}</div>`;
}
function winner(result, event, options) {
  const lean = result.winnerLean, heading = options.compact ? 'h5' : 'h4';
  if (!['available', 'limited'].includes(result.status) || result.coverage?.stale || !lean || !['lean', 'balanced'].includes(lean.status)) return '';
  if (lean.status === 'balanced') return `<section class="nba-direction nba-neutral" data-nba-winner><p class="nba-eyebrow">Kto ma lepszą formę?</p><${heading}>Brak wyraźnego faworyta na zwycięstwo</${heading}>${list(lean.reasons, 'nba-reasons', 3)}${list(lean.counterevidence, 'nba-counter-list', 2)}<p class="nba-method">${METHOD}</p></section>`;
  if (!['home', 'away'].includes(lean.side) || lean.name !== event[lean.side] || lean.market !== 'winner' || lean.scope !== 'including_overtime') return '';
  return `<section class="nba-direction" data-nba-winner><div class="nba-direction-heading"><div><p class="nba-eyebrow">Faworyt z formy${lean.shortSample ? ' · wstępny kierunek' : ''}</p><${heading}>${esc(lean.name)} — kierunek na zwycięstwo</${heading}></div>${price(lean, event, options)}</div>${explanation(lean, options.compact)}${lean.shortSample ? `<p class="nba-sample-note">Krótka próba. Liczba meczów: ${esc(event.home)} — ${count(lean.samples?.home) ?? '—'}; ${esc(event.away)} — ${count(lean.samples?.away) ?? '—'}.</p>` : ''}<p class="nba-method">${METHOD}</p></section>`;
}
function lead(result, event, options) {
  const winnerHTML = winner(result, event, options);
  const best = result.status === 'available' && result.best?.eligible === true ? result.best : null;
  if (winnerHTML && (!best || best.market === 'winner' && best.side === result.winnerLean.side)) return winnerHTML;
  const heading = options.compact ? 'h5' : 'h4';
  if (best) return `${winnerHTML}<section class="nba-direction" data-nba-verdict><div class="nba-direction-heading"><div><p class="nba-eyebrow">${winnerHTML ? 'Suma punktów — kierunek z historii' : 'Najlepiej wsparty kierunek w historii'}</p><${heading}>${esc(best.label)}</${heading}></div>${price(best, event, options)}</div>${support(best, event)}${explanation(best, options.compact)}<p class="nba-method">${METHOD}</p></section>`;
  const titles = { loading: 'Porównywanie formy i punktów…', closed: 'Wskazania przedmeczowe są zamknięte', unavailable: 'Brak danych do wskazania kierunku', limited: result.coverage?.stale ? 'Historia wymaga odświeżenia' : 'Dostępna jest krótka historia' };
  return `<section class="nba-direction nba-neutral" data-nba-verdict><p class="nba-eyebrow">Wniosek z analizy</p><${heading}>${titles[result.status] || 'Sygnały na wynik i punkty są mieszane'}</${heading}><p>${esc(result.reason || 'Porównaj aktualne wyniki i argumenty obu drużyn poniżej.')}</p></section>`;
}
function metric(label, stats, recent, key) {
  return `<tr><th scope="row">${label}</th><td>${number(stats?.[key])}</td><td>${number(recent?.[key])}</td></tr>`;
}
function team(team, name, side, detail) {
  const stats = team?.overall, last5 = team?.last5, venue = team?.venue;
  if (!stats || !Number.isInteger(stats.sample) || stats.sample < 1) return `<section class="nba-team"><h4>${esc(name)}</h4><p class="small">Brak potwierdzonej historii tej drużyny.</p></section>`;
  const recent = (Array.isArray(team.recent) ? team.recent : []).filter(row => Number.isInteger(row.scoreFor) && Number.isInteger(row.scoreAgainst)).slice(0, 5);
  const venueOK = Number.isInteger(venue?.sample) && venue.sample >= 3 && venue.reliable !== false;
  return `<section class="nba-team nba-team-${side}"><h4>${esc(name)}</h4><p class="nba-team-date">Ostatnie ${stats.sample} meczów · najnowszy ${esc(date(team.latestDate || recent[0]?.date))}</p><p class="nba-balance"><b>${count(stats.wins) ?? '—'} zwycięstw · ${count(stats.losses) ?? '—'} porażek</b></p><table class="nba-metrics"><caption>Punkty na mecz, z dogrywką</caption><thead><tr><th scope="col">Średnia</th><th scope="col">${stats.sample} meczów</th><th scope="col">Ostatnie ${count(last5?.sample) ?? '—'}</th></tr></thead><tbody>${metric('Zdobyte', stats, last5, 'averageFor')}${metric('Stracone', stats, last5, 'averageAgainst')}${metric('Różnica wyniku', stats, last5, 'averageMargin')}${metric('Suma obu drużyn', stats, last5, 'averageTotal')}</tbody></table>${detail ? `<p class="nba-spread">Mediana sumy: <b>${number(stats.medianTotal)}</b> pkt · rozrzut sum (odchylenie): <b>${number(stats.totalStdDev)}</b> pkt.</p>` : ''}<p class="nba-venue">${side === 'home' ? 'U siebie' : 'Na wyjeździe'}: ${venueOK ? `<b>${venue.wins}Z ${venue.losses}P</b> w ${venue.sample} meczach${detail ? ` · średnio ${number(venue.averageFor)} zdobytych / ${number(venue.averageAgainst)} straconych pkt` : ''}` : 'mniej niż 3 potwierdzone mecze — bez osobnego wniosku.'}</p>${detail && Number.isFinite(team.hoursSinceLatestStart) ? `<p class="nba-rest">Od początku ostatniego dostępnego meczu do odczytu: ${number(team.hoursSinceLatestStart)} h. To nie jest czas od zakończenia meczu ani pełne obciążenie terminarza.</p>` : ''}${recent.length ? `<ol class="nba-recent" aria-label="Ostatnie wyniki ${esc(name)}, od najnowszego">${recent.map(row => `<li title="${esc(`${date(row.date)} · ${row.opponent || 'Rywal niepodany'}`)}"><span>${esc(date(row.date))}</span><b>${row.scoreFor}:${row.scoreAgainst}</b></li>`).join('')}</ol>` : ''}</section>`;
}
function comparison(result, event, options) {
  const candidates = (Array.isArray(result.candidates) ? result.candidates : []).filter(pick => pick && typeof pick.label === 'string');
  if (!candidates.length) return '';
  const recent = pick => pick.recentSupport ? `<p class="nba-recent-support">Ostatnie 5: ${esc(event.home)} ${ratio(pick.recentSupport.home)} · ${esc(event.away)} ${ratio(pick.recentSupport.away)}</p>` : '';
  return `<details class="nba-market-comparison"><summary>Porównaj zwycięzcę oraz sumę punktów</summary><p class="nba-market-note">Liczniki pokazują zgodność wcześniejszych wyników z dokładną linią. Nie są prognozą szans.</p><div class="nba-market-grid">${candidates.map(pick => `<section class="nba-market" data-nba-market="${esc(pick.market || '')}"><div class="nba-market-heading"><h5>${esc(pick.label)}</h5><span class="nba-signal nba-signal-${['aligned', 'mixed', 'weak'].includes(pick.signal) ? pick.signal : 'weak'}">${esc(signals[pick.signal] || 'Do porównania')}</span></div>${support(pick, event)}${recent(pick)}${price(pick, event, options)}${explanation(pick, true)}</section>`).join('')}</div></details>`;
}
function render(result, event, options, detail) {
  if (event?.sport !== 'nba' || event.route !== 'basketball/nba') return '';
  const safe = bound(result, event) ? result : result?.status === 'loading' ? { status: 'loading', reason: texts([result.reason], 1)[0] || 'Sprawdzanie ostatnich wyników NBA.' } : { status: 'unavailable', reason: 'Nie można powiązać analizy z tym spotkaniem.' };
  const kickoff = Number.isFinite(Date.parse(event.date)) ? new Date(event.date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Termin niepotwierdzony';
  const notes = texts(safe.notes, detail ? 6 : 2);
  return `<${detail ? 'section' : 'article'} class="nba-analysis-card${detail ? ' nba-analysis-detail' : ''}" data-nba-${detail ? 'detail' : 'card'} data-fixture-id="${esc(event.id)}"><header class="nba-header"><div><p class="nba-time">NBA · ${esc(kickoff)} · czas w Polsce</p><h${detail ? '3' : '4'}>${esc(event.home)} — ${esc(event.away)}</h${detail ? '3' : '4'}></div><span class="nba-status nba-status-${safe.status}">${statusLabels[safe.status]}</span></header>${lead(safe, event, { ...options, compact: !detail })}<div class="nba-teams">${team(safe.teams?.home, event.home, 'home', detail)}${team(safe.teams?.away, event.away, 'away', detail)}</div>${comparison(safe, event, options)}${notes.length ? `<details class="nba-coverage"><summary>Zakres danych i brakujący kontekst</summary>${notes.map(note => `<p>${esc(note)}</p>`).join('')}</details>` : ''}${!detail ? `<button type="button" class="nba-open" data-bet-id="${esc(event.id)}">Pełna analiza NBA i wykresy</button>` : ''}</${detail ? 'section' : 'article'}>`;
}

export function nbaAnalysisCardHTML(result, event, options = {}) { return render(result, event, options, false); }
export function nbaAnalysisDetailHTML(result, event, options = {}) { return render(result, event, options, true); }

export function nbaPickReasonsHTML(pick, event, options = {}) {
  if (event?.sport !== 'nba' || event.route !== 'basketball/nba' || pick?.scope !== 'including_overtime' || !['winner', 'total_points'].includes(pick.market)) return '';
  return explanation(pick, options.compact !== false);
}
