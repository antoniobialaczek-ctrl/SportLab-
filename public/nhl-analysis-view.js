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
const statusLabels = { available: 'Forma i gole', limited: 'Ograniczona historia', unavailable: 'Brak porównywalnych danych', closed: 'Mecz rozpoczęty', loading: 'Wczytywanie analizy' };
const signals = { aligned: 'Zgodny kierunek', mixed: 'Sygnały mieszane', weak: 'Słabe wsparcie' };
const METHOD = 'Oficjalne wyniki końcowe NHL z dogrywką i karnymi. Wygrana w serii karnych dodaje jeden gol do wyniku zwycięzcy; nie sumujemy trafień w serii. Skuteczność prognoz nie została potwierdzona.';

function bound(result, event) {
  return event?.sport === 'nhl' && event.route === 'hockey/nhl' && result?.sport === 'nhl' && result.route === event.route
    && result.fixtureId === event.id && result.scope === 'including_overtime_shootout' && ['available', 'limited', 'unavailable', 'closed'].includes(result.status);
}
function price(pick, event, options) {
  return matchPickQuote(options.oddsData, event, pick, { now: options.now ?? Date.now() }).status === 'matched'
    ? pickOddsHTML(options.oddsData, event, pick, { now: options.now ?? Date.now() })
    : '<span class="nhl-no-price">Sprawdź kurs na ten rynek</span>';
}
function support(pick, event) {
  return `<p class="nhl-support">${esc(event.home)}: <b>${ratio(pick.support?.home)}</b> · ${esc(event.away)}: <b>${ratio(pick.support?.away)}</b><small>wcześniejszych wyników zgodnych z kierunkiem</small></p>`;
}
function explanation(pick, compact) {
  return `<div class="nhl-explanation"><b>Co wspiera typ?</b>${list(pick.reasons, 'nhl-reasons', compact ? 3 : 5)}</div><div class="nhl-counter"><b>Co może przeszkodzić?</b>${list(pick.counterevidence, 'nhl-counter-list', compact ? 1 : 4)}</div>`;
}
function winner(result, event, options) {
  const lean = result.winnerLean, heading = options.compact ? 'h5' : 'h4';
  if (!['available', 'limited'].includes(result.status) || result.coverage?.stale || !lean || !['lean', 'balanced'].includes(lean.status)) return '';
  if (lean.status === 'balanced') return `<section class="nhl-direction nhl-neutral" data-nhl-winner><p class="nhl-eyebrow">Kto ma lepszą formę?</p><${heading}>Brak wyraźnego faworyta na zwycięstwo</${heading}>${list(lean.reasons, 'nhl-reasons', 3)}${list(lean.counterevidence, 'nhl-counter-list', 2)}<p class="nhl-method">${METHOD}</p></section>`;
  if (!['home', 'away'].includes(lean.side) || lean.name !== event[lean.side] || lean.market !== 'winner' || lean.scope !== 'including_overtime_shootout') return '';
  return `<section class="nhl-direction" data-nhl-winner><div class="nhl-direction-heading"><div><p class="nhl-eyebrow">Faworyt z formy${lean.shortSample ? ' · wstępny kierunek' : ''}</p><${heading}>${esc(lean.name)} — kierunek na zwycięstwo</${heading}></div>${price(lean, event, options)}</div>${explanation(lean, options.compact)}${lean.shortSample ? `<p class="nhl-sample-note">Krótka próba. Liczba meczów: ${esc(event.home)} — ${count(lean.samples?.home) ?? '—'}; ${esc(event.away)} — ${count(lean.samples?.away) ?? '—'}.</p>` : ''}<p class="nhl-method">${METHOD}</p></section>`;
}
function lead(result, event, options) {
  const winnerHTML = winner(result, event, options);
  const best = result.status === 'available' && result.best?.eligible === true && result.best.scope === 'including_overtime_shootout'
    && ['winner', 'total_goals'].includes(result.best.market) ? result.best : null;
  if (winnerHTML && (!best || best.market === 'winner' && best.side === result.winnerLean.side)) return winnerHTML;
  const heading = options.compact ? 'h5' : 'h4';
  if (best) return `${winnerHTML}<section class="nhl-direction" data-nhl-verdict><div class="nhl-direction-heading"><div><p class="nhl-eyebrow">${winnerHTML ? 'Suma goli — kierunek z historii' : 'Najlepiej wsparty kierunek w historii'}</p><${heading}>${esc(best.label)}</${heading}></div>${price(best, event, options)}</div>${support(best, event)}${explanation(best, options.compact)}<p class="nhl-method">${METHOD}</p></section>`;
  const titles = { loading: 'Porównywanie formy i goli…', closed: 'Wskazania przedmeczowe są zamknięte', unavailable: 'Brak danych do wskazania kierunku', limited: result.coverage?.stale ? 'Historia wymaga odświeżenia' : 'Dostępna jest krótka historia' };
  return `<section class="nhl-direction nhl-neutral" data-nhl-verdict><p class="nhl-eyebrow">Wniosek z analizy</p><${heading}>${titles[result.status] || 'Sygnały na wynik i gole są mieszane'}</${heading}><p>${esc(result.reason || 'Porównaj aktualne wyniki i argumenty obu drużyn poniżej.')}</p></section>`;
}
function metric(label, stats, recent, key) {
  return `<tr><th scope="row">${label}</th><td>${number(stats?.[key])}</td><td>${number(recent?.[key])}</td></tr>`;
}
function team(team, name, side, detail) {
  const stats = team?.overall, last5 = team?.last5, venue = team?.venue;
  if (!stats || !Number.isInteger(stats.sample) || stats.sample < 1) return `<section class="nhl-team"><h4>${esc(name)}</h4><p class="small">Brak potwierdzonej historii tej drużyny.</p></section>`;
  const recent = (Array.isArray(team.recent) ? team.recent : []).filter(row => Number.isInteger(row.scoreFor) && Number.isInteger(row.scoreAgainst)).slice(0, 5);
  const venueOK = Number.isInteger(venue?.sample) && venue.sample >= 3 && venue.reliable !== false;
  return `<section class="nhl-team nhl-team-${side}"><h4>${esc(name)}</h4><p class="nhl-team-date">Ostatnie ${stats.sample} meczów · najnowszy ${esc(date(team.latestDate || recent[0]?.date))}</p><p class="nhl-balance"><b>${count(stats.wins) ?? '—'} zwycięstw · ${count(stats.losses) ?? '—'} porażek</b></p><table class="nhl-metrics"><caption>Gole na mecz — wynik końcowy</caption><thead><tr><th scope="col">Średnia</th><th scope="col">${stats.sample} meczów</th><th scope="col">Ostatnie ${count(last5?.sample) ?? '—'}</th></tr></thead><tbody>${metric('Zdobyte', stats, last5, 'averageFor')}${metric('Stracone', stats, last5, 'averageAgainst')}${metric('Różnica goli', stats, last5, 'averageMargin')}${metric('Suma obu drużyn', stats, last5, 'averageTotal')}</tbody></table>${detail ? `<p class="nhl-spread">Mediana sumy: <b>${number(stats.medianTotal)}</b> gola · rozrzut sum (odchylenie): <b>${number(stats.totalStdDev)}</b> gola.</p>` : ''}${detail ? `<p class="nhl-zero-facts">Końcowy wynik ze stratą 0 goli: <b>${count(stats.shutouts) ?? '—'}/${stats.sample}</b> · bez zdobytego gola: <b>${count(stats.failedToScore) ?? '—'}/${stats.sample}</b>. To statystyka wyniku drużyny.</p>` : ''}<p class="nhl-venue">${side === 'home' ? 'U siebie' : 'Na wyjeździe'}: ${venueOK ? `<b>${venue.wins}Z ${venue.losses}P</b> w ${venue.sample} meczach${detail ? ` · średnio ${number(venue.averageFor)} zdobytych / ${number(venue.averageAgainst)} straconych goli` : ''}` : 'mniej niż 3 potwierdzone mecze — bez osobnego wniosku.'}</p>${detail && Number.isFinite(team.hoursSinceLatestStart) ? `<p class="nhl-rest">Od początku ostatniego dostępnego meczu do odczytu: ${number(team.hoursSinceLatestStart)} h. To nie jest czas od zakończenia meczu ani pełne obciążenie terminarza.</p>` : ''}${recent.length ? `<ol class="nhl-recent" aria-label="Ostatnie wyniki ${esc(name)}, od najnowszego">${recent.map(row => `<li title="${esc(`${date(row.date)} · ${row.opponent || 'Rywal niepodany'}`)}"><span>${esc(date(row.date))}</span><b>${row.scoreFor}:${row.scoreAgainst}</b></li>`).join('')}</ol>` : ''}</section>`;
}
function comparison(result, event, options) {
  const candidates = (Array.isArray(result.candidates) ? result.candidates : []).filter(pick => pick && typeof pick.label === 'string');
  if (!candidates.length) return '';
  const recent = pick => pick.recentSupport ? `<p class="nhl-recent-support">Ostatnie 5: ${esc(event.home)} ${ratio(pick.recentSupport.home)} · ${esc(event.away)} ${ratio(pick.recentSupport.away)}</p>` : '';
  return `<details class="nhl-market-comparison"><summary>Porównaj zwycięzcę oraz sumę goli</summary><p class="nhl-market-note">Liczniki pokazują zgodność wcześniejszych wyników z dokładną linią. Nie są prognozą szans.</p><div class="nhl-market-grid">${candidates.map(pick => `<section class="nhl-market" data-nhl-market="${esc(pick.market || '')}"><div class="nhl-market-heading"><h5>${esc(pick.label)}</h5><span class="nhl-signal nhl-signal-${['aligned', 'mixed', 'weak'].includes(pick.signal) ? pick.signal : 'weak'}">${esc(signals[pick.signal] || 'Do porównania')}</span></div>${support(pick, event)}${recent(pick)}${price(pick, event, options)}${explanation(pick, true)}</section>`).join('')}</div></details>`;
}
function render(result, event, options, detail) {
  if (event?.sport !== 'nhl' || event.route !== 'hockey/nhl') return '';
  const safe = bound(result, event) ? result : result?.status === 'loading' ? { status: 'loading', reason: texts([result.reason], 1)[0] || 'Sprawdzanie ostatnich wyników NHL.' } : { status: 'unavailable', reason: 'Nie można powiązać analizy z tym spotkaniem.' };
  const kickoff = Number.isFinite(Date.parse(event.date)) ? new Date(event.date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Termin niepotwierdzony';
  const notes = texts(safe.notes, detail ? 6 : 2);
  return `<${detail ? 'section' : 'article'} class="nhl-analysis-card${detail ? ' nhl-analysis-detail' : ''}" data-nhl-${detail ? 'detail' : 'card'} data-fixture-id="${esc(event.id)}"><header class="nhl-header"><div><p class="nhl-time">NHL · ${esc(kickoff)} · czas w Polsce</p><h${detail ? '3' : '4'}>${esc(event.home)} — ${esc(event.away)}</h${detail ? '3' : '4'}></div><span class="nhl-status nhl-status-${safe.status}">${statusLabels[safe.status]}</span></header>${lead(safe, event, { ...options, compact: !detail })}<div class="nhl-teams">${team(safe.teams?.home, event.home, 'home', detail)}${team(safe.teams?.away, event.away, 'away', detail)}</div>${comparison(safe, event, options)}${notes.length ? `<details class="nhl-coverage"><summary>Zakres danych i brakujący kontekst</summary>${notes.map(note => `<p>${esc(note)}</p>`).join('')}</details>` : ''}${!detail ? `<button type="button" class="nhl-open" data-bet-id="${esc(event.id)}">Pełna analiza NHL i wykresy</button>` : ''}</${detail ? 'section' : 'article'}>`;
}

export function nhlAnalysisCardHTML(result, event, options = {}) { return render(result, event, options, false); }
export function nhlAnalysisDetailHTML(result, event, options = {}) { return render(result, event, options, true); }

export function nhlPickReasonsHTML(pick, event, options = {}) {
  if (event?.sport !== 'nhl' || event.route !== 'hockey/nhl' || pick?.scope !== 'including_overtime_shootout' || !['winner', 'total_goals'].includes(pick.market)) return '';
  return explanation(pick, options.compact !== false);
}
