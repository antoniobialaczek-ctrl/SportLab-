import { escapeHTML as esc } from './analysis-view.js';
import { matchPickQuote, pickOddsHTML } from './pick-odds.js';

const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pl-PL', { maximumFractionDigits: 1 }) : '—';
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const ratio = (hits, sample) => count(hits) !== null && count(sample) !== null && sample > 0 && hits <= sample ? `${hits}/${sample}` : '—';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit' }) : '—';
const strings = (values, limit = 6) => (Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()).slice(0, limit);
const list = (values, className, limit) => {
  const items = strings(values, limit);
  return items.length ? `<ul class="${className}">${items.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : '';
};
const statusLabel = { available: 'Porównanie rynków', limited: 'Ograniczona historia', unavailable: 'Brak porównywalnych danych', closed: 'Mecz rozpoczęty', loading: 'Wczytywanie analizy' };
const signalLabel = { aligned: 'Zgodny kierunek', mixed: 'Sygnały mieszane', weak: 'Słabe wsparcie' };

function bound(result, event) {
  return event?.sport === 'football' && result?.sport === 'football' && result.route === event.route
    && result.fixtureId === event.id && ['available', 'limited', 'unavailable', 'closed'].includes(result.status);
}

function priceHTML(pick, event, options) {
  const quote = matchPickQuote(options.oddsData, event, pick, { now: options.now ?? Date.now() });
  return quote.status === 'matched' ? pickOddsHTML(options.oddsData, event, pick, { now: options.now ?? Date.now() })
    : '<span class="fa-no-price">Sprawdź kurs na ten rynek</span>';
}

function supportHTML(pick, event) {
  return `<p class="fa-support"><span>${esc(event.home)}: <b>${ratio(pick.support?.home?.hits, pick.support?.home?.sample)}</b></span><span>${esc(event.away)}: <b>${ratio(pick.support?.away?.hits, pick.support?.away?.sample)}</b></span><small>wcześniejszych wyników zgodnych z kierunkiem</small></p>`;
}

function winnerSummaryHTML(result, event, options) {
  const lean = result.winnerLean;
  if (!['available', 'limited'].includes(result.status) || result.coverage?.stale || !lean || !['lean', 'balanced'].includes(lean.status)) return '';
  const heading = options.compact ? 'h5' : 'h4';
  if (lean.status === 'balanced') return `<div class="fa-direction fa-direction-neutral" data-football-winner><p class="fa-eyebrow">Kto ma większe wsparcie w formie?</p><${heading}>Brak wyraźnego faworyta na zwycięstwo</${heading}>${list(lean.reasons, 'fa-reasons', 3)}${list(lean.counterevidence, 'fa-counter-list', 2)}<p class="fa-method">Wyniki obu drużyn dają rozbieżny obraz. Pozostałe rynki i ostatnie mecze są poniżej.</p></div>`;
  if (!['home', 'away'].includes(lean.side) || lean.name !== event[lean.side] || lean.market !== 'winner' || lean.scope !== 'regulation_90') return '';
  return `<div class="fa-direction fa-winner-direction" data-football-winner><div class="fa-direction-heading"><div><p class="fa-eyebrow">Faworyt z formy${lean.shortSample ? ' · wstępny kierunek' : ''}</p><${heading}>${esc(lean.name)} — kierunek na zwycięstwo</${heading}></div>${priceHTML(lean, event, options)}</div>${list(lean.reasons, 'fa-reasons', options.compact ? 3 : 4)}${lean.shortSample ? `<p class="fa-sample-note">Krótka próba. Liczba meczów: ${esc(event.home)} — ${count(lean.samples?.home) ?? '—'}; ${esc(event.away)} — ${count(lean.samples?.away) ?? '—'}.</p>` : ''}<div class="fa-counter"><b>Co może przeszkodzić?</b>${list(lean.counterevidence, 'fa-counter-list', options.compact ? 1 : 3)}</div><p class="fa-method">Porównanie formy po 90 minutach. Skuteczność prognozy zwycięzcy nie została potwierdzona.</p></div>`;
}

function directionHTML(result, event, options) {
  const winner = winnerSummaryHTML(result, event, options);
  const best = result.status === 'available' && result.best?.eligible === true ? result.best : null;
  if (winner && (!best || best.market === 'winner' && best.side === result.winnerLean.side)) return winner;
  const heading = options.compact ? 'h5' : 'h4';
  if (!best) return `<div class="fa-direction fa-direction-neutral" data-football-verdict><p class="fa-eyebrow">Wniosek z analizy</p><${heading}>${result.status === 'loading' ? 'Porównywanie wyniku i goli…' : result.status === 'limited' ? result.coverage?.stale ? 'Historia wymaga odświeżenia' : 'Za krótka historia do wskazania typu' : result.status === 'closed' ? 'Dostępne jest porównanie historyczne' : result.status === 'unavailable' ? 'Brak danych do wskazania kierunku' : 'Brak zgodnego kierunku na ten mecz'}</${heading}><p>${esc(result.reason || result.verdict || 'Wynik i gole wymagają osobnego porównania. Poniżej widać dostępne fakty oraz rozbieżności.')}</p></div>`;
  return `<div class="fa-direction" data-football-verdict><div class="fa-direction-heading"><div><p class="fa-eyebrow">${winner ? 'Inny rynek wsparty formą' : 'Najlepiej wsparty kierunek w historii'}</p><${heading}>${esc(best.label)}</${heading}></div>${priceHTML(best, event, options)}</div>${supportHTML(best, event)}${list(best.reasons, 'fa-reasons', options.compact ? 2 : 4)}${strings(best.counterevidence, 2).length ? `<div class="fa-counter"><b>Co przemawia przeciw?</b>${list(best.counterevidence, 'fa-counter-list', options.compact ? 1 : 3)}</div>` : ''}<p class="fa-method">Kierunek analizy opisowej · 90 minut z doliczonym czasem. Liczniki nie są szansą wygranej ani potwierdzeniem opłacalności.</p></div>`;
}

function metricRow(label, overall, last5, key) {
  return `<tr><th scope="row">${label}</th><td>${number(overall?.[key])}</td><td>${number(last5?.[key])}</td></tr>`;
}

function teamHTML(team, name, side, detail) {
  const overall = team?.overall, last5 = team?.last5, venue = team?.venue;
  if (!overall || !Number.isInteger(overall.sample) || overall.sample < 1) return `<section class="fa-team fa-team-${side}"><h4>${esc(name)}</h4><p class="small">Brak potwierdzonych wcześniejszych wyników 90 minut.</p></section>`;
  const latest = team.latestDate || team.lastMatchAt || team.recent?.[0]?.date;
  const venueStats = venue?.overall || venue;
  const venueLabel = venue?.label || (side === 'home' ? 'W domu' : 'Na wyjeździe');
  const venueEnough = Number.isInteger(venueStats?.sample) && venueStats.sample >= 3 && venue?.reliable !== false;
  const recent = (Array.isArray(team.recent) ? team.recent : []).filter(row => Number.isInteger(row.scoreFor) && Number.isInteger(row.scoreAgainst)).slice(0, 5);
  return `<section class="fa-team fa-team-${side}"><h4>${esc(name)}</h4><p class="fa-team-range">Ostatnie ${overall.sample} meczów · najnowszy ${esc(date(latest))}</p><div class="fa-form-summary"><b>${count(overall.wins) ?? '—'}Z ${count(overall.draws) ?? '—'}R ${count(overall.losses) ?? '—'}P</b><span>BTTS: <b>${ratio(overall.btts, overall.sample)}</b></span></div><table class="fa-metrics"><caption>Gole na mecz</caption><thead><tr><th scope="col">Średnia</th><th scope="col">${overall.sample} meczów</th><th scope="col">Ostatnie ${count(last5?.sample) ?? '—'}</th></tr></thead><tbody>${metricRow('Zdobyte', overall, last5, 'averageFor')}${metricRow('Stracone', overall, last5, 'averageAgainst')}${metricRow('Suma obu drużyn', overall, last5, 'averageTotal')}</tbody></table>${detail ? `<p class="fa-goal-facts">Czyste konta: <b>${ratio(overall.cleanSheets, overall.sample)}</b> · Bez strzelonego gola: <b>${ratio(overall.failedToScore, overall.sample)}</b></p>` : ''}<p class="fa-venue">${esc(venueLabel)}: ${venueEnough ? `<b>${venueStats.wins}Z ${venueStats.draws}R ${venueStats.losses}P</b> w ${venueStats.sample} meczach${detail ? ` · gole ${number(venueStats.averageFor)} zdobytych / ${number(venueStats.averageAgainst)} straconych` : ''}` : 'mniej niż 3 potwierdzone mecze — bez osobnego wniosku.'}</p>${recent.length ? `<ol class="fa-recent" aria-label="Ostatnie wyniki ${esc(name)}, od najnowszego">${recent.map(row => `<li title="${esc(`${date(row.date)} · ${row.opponent || 'Rywal niepodany'}`)}"><span>${esc(date(row.date))}</span><b>${row.scoreFor}:${row.scoreAgainst}</b></li>`).join('')}</ol>` : ''}</section>`;
}

function comparisonHTML(result, event, options) {
  const candidates = Array.isArray(result.candidates) ? result.candidates.filter(pick => pick && typeof pick.label === 'string') : [];
  if (!candidates.length) return '';
  const groups = [
    ['Wynik po 90 minutach', candidates.filter(pick => pick.kind === 'result')],
    ['Suma goli', candidates.filter(pick => pick.kind === 'total')],
    ['Obie drużyny strzelą (BTTS)', candidates.filter(pick => pick.kind === 'btts')],
  ];
  const recent = pick => pick.recentSupport ? `<p class="fa-recent-support">Ostatnie 5: ${esc(event.home)} <b>${ratio(pick.recentSupport.home?.hits, pick.recentSupport.home?.sample)}</b> · ${esc(event.away)} <b>${ratio(pick.recentSupport.away?.hits, pick.recentSupport.away?.sample)}</b></p>` : '';
  return `<div class="fa-comparison"><h4>Wynik czy gole — porównanie rynków</h4><p class="fa-table-note">Zgodność historii obu drużyn oraz argumenty przeciw każdemu kierunkowi.</p>${groups.filter(([, picks]) => picks.length).map(([label, picks]) => `<section class="fa-market-group"><h5>${label}</h5><div class="fa-market-list">${picks.map(pick => `<section class="fa-market" data-football-market="${esc(pick.market || '')}"><div class="fa-market-heading"><h6>${esc(pick.label)}</h6><span class="fa-signal fa-signal-${['aligned', 'mixed', 'weak'].includes(pick.signal) ? pick.signal : 'weak'}">${esc(signalLabel[pick.signal] || 'Do porównania')}</span></div>${supportHTML(pick, event)}${recent(pick)}<div class="fa-market-price">${priceHTML(pick, event, options)}</div>${list(pick.reasons, 'fa-reasons', 3)}${strings(pick.counterevidence).length ? `<div class="fa-counter"><b>Argumenty przeciw</b>${list(pick.counterevidence, 'fa-counter-list', 3)}</div>` : ''}</section>`).join('')}</div></section>`).join('')}</div>`;
}

function render(result, event, options, detail) {
  if (event?.sport !== 'football') return '';
  const valid = bound(result, event);
  const safe = valid ? result : result?.status === 'loading' ? { status: 'loading', reason: strings([result.reason], 1)[0] || 'Sprawdzanie wcześniejszych wyników obu drużyn.', teams: {} } : { status: 'unavailable', reason: 'Nie można powiązać analizy z tym spotkaniem.', teams: {} };
  const kickoff = Number.isFinite(Date.parse(event.date)) ? new Date(event.date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Termin niepotwierdzony';
  const comparison = comparisonHTML(safe, event, options);
  const notes = strings(safe.notes, detail ? 6 : 2);
  return `<${detail ? 'section' : 'article'} class="football-analysis-card${detail ? ' football-analysis-detail' : ''}" data-football-${detail ? 'detail' : 'card'} data-football-analysis-${detail ? 'detail' : 'card'} data-fixture-id="${esc(event.id)}"><header class="fa-header"><div><p class="fa-time">${esc(event.league || '')} · ${esc(kickoff)} · czas w Polsce</p><h${detail ? '3' : '4'}>${esc(event.home)} — ${esc(event.away)}</h${detail ? '3' : '4'}></div><span class="fa-status fa-status-${safe.status}">${statusLabel[safe.status]}</span></header>${directionHTML(safe, event, { ...options, compact: !detail })}<div class="fa-teams">${teamHTML(safe.teams?.home, event.home, 'home', detail)}${teamHTML(safe.teams?.away, event.away, 'away', detail)}</div>${comparison ? `<details class="fa-other-markets"><summary>${detail ? 'Porównaj rynki: wynik, suma goli, obie strzelą' : 'Wynik, suma goli i obie drużyny strzelą'}</summary>${comparison}</details>` : ''}${notes.length ? `<details class="fa-coverage"><summary>Zakres danych i brakujące informacje</summary>${notes.map(note => `<p>${esc(note)}</p>`).join('')}</details>` : ''}${!detail ? `<button type="button" class="fa-open" data-bet-id="${esc(event.id)}">Pełna analiza meczu i wykresy</button>` : ''}</${detail ? 'section' : 'article'}>`;
}

export function footballAnalysisCardHTML(result, event, options = {}) {
  return render(result, event, options, false);
}

export function footballAnalysisDetailHTML(result, event, options = {}) {
  return render(result, event, options, true);
}
