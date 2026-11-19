import { escapeHTML as esc } from './analysis-view.js';
import { assessBetting } from './betting-view.js';
import { matchPickQuote, pickOddsHTML } from './pick-odds.js';

const DAY = 86400000;
const NOTE = 'Porównanie opisuje wcześniejsze wyniki. Linia analityczna nie jest ofertą bukmachera, a liczniki nie są prognozą prawdopodobieństwa ani potwierdzeniem opłacalności.';
const number = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const integer = value => Number.isInteger(value) && value >= 0;
const validLine = value => Number.isFinite(value) && value >= 1 && value <= 599.5 && Number.isInteger(value * 2) && !Number.isInteger(value);
const response = (status, reason, totals = null, candidates = []) => ({ status, best: candidates[0] || null, candidates, totals, reason, note: NOTE });

function fixtureContext(analysis, event, now) {
  if (!Number.isFinite(now) || !timestamp(event?.date)) return 'Nie można potwierdzić terminu spotkania.';
  const start = Date.parse(event.date);
  if (event.state !== 'pre' || start <= now) return 'closed';
  if (start - now > 2 * DAY) return 'Porównanie rynków jest dostępne w ciągu 48 godzin przed meczem.';
  if (!analysis || analysis.status !== 'available' || !timestamp(analysis.cutoff)
    || analysis.sport !== event.sport || analysis.route !== event.route
    || typeof event.route !== 'string' || typeof event.id !== 'string' || !event.id.startsWith(`${event.route}:`)
    || !/^\d{4,14}$/.test(event.id.slice(event.route.length + 1))
    || ![event.homeId, event.awayId].every(id => typeof id === 'string' && /^\d{1,14}$/.test(id))
    || event.homeId === event.awayId || analysis.home?.id !== event.homeId || analysis.away?.id !== event.awayId
    || analysis.fixtureId && analysis.fixtureId !== event.id) return 'Historia nie potwierdza właściwego meczu i jego uczestników.';
  const cutoff = Date.parse(analysis.cutoff);
  if (cutoff > now || cutoff > start || now - cutoff > 15 * 60000) return 'Odśwież wcześniejsze wyniki przed porównaniem rynków.';
  if (!({ nba: ['basketball/nba'], nhl: ['hockey/nhl'], tennis: ['tennis/atp', 'tennis/wta'] }[event.sport]?.includes(event.route)
    || event.sport === 'football' && /^soccer\/(?:eng\.1|esp\.1|ger\.1|ita\.1|fra\.1|uefa\.champions|uefa\.europa|eng\.2|ned\.1|por\.1)$/.test(event.route))) return 'Brak porównywalnego rynku dla tej dyscypliny.';
  return null;
}

function observations(form, event, cutoff, now) {
  if (!form || !integer(form.sample) || form.sample < 8 || form.sample > 10 || !Array.isArray(form.recent)
    || form.recent.length !== form.sample) return null;
  const seen = new Set(), rows = [];
  for (const row of form.recent) {
    if (typeof row?.id !== 'string' || !row.id.startsWith(`${event.route}:`)
      || !/^\d{4,14}$/.test(row.id.slice(event.route.length + 1)) || row.id === event.id || seen.has(row.id)
      || row.route !== event.route || !timestamp(row.date) || Date.parse(row.date) >= cutoff
      || ![row.scoreFor, row.scoreAgainst].every(value => integer(value) && value <= 300)
      || event.sport === 'nba' && row.scoreFor === row.scoreAgainst) return null;
    seen.add(row.id);
    rows.push({ id: row.id, matchId: row.id, date: row.date, total: row.scoreFor + row.scoreAgainst,
      scoreFor: row.scoreFor, scoreAgainst: row.scoreAgainst, opponent: row.opponent || '' });
  }
  rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
  if (now - Date.parse(rows[0].date) > 14 * DAY || !timestamp(form.lastMatchAt)
    || Date.parse(form.lastMatchAt) !== Date.parse(rows[0].date)) return null;
  const wins = rows.filter(row => row.scoreFor > row.scoreAgainst).length;
  const draws = rows.filter(row => row.scoreFor === row.scoreAgainst).length;
  if (!['wins', 'draws', 'losses'].every(key => integer(form[key])) || form.wins !== wins || form.draws !== draws || form.losses !== rows.length - wins - draws) return null;
  const scored = average(rows.map(row => row.scoreFor)), conceded = average(rows.map(row => row.scoreAgainst));
  if (![form.averageFor, form.averageAgainst, form.averageMargin].every(Number.isFinite)
    || Math.abs(form.averageFor - scored) > 0.03 || Math.abs(form.averageAgainst - conceded) > 0.03
    || Math.abs(form.averageMargin - scored + conceded) > 0.03) return null;
  return rows;
}

