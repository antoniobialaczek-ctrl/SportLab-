import { escapeHTML as esc } from './analysis-view.js';

const RULES = {
  corners: { label: 'Rzuty rożne', market: 'total_corners_90', maximum: 99.5 },
  yellowCards: { label: 'Żółte kartki', market: 'total_yellow_cards_90', maximum: 59.5 },
  shots: { label: 'Strzały', market: 'total_shots_90', maximum: 199.5 },
  shotsOnTarget: { label: 'Strzały celne', market: 'total_shots_on_target_90', maximum: 99.5 },
};
const STATUS = { available: 'Porównanie 90 minut', partial: 'Częściowe dane', limited: 'Krótka próba', unavailable: 'Statystyki niedostępne', closed: 'Mecz rozpoczęty', loading: 'Pobieranie statystyk' };
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pl-PL', { maximumFractionDigits: 1 }) : '—';
const integer = value => Number.isInteger(value) && value >= 0;
const ratio = side => integer(side?.hits) && integer(side?.sample) && side.sample > 0 && side.hits <= side.sample ? `${side.hits}/${side.sample}` : '—';
const strings = (values, limit) => (Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()).slice(0, limit);
const list = (values, className, limit = 3) => { const rows = strings(values, limit); return rows.length ? `<ul class="${className}">${rows.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : ''; };
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit' }) : '—';
const lineValid = (value, key) => Number.isFinite(value) && value >= 0.5 && value <= RULES[key].maximum && value % 1 === 0.5;

function chart(team, name, metric, side) {
  const seen = new Set();
  const rows = (Array.isArray(team?.recent) ? team.recent : []).filter(row => {
    if (!row || typeof row.matchId !== 'string' || seen.has(row.matchId) || !Number.isFinite(Date.parse(row.date))
      || ![row.own, row.against, row.total].every(value => integer(value) && value <= 1000) || row.total !== row.own + row.against) return false;
    seen.add(row.matchId); return true;
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5).reverse();
  if (!rows.length) return `<p class="fex-note">${esc(name)}: brak kompletnych obserwacji do wykresu.</p>`;
  const reference = lineValid(metric.line, metric.key) ? metric.line : null;
  const maximum = Math.max(4, Math.ceil(Math.max(...rows.map(row => row.total), reference || 0) / 2) * 2);
  const color = side === 'home' ? '#b19bff' : '#65d9c2', width = 360, base = 119, top = 20, left = 31;
  const y = value => base - value / maximum * (base - top), step = 314 / rows.length;
  const bars = rows.map((row, index) => {
    const center = left + step * (index + 0.5), valueY = y(row.total);
    return `<g data-extra-observation data-match-id="${esc(row.matchId)}" data-date="${esc(row.date)}" data-total="${row.total}"><rect x="${center - 13}" y="${valueY}" width="26" height="${base - valueY}" rx="3" fill="${color}"><title>${esc(`${date(row.date)} · ${name} — ${row.opponent || 'rywal'}: ${row.own} + ${row.against} = ${row.total}`)}</title></rect><text x="${center}" y="${Math.max(14, valueY - 5)}" text-anchor="middle" fill="#eaf0fc" font-size="13">${row.total}</text><text x="${center}" y="138" text-anchor="middle" fill="#b7c8e0" font-size="11">${esc(date(row.date))}</text></g>`;
  }).join('');
  return `<figure class="fex-chart fex-chart-${side}"><figcaption>${esc(name)} · ostatnie ${rows.length} sum w meczach</figcaption><svg viewBox="0 0 ${width} 148" role="img" aria-label="${esc(`${name}: ${RULES[metric.key].label}, sumy obu drużyn od najstarszego do najnowszego, oś od zera`)}"><line x1="${left}" x2="345" y1="${base}" y2="${base}" stroke="#7287a7" data-zero-baseline="true"/><text x="24" y="123" text-anchor="end" fill="#acbdd8" font-size="11">0</text><text x="24" y="24" text-anchor="end" fill="#acbdd8" font-size="11">${maximum}</text>${reference === null ? '' : `<line x1="${left}" x2="345" y1="${y(reference)}" y2="${y(reference)}" stroke="#edc274" stroke-dasharray="5 4"><title>Linia porównania ${number(reference)}</title></line>`}${bars}</svg></figure>`;
}

function support(pick, event) {
  return `<p class="fex-support">${esc(event.home)}: <b>${ratio(pick.support?.home)}</b> · ${esc(event.away)}: <b>${ratio(pick.support?.away)}</b><small>wcześniejszych sum zgodnych z kierunkiem</small></p>`;
}
function teamRow(team, name) {
  return `<tr><th scope="row">${esc(name)}</th><td>${integer(team?.sample) ? team.sample : '—'}</td><td>${number(team?.averageOwn)}</td><td>${number(team?.averageAgainst)}</td><td>${number(team?.averageTotal)}</td><td>${number(team?.last5?.averageTotal)}</td></tr>`;
}
function comparisons(metric, event, detail) {
  const candidates = (Array.isArray(metric.candidates) ? metric.candidates : []).filter(pick => pick && pick.market === RULES[metric.key].market && pick.scope === 'regulation_90' && pick.line === metric.line && ['over', 'under'].includes(pick.direction));
  if (!candidates.length) return '';
  return `<details class="fex-comparison"><summary>Argumenty za i przeciw obu kierunkom</summary><div class="fex-candidates">${candidates.map(pick => `<section class="fex-candidate" data-extra-direction="${pick.direction}"><h5>${esc(pick.label || `${pick.direction === 'over' ? 'Powyżej' : 'Poniżej'} ${number(metric.line)}`)}</h5><p class="fex-signal">${pick.signal === 'aligned' ? 'Zgodny kierunek w historii' : pick.signal === 'mixed' ? 'Sygnały mieszane' : 'Słabe wsparcie w historii'}</p>${support(pick, event)}${list(pick.reasons, 'fex-reasons', detail ? 4 : 2)}<div class="fex-counter"><b>Co przemawia przeciw?</b>${list(pick.counterevidence, 'fex-counter-list', detail ? 3 : 2)}</div></section>`).join('')}</div></details>`;
}
function lineForm(metric, event) {
  const editable = metric.home?.sample >= 3 && metric.away?.sample >= 3;
  if (!lineValid(metric.line, metric.key) || !['available', 'limited', 'partial'].includes(metric.status)) return '';
  return `<form class="fex-line-form" data-football-extra-line data-fixture-id="${esc(event.id)}" data-metric="${metric.key}" data-minimum="0.5" data-maximum="${RULES[metric.key].maximum}"><label>Twoja linia<input name="line" type="text" inputmode="decimal" value="${number(metric.line)}"${editable ? '' : ' readonly'} required aria-label="${esc(`${RULES[metric.key].label}: linia sumy obu drużyn`)}"></label><button type="submit"${editable ? '' : ' disabled'}>Porównaj linię</button><p class="fex-note">${editable ? '' : 'Własna linia po zebraniu pełnej porównywalnej próby. '}Połówka od 0,5 do ${number(RULES[metric.key].maximum)}. Wpisz próg z właściwej oferty.</p><p class="fex-line-result" data-extra-line-result role="status"></p></form>`;
}
function metricHTML(metric, event, detail, active) {
  const rule = RULES[metric.key], best = active && metric.status === 'available' && metric.best?.eligible === true && metric.best.market === rule.market && metric.best.scope === 'regulation_90' && metric.best.line === metric.line ? metric.best : null;
  const facts = (metric.home?.sample || 0) > 0 || (metric.away?.sample || 0) > 0;
  const reference = lineValid(metric.line, metric.key) ? `<p class="fex-reference">${metric.lineOrigin === 'manual' ? 'Twoja linia' : 'Stała linia analityczna'}: <b>${number(metric.line)}</b> · suma obu drużyn po 90 minutach</p>` : '';
  return `<section class="fex-metric" data-extra-metric="${metric.key}" data-extra-status="${esc(STATUS[metric.status] ? metric.status : 'unavailable')}"><div class="fex-metric-heading"><h4>${rule.label}</h4><span>${STATUS[metric.status] || 'Dane historyczne'}</span></div>${reference}${metric.key === 'yellowCards' ? '<p class="fex-card-rules" data-yellow-card-rules>Porównujemy licznik żółtych kartek ESPN. Przed decyzją sprawdź w ofercie zasady drugiej żółtej, czerwonych kartek i punktów kartkowych — ich zgodności z tym licznikiem nie potwierdzono.</p>' : ''}${best ? `<div class="fex-lead" data-extra-best><p class="fex-eyebrow">Kierunek z historii</p><h5>${esc(best.label)}</h5>${support(best, event)}${list(best.reasons, 'fex-reasons', detail ? 3 : 1)}<p class="fex-counter">${esc(strings(best.counterevidence, 1)[0] || 'Wcześniejsze wyniki obejmują różnych przeciwników; historia nie potwierdza skuteczności prognozy.')}</p></div>` : `<p class="fex-note">${esc(metric.reason || metric.coverage?.reason || (facts ? metric.status === 'limited' ? 'Dostępna krótka próba — poniżej fakty i oba kierunki do porównania.' : 'Brak zgodnego kierunku w dostępnej historii. Poniżej fakty i argumenty.' : 'Brakuje kompletnych danych tej statystyki. Puste wartości pozostają brakami danych.'))}</p>`}${facts ? `<div class="fex-table-scroll"><table><caption>${rule.label} — dostępne wcześniejsze mecze</caption><thead><tr><th scope="col">Drużyna</th><th scope="col">Mecze</th><th scope="col">Własne / mecz</th><th scope="col">Rywale / mecz</th><th scope="col">Suma / mecz</th><th scope="col">Suma ostatnich 5</th></tr></thead><tbody>${teamRow(metric.home, event.home)}${teamRow(metric.away, event.away)}</tbody></table></div><p class="fex-dates">Najnowsze obserwacje: ${esc(event.home)} ${esc(date(metric.home?.recent?.[0]?.date))} · ${esc(event.away)} ${esc(date(metric.away?.recent?.[0]?.date))}.</p>` : ''}<p class="fex-price-note">Sprawdź kurs i zasady dokładnie tego rynku. ${metric.lineOrigin === 'manual' ? 'Wpisana linia' : 'Linia analityczna'} nie jest odczytem oferty bukmachera.</p>${active ? lineForm(metric, event) : ''}${comparisons(metric, event, detail)}${facts ? `<details class="fex-observations"${detail ? ' open' : ''}><summary>Ostatnie sumy i wykresy</summary><div class="fex-chart-grid">${chart(metric.home, event.home, metric, 'home')}${chart(metric.away, event.away, metric, 'away')}</div><p class="fex-note">Słupki przedstawiają sumę statystyki obu drużyn w różnych wcześniejszych meczach. Oś zaczyna się od zera.</p>${detail ? `<p class="fex-note">Mediana sum: ${number(metric.home?.medianTotal)} i ${number(metric.away?.medianTotal)} · rozrzut sum: ${number(metric.home?.totalStdDev)} i ${number(metric.away?.totalStdDev)}.</p>` : ''}</details>` : ''}</section>`;
}
function render(result, event, detail, compact = !detail) {
  if (event?.sport !== 'football') return '';
  const bound = result?.sport === 'football' && result.route === event.route && result.fixtureId === event.id && result.scope === 'regulation_90' && Object.hasOwn(STATUS, result.status);
  const safe = bound ? result : result?.status === 'loading' ? { status: 'loading', reason: result.reason, metrics: [] } : { status: 'unavailable', reason: 'Nie można powiązać dodatkowych statystyk z tym spotkaniem.', metrics: [] };
  const active = ['available', 'partial', 'limited'].includes(safe.status);
  const metrics = (Array.isArray(safe.metrics) ? safe.metrics : []).filter(metric => metric && Object.hasOwn(RULES, metric.key) && metric.market === RULES[metric.key].market);
  const primary = metrics.slice(0, compact ? 2 : metrics.length), more = compact ? metrics.slice(2) : [];
  return `<${detail ? 'section' : 'article'} class="football-extra-card${detail ? ' football-extra-detail' : ''}" data-football-extra-${detail ? 'detail' : 'card'} data-fixture-id="${esc(event.id)}" data-extra-status="${safe.status}"><header class="fex-header"><div><p class="fex-eyebrow">Dodatkowe rynki · 90 minut z doliczonym czasem</p><h${detail ? '3' : '4'}>${esc(event.home)} — ${esc(event.away)}</h${detail ? '3' : '4'}></div><span class="fex-status">${STATUS[safe.status]}</span></header>${safe.reason ? `<p class="fex-note">${esc(safe.reason)}</p>` : ''}${primary.map(metric => metricHTML(metric, event, !compact, active)).join('')}${more.length ? `<details class="fex-more-metrics"><summary>Pozostałe statystyki: ${more.map(metric => RULES[metric.key].label).join(', ')}</summary>${more.map(metric => metricHTML(metric, event, false, active)).join('')}</details>` : ''}${list(safe.notes, 'fex-method', compact ? 2 : 6)}<p class="fex-method">Porównanie opisowe. Liczniki nie są prawdopodobieństwami ani potwierdzoną skutecznością prognozy.</p>${!detail ? `<button type="button" class="football-extra-open" data-bet-id="${esc(event.id)}">Pełne dodatkowe statystyki</button>` : ''}</${detail ? 'section' : 'article'}>`;
}

export function footballExtraCardHTML(result, event, options = {}) { return render(result, event, false, options.compact !== false); }
export function footballExtraDetailHTML(result, event) { return render(result, event, true); }
