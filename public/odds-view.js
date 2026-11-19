import { escapeHTML as esc } from './analysis-view.js';
const scope = { unknown: 'Źródło nie potwierdza zasad rozliczenia (np. dogrywki).', regulation_90: 'Wynik po 90 minutach', including_overtime: 'Z dogrywką', including_overtime_shootout: 'Z dogrywką i karnymi' };
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pl-PL') : 'niepodany';
const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
const priceValid = value => typeof value === 'number' && Number.isFinite(value) && value >= 1.01 && value <= 1000;
const halfPoint = value => typeof value === 'number' && Number.isFinite(value) && value >= 1.5 && value <= 599.5 && Number.isInteger(value * 2) && !Number.isInteger(value);
const recentObservation = value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 60000 && Date.now() - Date.parse(value) <= 5 * 60000;

function selection(row, quote, event) {
  if (quote.market === 'total_points') {
    const direction = row.direction || row.side;
    return halfPoint(quote.line) && ['over', 'under'].includes(direction) ? `${direction === 'over' ? 'Powyżej' : 'Poniżej'} ${decimal(quote.line)} pkt` : null;
  }
  return row.side === 'home' ? event.home : row.side === 'away' ? event.away : row.side === 'draw' ? 'Remis' : null;
}

function ruleLink(basis) {
  if (!basis || typeof basis.url !== 'string') return '';
  let url;
  try { url = new URL(basis.url); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  return `<details class="small"><summary>Źródło zasad rozliczenia</summary><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(basis.provider || 'Dokument źródłowy')}</a>${basis.section ? ` • ${esc(basis.section)}` : ''}</details>`;
}

export function oddsHTML(data, event) {
  const start = Date.parse(event?.date || event?.startTime);
  const compatible = data?.fixtureId === event?.id && data?.sport === event?.sport && data?.route === event?.route
    && data?.homeId === event?.homeId && data?.awayId === event?.awayId
    && Number.isFinite(start) && Date.parse(data.startTime) === start;
  const quotes = compatible && data.status === 'available' && Array.isArray(data.quotes) ? data.quotes : [];
  const rendered = quotes.flatMap(quote => {
    if (!quote || typeof quote.provider !== 'string' || !Array.isArray(quote.outcomes)) return [];
    const outcomes = quote.outcomes.flatMap(row => {
      const label = row && selection(row, quote, event);
      return label && priceValid(row.decimal) ? [{ ...row, label }] : [];
    });
    if (!outcomes.length) return [];
    const total = quote.market === 'total_points';
    const directions = outcomes.map(row => row.direction || row.side);
    const canUseLine = total && event.sport === 'nba' && event.state === 'pre' && start > Date.now()
      && quote.scope === 'including_overtime' && halfPoint(quote.line) && directions.includes('over') && directions.includes('under')
      && quote.freshness !== 'stale' && recentObservation(data.fetchedAt) && recentObservation(quote.observedAt);
    return [`<div class="odds-quote"><p><b>${esc(quote.provider)}</b> • ${esc(quote.marketLabel || (total ? 'Suma punktów' : 'Wynik meczu'))}${total ? ` • linia ${decimal(quote.line)} pkt` : ''}</p><p class="small">${esc(scope[quote.scope] || scope.unknown)}</p><div class="scroll"><table><thead><tr><th>Wybór</th><th>Kurs dziesiętny</th><th>Kurs amerykański</th></tr></thead><tbody>${outcomes.map(row => `<tr><td>${esc(row.label)}</td><td>${decimal(row.decimal)}</td><td>${Number.isFinite(row.american) ? esc(row.american > 0 ? '+' + row.american : row.american) : '—'}</td></tr>`).join('')}</tbody></table></div>${canUseLine ? `<button type="button" data-use-source-line data-line="${quote.line}" data-provider="${esc(quote.provider)}">Porównaj linię z odczytu ${decimal(quote.line)} pkt</button>` : ''}<p class="small">Aktualizacja kursu w źródle: ${esc(date(quote.quotedAt))}. ${quote.freshness === 'unverified' ? 'Świeżość niepotwierdzona.' : quote.freshness === 'stale' ? 'Kurs starszy niż 10 minut.' : 'Źródłowy znacznik aktualizacji mieści się w ostatnich 10 minutach.'}<br>Pobrano: ${esc(date(quote.observedAt))}. Tego odczytu nie używamy automatycznie w ocenie opłacalności ani w dzienniku.</p>${ruleLink(quote.scopeBasis)}</div>`];
  });
  return `<section class="panel odds-panel"><h3>Kursy ze źródła — odczyt informacyjny</h3>${rendered.length ? rendered.join('') : `<p class="small">${esc(data?.reason || 'Brak potwierdzonego odczytu kursów dla tego meczu. Kurs możesz wpisać ręcznie w dzienniku.')}</p>`}${rendered.length ? `<p class="small">${esc(data.source)}. ${esc((data.notes || []).join(' '))}</p>` : ''}</section>`;
}