function summarize(rows, line) {
  const values = rows.map(row => row.total);
  return { observations: rows, sample: rows.length, average: average(values), median: median(values),
    last5Average: average(values.slice(0, 5)), over: values.filter(value => value > line).length, under: values.filter(value => value < line).length };
}

function resultCandidate(analysis, event, now) {
  const assessment = assessBetting(analysis, event, { now });
  if (!assessment.candidate) return null;
  const { home, away } = analysis, isHome = assessment.candidate.side === 'home';
  const doubleChance = event.sport === 'football';
  const homeHits = isHome ? home.wins + (doubleChance ? home.draws : 0) : home.losses + (doubleChance ? home.draws : 0);
  const awayHits = isHome ? away.losses + (doubleChance ? away.draws : 0) : away.wins + (doubleChance ? away.draws : 0);
  return { kind: 'result', market: assessment.candidate.market, side: assessment.candidate.side, label: assessment.candidate.label,
    support: { home: { hits: homeHits, sample: home.sample }, away: { hits: awayHits, sample: away.sample } },
    reasons: assessment.reasons, scope: event.sport === 'football' ? 'regulation_90' : event.sport === 'nhl' ? 'including_overtime_shootout' : 'including_overtime' };
}

/** Compare two transparent historical screens. Their support counts are not
 * calibrated forecasts; the selected total line is never optimized for hits.
 */
export function buildMatchPicks(analysis, event, { now = Date.now(), totalLine } = {}) {
  const current = typeof now === 'number' ? now : Date.parse(now);
  const error = fixtureContext(analysis, event, current);
  if (error) return response(error === 'closed' ? 'closed' : 'unavailable', error === 'closed' ? 'Analiza archiwalna — bez aktywnych typów przedmeczowych.' : error);
  const cutoff = Date.parse(analysis.cutoff);
  const homeRows = observations(analysis.home, event, cutoff, current), awayRows = observations(analysis.away, event, cutoff, current);
  if (!homeRows || !awayRows) return response('unavailable', 'Porównanie wymaga po 8–10 spójnych wcześniejszych meczów obu drużyn.');
  const winner = resultCandidate(analysis, event, current);
  if (event.sport !== 'nba') return response(winner ? 'available' : 'neutral', event.sport === 'tennis' ? 'Kontekst nawierzchni nie pozwala wybrać rynku tenisowego.' : 'Sumę punktów porównujemy dla NBA; tutaj pozostają rynki wyniku.', null, winner ? [winner] : []);
  if (totalLine !== undefined && !validLine(totalLine)) return response('unavailable', 'Podaj linię połówkową od 1,5 do 599,5 punktu.');

  // Equal-size windows avoid giving one team's longer history extra weight.
  const size = Math.min(homeRows.length, awayRows.length), homeWindow = homeRows.slice(0, size), awayWindow = awayRows.slice(0, size);
  const unique = new Map(homeWindow.map(row => [row.id, { ...row, participants: ['home'] }]));
  for (const row of awayWindow) {
    const prior = unique.get(row.id);
    if (prior && (Date.parse(prior.date) !== Date.parse(row.date) || prior.scoreFor !== row.scoreAgainst || prior.scoreAgainst !== row.scoreFor)) return response('unavailable', 'Wcześniejsze wspólne spotkanie ma sprzeczne wyniki.');
    if (prior) prior.participants.push('away'); else unique.set(row.id, { ...row, participants: ['away'] });
  }
  const uniqueObservations = [...unique.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
  const referenceAverage = average(uniqueObservations.map(row => row.total));
  const line = totalLine ?? Math.floor(referenceAverage) + 0.5;
  if (!validLine(line)) return response('unavailable', 'Dostępne wyniki nie tworzą poprawnej linii punktowej.');
  const home = summarize(homeWindow, line), away = summarize(awayWindow, line);
  const totals = { line, lineOrigin: totalLine === undefined ? 'analytical' : 'manual', referenceAverage,
    home, away, uniqueSample: uniqueObservations.length, uniqueObservations, scope: 'including_overtime',
    over: uniqueObservations.filter(row => row.total > line).length, under: uniqueObservations.filter(row => row.total < line).length };
  const candidates = winner ? [winner] : [];
  for (const direction of ['over', 'under']) {
    const homeHits = home[direction], awayHits = away[direction], uniqueHits = totals[direction];
    const trendAgrees = direction === 'over' ? home.last5Average > line && away.last5Average > line : home.last5Average < line && away.last5Average < line;
    if (homeHits * 2 < home.sample || awayHits * 2 < away.sample || uniqueHits < Math.ceil(totals.uniqueSample * 0.6) || !trendAgrees) continue;
    const word = direction === 'over' ? 'Powyżej' : 'Poniżej';
    candidates.push({ kind: 'total', market: 'total_points', direction, line, lineOrigin: totals.lineOrigin,
      label: `${word} ${number(line)} punktu w meczu (z dogrywką)`, scope: 'including_overtime',
      support: { home: { hits: homeHits, sample: home.sample }, away: { hits: awayHits, sample: away.sample }, uniqueHits, uniqueSample: totals.uniqueSample },
      reasons: [`${event.home}: ${homeHits} z ${home.sample} wcześniejszych sum ${word.toLocaleLowerCase('pl')} linii.`,
        `${event.away}: ${awayHits} z ${away.sample} wcześniejszych sum ${word.toLocaleLowerCase('pl')} linii.`,
        `Średnie ostatnich 5 sum: ${number(home.last5Average)} i ${number(away.last5Average)}; wspólne spotkania liczone tylko raz.`] });
  }
  const rank = candidate => { const h = candidate.support.home, a = candidate.support.away; return [Math.min(h.hits / h.sample, a.hits / a.sample), (h.hits / h.sample + a.hits / a.sample) / 2]; };
  candidates.sort((a, b) => { const ar = rank(a), br = rank(b); return br[0] - ar[0] || br[1] - ar[1] || Number(a.kind !== 'result') - Number(b.kind !== 'result'); });
  return response(candidates.length ? 'available' : 'neutral', candidates.length ? null : 'Na tej linii wcześniejsze wyniki nie dają zgodnego kierunku. Porównaj własną linię z oferty.', totals, candidates);
}

function supportHTML(candidate, event) {
  return `<p class="small">${esc(event.home)}: <b>${candidate.support.home.hits} z ${candidate.support.home.sample}</b> • ${esc(event.away)}: <b>${candidate.support.away.hits} z ${candidate.support.away.sample}</b> wcześniejszych wyników zgodnych z kierunkiem.</p>`;
}

function observedMarkets(options, event) {
  const quotes = Array.isArray(options.oddsData?.quotes) ? options.oddsData.quotes : [];
  const winnerQuote = quotes.find(quote => quote?.market === 'winner' && quote.scope !== 'unknown');
  const sides = event.sport === 'football' ? ['home', 'draw', 'away'] : ['home', 'away'];
  const winners = winnerQuote ? sides.map(side => ({ kind: 'result', market: 'winner', side, scope: winnerQuote.scope })) : [];
  const winnerPrices = winners.length && winners.every(pick => matchPickQuote(options.oddsData, event, pick, options).status === 'matched')
    ? `<div class="observed-market"><span class="small">Rynek wyniku — odczyt źródła</span><div class="observed-price-options">${winners.map(pick => `<div><span>${esc(pick.side === 'home' ? event.home : pick.side === 'away' ? event.away : 'Remis')}</span>${pickOddsHTML(options.oddsData, event, pick, options)}</div>`).join('')}</div></div>` : '';
  const totalQuote = quotes.find(quote => quote?.market === 'total_points' && quote.scope === 'including_overtime');
  const totalPicks = totalQuote ? ['over', 'under'].map(direction => ({ kind: 'total', market: 'total_points', direction, line: totalQuote.line, scope: totalQuote.scope })) : [];
  const totalPrices = totalPicks.length && totalPicks.every(pick => matchPickQuote(options.oddsData, event, pick, options).status === 'matched')
    ? `<div class="observed-market"><span class="small">Linia z odczytu źródła: ${number(totalQuote.line)} pkt</span><div class="observed-price-options">${totalPicks.map(pick => `<div><span>${pick.direction === 'over' ? 'Powyżej' : 'Poniżej'} ${number(pick.line)}</span>${pickOddsHTML(options.oddsData, event, pick, options)}</div>`).join('')}</div><button type="button" data-use-source-line data-odds-event="${esc(event.id)}" data-line="${totalQuote.line}">Porównaj typ dla tej linii</button></div>` : '';
  return { winnerPrices, totalPrices };
}

export function matchPicksHTML(analysis, event, options = {}) {
  const data = buildMatchPicks(analysis, event, options), compact = options.compact === true;
  if (data.status === 'closed') return '<section class="match-picks betting-closed"><p class="small">Analiza archiwalna — bez aktywnego typu przedmeczowego.</p></section>';
  if (data.status === 'unavailable') return `<section class="match-picks"><p class="small">${esc(data.reason)}</p></section>`;
  const sourceMarkets = observedMarkets(options, event);
  const best = data.best ? `<div class="match-best"><span class="small">Najmocniejszy sygnał z historii</span><div class="pick-title-row"><${compact ? 'h4' : 'h3'}>${esc(data.best.label)}</${compact ? 'h4' : 'h3'}>${pickOddsHTML(options.oddsData, event, data.best, options)}</div>${supportHTML(data.best, event)}</div>` : `<p class="small">${esc(data.reason)}</p>`;
  if (compact) return `<section class="match-picks compact">${best}${!data.best || data.best.kind !== 'result' ? sourceMarkets.winnerPrices : ''}${sourceMarkets.totalPrices}${data.totals ? `<p class="small">Linia ${data.totals.lineOrigin === 'manual' ? 'wpisana' : 'analityczna'}: ${number(data.totals.line)} pkt • z dogrywką.</p>` : ''}</section>`;
  const winner = data.candidates.find(row => row.kind === 'result'), total = data.candidates.find(row => row.kind === 'total');
  const totals = data.totals;
  const totalSelections = totals ? ['over', 'under'].map(direction => ({ kind: 'total', market: 'total_points', scope: 'including_overtime', direction, line: totals.line })) : [];
  const matchedTotals = totalSelections.length && totalSelections.every(pick => matchPickQuote(options.oddsData, event, pick, options).status === 'matched');
  const totalPrices = matchedTotals ? `<div class="total-odds-grid">${totalSelections.map(pick => `<div><span>${pick.direction === 'over' ? 'Powyżej' : 'Poniżej'} ${number(pick.line)}</span>${pickOddsHTML(options.oddsData, event, pick, options)}</div>`).join('')}</div>` : '';
  return `<section class="match-picks"><h3>Wynik czy suma punktów?</h3>${best}<div class="match-market-grid"><section class="match-market-option"><h4>Wynik</h4>${winner ? `<div class="pick-title-row"><p><b>${esc(winner.label)}</b></p>${pickOddsHTML(options.oddsData, event, winner, options)}</div>${supportHTML(winner, event)}` : `<p class="small">Forma nie wskazuje wyraźnie jednej strony na rynku wyniku.</p>${sourceMarkets.winnerPrices}`}</section><section class="match-market-option"><h4>Suma punktów</h4>${totals ? `<p><b>${total ? esc(total.label) : `Linia ${number(totals.line)} pkt — kierunek nierozstrzygnięty`}</b></p>${total ? pickOddsHTML(options.oddsData, event, total, options) : ''}<p class="small">${esc(event.home)}: powyżej ${totals.home.over}/${totals.home.sample}, poniżej ${totals.home.under}/${totals.home.sample}.<br>${esc(event.away)}: powyżej ${totals.away.over}/${totals.away.sample}, poniżej ${totals.away.under}/${totals.away.sample}.</p><p class="small">${totals.uniqueSample} różnych spotkań. Średnia ich sum: ${number(totals.referenceAverage)} pkt.</p>${totalPrices}` : '<p class="small">Suma punktów jest dostępna dla NBA.</p>'}</section></div>${totals ? `<p class="small">${totals.lineOrigin === 'manual' ? 'Porównujesz własną linię.' : 'Linia analityczna jest najbliższą połówką średniej wcześniejszych sum; nie jest linią pobraną z oferty.'} Zakres: wynik końcowy NBA z dogrywką.</p><form data-match-line><label>Twoja linia sumy punktów<input name="totalLine" type="text" inputmode="decimal" value="${number(totals.line)}" required></label><button type="submit">Porównaj linię</button><p data-match-line-result class="small" role="status"></p></form>` : ''}<details><summary>Jak porównujemy rynki?</summary><p class="small">${esc(data.note)} Wyróżniamy kierunek mający większe poparcie w słabszej z dwóch historii, a przy remisie porównujemy oba bilanse łącznie. To porównanie opisowe, nie porównanie zysku lub kursów.</p></details></section>`;
}
