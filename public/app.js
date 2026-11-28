import { previewHTML, matchDetailHTML, playerFormHTML } from '/analysis-view.js';
import { createJournalUI } from '/journal-ui.js';
import { contextHTML, availabilityHTML } from '/context-view.js';
import { readinessHTML } from '/readiness-view.js';
import { oddsHTML } from '/odds-view.js';
import { buildPlayerPicks, playerPicksHTML, evaluatePlayerLine } from '/player-picks.js';
import { buildMatchPicks, matchPicksHTML } from '/match-picks.js';
import { matchChartsHTML } from '/match-charts.js';
import { buildFootballAnalysis } from '/football-analysis.js';
import { footballAnalysisCardHTML, footballAnalysisDetailHTML } from '/football-analysis-view.js';
import { buildFootballExtraAnalysis } from '/football-extra-analysis.js';
import { footballExtraCardHTML, footballExtraDetailHTML } from '/football-extra-view.js';
import { buildNBAAnalysis } from '/nba-analysis.js';
import { buildNHLAnalysis } from '/nhl-analysis.js';
import { nhlAnalysisCardHTML, nhlAnalysisDetailHTML, nhlPickReasonsHTML } from '/nhl-analysis-view.js';
import { nbaAnalysisCardHTML, nbaAnalysisDetailHTML, nbaPickReasonsHTML } from '/nba-analysis-view.js';
import { playerPickReasonsHTML } from '/player-pick-reasons.js';
import { matchPickQuote, pickOddsHTML, pickOddsContentHTML } from '/pick-odds.js';
import { playerPhotoHTML, installPlayerPhotoFallback } from '/player-photo.js';
import { cs2SourceHTML } from '/source-status.js';
import { journalPickButtonHTML } from '/pick-actions.js';
import { createAvailabilityMemory } from '/availability-memory.js';
import { screenPick } from '/pick-screening.js';
import { dailyPicksHTML } from '/daily-picks.js';
import { playerFormCardsHTML } from '/player-form-cards.js';
const availabilityMemory = createAvailabilityMemory();
installPlayerPhotoFallback(document);
const sports = { football: '⚽ Piłka', nba: '🏀 NBA', nhl: '🏒 NHL', tennis: '🎾 Tenis', cs2: '🎮 CS2' };
const leagues = {
  football: [['all', 'Wszystkie ligi'], ['eng.1', 'Premier League'], ['esp.1', 'La Liga'], ['ger.1', 'Bundesliga'], ['ita.1', 'Serie A'], ['fra.1', 'Ligue 1'], ['pol.1', 'Ekstraklasa'], ['usa.1', 'MLS'], ['uefa.champions', 'Liga Mistrzów'], ['uefa.europa', 'Liga Europy'], ['eng.2', 'Championship'], ['ned.1', 'Eredivisie'], ['por.1', 'Portugalia']],
  nba: [['all', 'NBA']], nhl: [['all', 'NHL']], tennis: [['all', 'ATP i WTA'], ['atp', 'ATP'], ['wta', 'WTA']], cs2: [['all', 'CS2']],
};
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => Number.isFinite(value) ? value.toFixed(3) : '—';
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const localDate = value => value ? new Date(value).toLocaleString('pl-PL') : '—';
let sport = 'nba', league = 'all', events = [], archiveEvents = [], report = null, readinessReport = null, detailEvent = null, nextFixture = null;
let loadController, detailController, previewController, lastDetailButton, renderVersion = 0;
let viewAsOf = Math.floor(Date.now() / 60000) * 60000;
let marketView = 'daily';
let playerCardContext = '', playerCardAthlete = 'all', playerCardMetric = 'all', playerCardsExpanded = false, footballCardLimit = 6, nbaCardLimit = 4, nhlCardLimit = 4, footballExtraLimit = 2;
let pickScreening = { minOdds: 1.5, band: 'all' };
try {
  const saved = JSON.parse(localStorage.getItem('sportlab.pick-screening.v1'));
  if (Number.isFinite(saved?.minOdds) && saved.minOdds >= 1.01 && saved.minOdds <= 1000 && ['all', 'lower', 'higher'].includes(saved.band)) pickScreening = { minOdds: saved.minOdds, band: saved.band };
} catch { /* Missing or corrupt preferences keep the default 1.50 filter. */ }
const priceLabel = value => value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const noPricedPicks = () => `Brak pozycji z pasującym odczytem kursu od ${priceLabel(pickScreening.minOdds)} w wybranym zakresie. Statystyki i wykresy pozostają dostępne w analizie.`;
function pricedGroups(rows, pickOf, render, gridClass) {
  return ['lower', 'higher'].map(band => {
    const group = rows.filter(row => { const item = screenPick(pickOf(row), row.event, { ...pickScreening, oddsData: oddsFor(row.event) }); return item.eligible && item.band === band; });
    return group.length ? `<section class="priced-group" data-price-band="${band}"><h3>${band === 'lower' ? 'Kurs poniżej 2,00' : 'Kurs od 2,00'}</h3><p class="small">Zakres ceny · ryzyko niezweryfikowane</p><div class="${gridClass}">${group.map(render).join('')}</div></section>` : '';
  }).join('');
}
const previews = new Map();
const matchLines = new Map();
const footballExtras = new Map(), footballExtraLines = new Map(), footballExtraDrafts = new Map(), footballExtraLineMessages = new Map();
let footballExtraTail = Promise.resolve();
const playerInspectors = new Map();
const playerForms = new Map(), fixtureDetails = new Map(), playerDrafts = new Map(), matchDrafts = new Map();
let playerQueue = [], playerWorkers = 0;
let detailRequests = 0;
const detailWaiters = [];
const today = new Date();
$('date').value = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

async function json(url, signal) {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function boundedDetails(url, signal) {
  if (detailRequests >= 2) await new Promise(resolve => detailWaiters.push(resolve)); else detailRequests++;
  try {
    if (signal?.aborted) throw new DOMException('Przerwano pobieranie', 'AbortError');
    return await json(url, signal);
  } finally {
    const next = detailWaiters.shift();
    if (next) next(); else detailRequests--;
  }
}
function oddsFor(event) { return fixtureDetails.get(event.id)?.data?.odds || null; }
function marketOptions(event) {
  const oddsData = oddsFor(event);
  if (matchLines.has(event.id)) return { totalLine: matchLines.get(event.id), oddsData, screening: pickScreening };
  const sourceLine = oddsData?.quotes?.find(quote => quote?.market === (['nhl', 'football'].includes(event.sport) ? 'total_goals' : 'total_points') && quote.scope === (event.sport === 'football' ? 'regulation_90' : event.sport === 'nhl' ? 'including_overtime_shootout' : 'including_overtime')
    && ['over', 'under'].every(direction => matchPickQuote(oddsData, event, { kind: 'total', market: quote.market, scope: quote.scope, line: quote.line, direction }).status === 'matched'));
  return { ...(sourceLine ? { totalLine: sourceLine.line, totalLineOrigin: 'source' } : {}), oddsData, screening: pickScreening };
}
function updateOddsNodes(event) {
  document.querySelectorAll('[data-pick-odds]').forEach(node => {
    if (node.dataset.oddsEvent !== event.id) return;
    try {
      const pick = JSON.parse(node.dataset.oddsPick);
      const result = matchPickQuote(oddsFor(event), event, pick);
      node.innerHTML = pickOddsContentHTML(oddsFor(event), event, pick);
      node.classList.remove('pick-odds-matched', 'pick-odds-unavailable', 'pick-odds-closed');
      node.classList.add(`pick-odds-${result.status}`); node.dataset.oddsStatus = result.status;
    } catch { node.textContent = 'Kurs niedostępny'; }
  });
}
function cutoffFor(event) {
  const time = new Date(Math.min(viewAsOf, Date.parse(event.date)));
  time.setUTCSeconds(0, 0);
  return time.toISOString();
}
function previewKey(event) { return `${event.id}:${cutoffFor(event)}`; }
function playerCutoffFor() { return new Date(Math.floor(viewAsOf / 300000) * 300000).toISOString(); }
function playerKey(event, teamId) { return `${event.route}:${teamId}:${playerCutoffFor(event)}`; }
function playerEntryFresh(entry) {
  return entry?.data && Number.isFinite(Date.parse(entry.data.fetchedAt)) && Date.now() - Date.parse(entry.data.fetchedAt) < 5 * 60000;
}
function renderPlayerPickNode(node, data, event) {
  const key = `${event.id}:${data.teamId}`, drafts = playerDrafts.get(key) || new Map();
  for (const form of node.querySelectorAll('[data-player-line]')) {
    const field = document.activeElement;
    drafts.set(`${form.dataset.playerId}:${form.dataset.metric}`, { line: form.elements.line.value.slice(0, 50), direction: form.elements.direction.value,
      open: form.closest('details')?.open, compared: Boolean(form.querySelector('[data-line-result]')?.textContent), focus: form.contains(field) ? field.name : null });
  }
  playerDrafts.set(key, drafts);
  node.innerHTML = playerPicksHTML(data, event, { excludedPlayerIds: excludedPlayers(event), showNote: false, oddsData: oddsFor(event), screening: pickScreening });
  for (const form of node.querySelectorAll('[data-player-line]')) {
    const draft = drafts.get(`${form.dataset.playerId}:${form.dataset.metric}`);
    if (!draft) continue;
    form.elements.line.value = draft.line; form.elements.direction.value = draft.direction;
    if (form.closest('details')) form.closest('details').open = draft.open;
    if (draft.compared) form.querySelector('[data-line-result]').textContent = 'Dane odświeżone. Porównaj zachowaną linię ponownie.';
    if (draft.focus) form.elements.namedItem(draft.focus)?.focus({ preventScroll: true });
  }
}
function updateMatchDetail(event, data) {
  if (detailEvent?.id !== event.id || !$('modal').classList.contains('on') || !$('betting-detail')) return;
  const options = marketOptions(event), picks = buildMatchPicks(data, event, options), node = $('betting-detail');
  const key = `${data.cutoff}:${oddsFor(event)?.fetchedAt}:${options.totalLine}:${picks.status}:${pickScreening.minOdds}:${pickScreening.band}`;
  if (node.dataset.renderKey !== key) {
    const toolsOpen = node.querySelector('.fa-tools')?.open;
    const comparisonOpen = node.querySelector('.football-analysis-detail .fa-other-markets, .nba-market-comparison, .nhl-market-comparison')?.open;
    const input = node.querySelector('[name=totalLine]');
    if (input && (input.value !== input.defaultValue || document.activeElement === input)) matchDrafts.set(event.id, { value: input.value.slice(0, 50), focus: document.activeElement === input });
    const football = event.sport === 'football' ? buildFootballAnalysis(data, event, options) : null;
    const nba = event.sport === 'nba' ? buildNBAAnalysis(data, event, options) : null;
    const nhl = event.sport === 'nhl' ? buildNHLAnalysis(data, event, options) : null;
    node.innerHTML = football
      ? footballAnalysisDetailHTML(football, event, options) + matchChartsHTML(data, event, { line: football.line ?? picks.totals?.line ?? null }) + `<details class="fa-tools"><summary>Własna linia goli i dodatkowe porównania</summary>${matchPicksHTML(data, event, options)}</details>`
      : nba ? nbaAnalysisDetailHTML(nba, event, options) + matchChartsHTML(data, event, { line: nba.line ?? picks.totals?.line ?? null }) + `<details class="fa-tools nba-tools"><summary>Własna linia punktów i dodatkowe porównania</summary>${matchPicksHTML(data, event, options)}</details>`
      : nhl ? nhlAnalysisDetailHTML(nhl, event, options) + matchChartsHTML(data, event, { line: nhl.line ?? picks.totals?.line ?? null }) + `<details class="fa-tools nhl-tools"><summary>Własna linia goli i dodatkowe porównania</summary>${matchPicksHTML(data, event, options)}</details>`
      : matchPicksHTML(data, event, options) + matchChartsHTML(data, event, { line: picks.totals?.line ?? null });
    node.dataset.marketStatus = picks.status; node.dataset.renderKey = key;
    if (toolsOpen && node.querySelector('.fa-tools')) node.querySelector('.fa-tools').open = true;
    if (comparisonOpen && node.querySelector('.football-analysis-detail .fa-other-markets, .nba-market-comparison, .nhl-market-comparison')) node.querySelector('.football-analysis-detail .fa-other-markets, .nba-market-comparison, .nhl-market-comparison').open = true;
    const draft = matchDrafts.get(event.id), updated = node.querySelector('[name=totalLine]');
    if (draft && updated) { updated.value = draft.value; if (draft.focus) updated.focus({ preventScroll: true }); }
  }
  $('match-detail').innerHTML = matchDetailHTML(data, event) + contextHTML(data, event);
}
function excludedPlayers(event) { return availabilityMemory.excluded(event); }
function updateCurrentDetails(event, data, failed = false) {
  if (detailEvent?.id !== event.id || !$('source-odds')) return;
  $('source-odds').innerHTML = oddsHTML(data.odds, event);
  const retained = availabilityMemory.retained(event).length, age = Date.now() - Date.parse(data.availability?.fetchedAt);
  $('availability').innerHTML = availabilityHTML(data, event) + (retained || failed || age > 15 * 60000 ? `<p class="small" role="status">${retained ? `Zachowano wcześniejsze wykluczenia zawodników: ${retained}. Brak nowego raportu nie potwierdza dostępności. ` : ''}${failed || age > 15 * 60000 ? 'Raport wymaga odświeżenia; ostatnia obserwacja pozostaje oznaczona datą.' : ''}</p>` : '');
  $('match-boxscore').innerHTML = existingStatsHTML(data, event);
}

function eventPlayerPicks(event, { analysis = false } = {}) {
  const options = { excludedPlayerIds: excludedPlayers(event), oddsData: oddsFor(event), screening: analysis ? undefined : pickScreening, analysisOnly: analysis };
  const home = playerForms.get(playerKey(event, event.homeId))?.data;
  const away = playerForms.get(playerKey(event, event.awayId))?.data;
  const lists = [home, away].map(data => data ? buildPlayerPicks(data, event, options).picks.map(pick => ({
    ...pick, kind: 'player', market: 'player_prop', teamId: data.teamId,
    scope: event.sport === 'nba' ? 'including_overtime' : event.sport === 'football' ? 'regulation_90' : 'including_overtime_excluding_shootout',
  })) : []);
  const all = lists[0].flatMap((pick, index) => [pick, lists[1][index]].filter(Boolean)).concat(lists[1].slice(lists[0].length));
  const first = [], metrics = new Set();
  for (const pick of all) if (!metrics.has(pick.metric)) { metrics.add(pick.metric); first.push(pick); }
  return first.concat(all.filter(pick => !first.includes(pick)));
}
function playerPreviewContent(event) {
  if (!['nba', 'nhl', 'football'].includes(event.sport) || event.state !== 'pre' || Date.parse(event.date) <= Date.now()) return '';
  if (event.route === 'soccer/pol.1') return '<p class="small">Ekstraklasa: dostępna forma drużyn i suma goli. Źródło nie udostępnia statystyk zawodników ani kursów tej ligi.</p>';
  const picks = eventPlayerPicks(event).slice(0, 3);
  const entries = [event.homeId, event.awayId].map(id => playerForms.get(playerKey(event, id)));
  return `<div class="preview-heading">Typy na zawodników</div>${picks.length
    ? picks.map(pick => `<div class="player-preview-pick"><span class="player-identity">${playerPhotoHTML({ id: pick.playerId, name: pick.playerName, headshot: pick.headshot }, event.sport)}<b>${esc(pick.statement)}</b></span>${pickOddsHTML(oddsFor(event), event, pick)}<span class="small">${pick.hits} z ${pick.sample} wcześniejszych występów powyżej linii</span></div>`).join('')
    : `<p class="small">${entries.some(entry => entry?.status === 'loading') ? 'Analizowanie do 10 wcześniejszych meczów…' : entries.every(entry => entry?.data) ? 'Brak pozycji z odczytem kursu spełniającym filtr. Pełna forma w analizie.' : 'Punkty, asysty, zbiórki i strzały — otwórz typy zawodników.'}</p>`}`;
}
function playerOverviewHTML(event, teamId) {
  const entry = playerForms.get(playerKey(event, teamId)), data = entry?.data;
  if (entry?.status === 'error') return '<p class="small">Statystyki zawodników są chwilowo niedostępne. Otwórz analizę ponownie, aby powtórzyć pobranie.</p>';
  if (!data) return '<p class="small">Wczytywanie występów zawodników…</p>';
  return playerFormHTML(data, teamId === event.homeId ? event.home : event.away, { ...playerInspectors.get(`${event.id}:${teamId}`), eventId: event.id });
}
function updatePlayerViews(event) {
  document.querySelectorAll('[data-player-preview]').forEach(node => { if (node.dataset.playerPreview === event.id) node.innerHTML = playerPreviewContent(event); });
  if (detailEvent?.id === event.id && $('modal').classList.contains('on')) {
    for (const [side, teamId, name] of [['home', event.homeId, event.home], ['away', event.awayId, event.away]]) {
      const entry = playerForms.get(playerKey(event, teamId));
      if (entry?.data) {
        const eligible = buildPlayerPicks(entry.data, event, { excludedPlayerIds: excludedPlayers(event), oddsData: oddsFor(event), screening: pickScreening }).picks.map(pick => `${pick.playerId}:${pick.metric}:${pick.line}`).join(',');
        const key = `${entry.data.fetchedAt}:${Date.now() - Date.parse(entry.data.fetchedAt) > 15 * 60000}:${oddsFor(event)?.fetchedAt || ''}:${excludedPlayers(event).join(',')}:${event.state}:${Date.parse(event.date) <= Date.now()}:${pickScreening.minOdds}:${pickScreening.band}:${eligible}`;
        const pickNode = $(`player-picks-${side}`), formNode = $(`players-${side}`);
        if (pickNode && pickNode.dataset.renderKey !== key) { renderPlayerPickNode(pickNode, entry.data, event); pickNode.dataset.renderKey = key; }
        if (formNode && formNode.dataset.renderKey !== entry.data.fetchedAt) { formNode.innerHTML = playerOverviewHTML(event, teamId); formNode.dataset.renderKey = entry.data.fetchedAt; }
      } else if (entry?.status === 'error') {
        if ($(`player-picks-${side}`)) $(`player-picks-${side}`).innerHTML = `<p class="small">Statystyki ${esc(name)} są chwilowo niedostępne. Otwórz analizę ponownie, aby powtórzyć pobranie.</p>`;
        if ($(`players-${side}`)) $(`players-${side}`).innerHTML = playerOverviewHTML(event, teamId);
      }
    }
  }
  renderBetting();
}
function requestPlayerForm(event, teamId, signal) {
  const key = playerKey(event, teamId), existing = playerForms.get(key);
  if (existing?.promise) return existing.promise;
  if (playerEntryFresh(existing)) return Promise.resolve(existing.data);
  const entry = { status: 'loading', ...(existing?.data ? { data: existing.data } : {}) };
  playerForms.set(key, entry);
  const params = new URLSearchParams({ sport: event.sport, route: event.route, teamId, cutoff: playerCutoffFor(event), count: '10', view: 'latest' });
  entry.promise = json(`/api/player-form?${params}`, signal).then(data => {
    entry.status = 'ready'; entry.data = data; delete entry.promise; updatePlayerViews(event); return data;
  }).catch(error => { entry.status = signal?.aborted ? 'idle' : 'error'; delete entry.promise; updatePlayerViews(event); throw error; });
  updatePlayerViews(event);
  return entry.promise;
}
function queuePricedPlayerForms(selected) {
  if (!['daily', 'players'].includes(marketView)) return;
  const eligible = selected.filter(event => events.some(row => row.id === event.id) && oddsFor(event)?.quotes?.some(quote => quote.market === 'player_prop'
    && ({ nba: ['PTS', 'AST', 'REB'], nhl: ['S'], football: ['SH'] }[event.sport] || []).includes(quote.metric)
    && ['over', 'under'].some(direction => screenPick({ kind: 'player', market: 'player_prop', playerId: quote.playerId, teamId: quote.teamId, metric: quote.metric, line: quote.line, direction, scope: quote.scope }, event, { ...pickScreening, oddsData: oddsFor(event) }).eligible)));
  if (eligible.length) queuePlayerForms(eligible, eligible.length, true);
}
function requestFixtureDetails(event, signal) {
  const cached = fixtureDetails.get(event.id);
  if (cached?.promise) return cached.promise;
  if (cached?.data && Date.now() - Date.parse(cached.data.fetchedAt) < (cached.data.odds?.status === 'available' ? 60000 : 5 * 60000)) return Promise.resolve(cached.data);
  const params = new URLSearchParams({ sport: event.sport, route: event.route, id: event.sourceEventId });
  const entry = { ...(cached?.data ? { data: cached.data } : {}) };
  entry.promise = boundedDetails(`/api/details?${params}`, signal).then(data => {
    entry.data = data; delete entry.promise; availabilityMemory.observe(event, data); updateOddsNodes(event); updatePreviewNodes(event); updatePlayerViews(event);
    queuePricedPlayerForms([event]);
    updateCurrentDetails(event, data);
    return data;
  })
    .catch(error => { delete entry.promise; if (entry.data) updateCurrentDetails(event, entry.data, true); throw error; });
  fixtureDetails.set(event.id, entry);
  return entry.promise;
}
function queuePlayerForms(selected, count = 2, prioritize = false, includePast = false) {
  const signal = loadController?.signal;
  const candidates = selected.filter(event => ['nba', 'nhl', 'football'].includes(event.sport) && (includePast || event.state === 'pre' && Date.parse(event.date) > Date.now())
    && ![event.homeId, event.awayId].every(id => playerEntryFresh(playerForms.get(playerKey(event, id)))));
  for (const event of candidates.slice(0, count)) {
    void requestFixtureDetails(event, signal).catch(() => {});
    for (const teamId of [event.homeId, event.awayId]) {
      const key = playerKey(event, teamId);
      if (!playerEntryFresh(playerForms.get(key)) && !playerForms.get(key)?.promise && !playerQueue.some(job => job.key === key)) {
        const job = { event, teamId, key, signal };
        if (prioritize) playerQueue.unshift(job); else playerQueue.push(job);
      }
    }
  }
  async function worker() {
    playerWorkers++;
    try { while (playerQueue.length) { const job = playerQueue.shift(); if (job.signal?.aborted) continue; try { await requestPlayerForm(job.event, job.teamId, job.signal); } catch {} } }
    finally { playerWorkers--; }
  }
  while (playerWorkers < 2 && playerQueue.length) void worker();
}
function previewRequest(event, signal) {
  const key = previewKey(event), cached = previews.get(key);
  if (cached?.promise) return cached.promise;
  if (cached?.data) return Promise.resolve(cached.data);
  const params = new URLSearchParams({ sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId, cutoff: cutoffFor(event), fixtureId: event.id });
  if (event.sport === 'football' && event.route !== 'soccer/pol.1' && event.state === 'pre' && Date.parse(event.date) > Date.now()) { params.set('view', 'current'); params.set('fixtureStart', new Date(event.date).toISOString()); }
  const entry = { status: 'loading', attemptedAt: Date.now() };
  entry.promise = json(`/api/match-analysis?${params}`, signal).then(data => {
    entry.status = 'ready'; entry.data = data; delete entry.promise; updatePreviewNodes(event); return data;
  }).catch(error => {
    delete entry.promise;
    entry.status = signal?.aborted ? 'idle' : 'error';
    updatePreviewNodes(event); throw error;
  });
  previews.set(key, entry);
  return entry.promise;
}
function previewContent(event) {
  const entry = previews.get(previewKey(event));
  if (entry?.data) {
    const options = marketOptions(event);
    const picks = buildMatchPicks(entry.data, event, options);
    if (event.sport === 'football') return footballAnalysisCardHTML(buildFootballAnalysis(entry.data, event, options), event, options);
    if (event.sport === 'nba') return nbaAnalysisCardHTML(buildNBAAnalysis(entry.data, event, options), event, options);
    if (event.sport === 'nhl') return nhlAnalysisCardHTML(buildNHLAnalysis(entry.data, event, options), event, options);
    return matchPicksHTML(entry.data, event, { ...options, compact: true })
      + matchChartsHTML(entry.data, event, { line: picks.totals?.line ?? null, compact: true })
      + `<details class="card-form-details"><summary>Forma obu drużyn</summary>${previewHTML(entry.data, event)}</details>`;
  }
  if (entry?.status === 'error') return '<p class="small">Podsumowanie chwilowo niedostępne. Otwórz analizę, aby spróbować ponownie.</p>';
  return '<p class="small">Pobieranie porównania ostatnich wyników…</p>';
}
function updatePreviewNodes(event) {
  document.querySelectorAll('[data-preview]').forEach(node => { if (node.dataset.preview === event.id) node.innerHTML = previewContent(event); });
  const data = previews.get(previewKey(event))?.data;
  if (data) updateMatchDetail(event, data);
  renderBetting();
}
function footballExtraResult(event) {
  const identity = { sport: 'football', route: event.route, fixtureId: event.id, scope: 'regulation_90', metrics: [] };
  if (event.state !== 'pre' || Date.parse(event.date) <= Date.now()) return { ...identity, status: 'closed', reason: 'Dodatkowe porównania są dostępne przed rozpoczęciem meczu.' };
  if (event.route === 'soccer/pol.1') return { ...identity, status: 'unavailable', reason: 'Darmowe źródło Ekstraklasy nie udostępnia potwierdzonej historii rożnych, kartek i strzałów.' };
  const entry = footballExtras.get(event.id);
  if (entry?.data?.status === 'unavailable' && entry.data.fixtureId === event.id && entry.data.route === event.route && entry.data.scope === 'regulation_90') return { ...identity, status: 'unavailable', reason: entry.data.reason, notes: entry.data.notes };

  if (entry?.data) return buildFootballExtraAnalysis(entry.data, event, { lines: footballExtraLines.get(event.id) || {} });
  return { sport: 'football', route: event.route, fixtureId: event.id, scope: 'regulation_90', metrics: [],
    status: event.state !== 'pre' || Date.parse(event.date) <= Date.now() ? 'closed' : entry?.status === 'error' ? 'unavailable' : 'loading',
    reason: entry?.status === 'error' ? entry.message || 'Źródło dodatkowych statystyk jest chwilowo niedostępne.' : 'Sprawdzanie rożnych, żółtych kartek i strzałów z poprzednich meczów…' };
}
function extraFocus(root) {
  const field = document.activeElement, form = field?.closest?.('[data-football-extra-line]');
  return form && root.contains(field) && field.name === 'line' ? { fixture: form.dataset.fixtureId, metric: form.dataset.metric, start: field.selectionStart, end: field.selectionEnd } : null;
}
function restoreExtraForms(root, focus) {
  for (const form of root.querySelectorAll('[data-football-extra-line]')) {
    const key = `${form.dataset.fixtureId}:${form.dataset.metric}`, field = form.elements.namedItem('line');
    if (footballExtraDrafts.has(key)) field.value = footballExtraDrafts.get(key);
    form.querySelector('[data-extra-line-result]').textContent = footballExtraLineMessages.get(key) || '';
    if (focus?.fixture === form.dataset.fixtureId && focus.metric === form.dataset.metric) {
      for (let parent = field.closest('details'); parent && root.contains(parent); parent = parent.parentElement?.closest('details')) parent.open = true;
      field.focus({ preventScroll: true });
      if (focus.start != null) field.setSelectionRange(focus.start, focus.end);
    }
  }
}
function updateFootballExtraDetail(event) {
  const node = $('football-extra-detail');
  if (!node || detailEvent?.id !== event.id || !$('modal').classList.contains('on')) return;
  const focus = extraFocus(node);
  node.innerHTML = footballExtraDetailHTML(footballExtraResult(event), event);
  restoreExtraForms(node, focus);
}
function requestFootballExtras(event, signal) {
  if (event.sport !== 'football' || event.route === 'soccer/pol.1' || event.state !== 'pre' || Date.parse(event.date) <= Date.now() || Date.parse(event.date) - Date.now() > 48 * 3600000) return Promise.resolve(null);
  const previous = footballExtras.get(event.id);
  if (previous?.promise) return previous.promise;
  const age = Date.now() - Date.parse(previous?.data?.observedAt);
  if (previous?.data && age >= 0 && age < (previous.data.status === 'available' ? 5 * 60000 : 30000)) return Promise.resolve(previous.data);
  const entry = { ...previous, status: 'loading', attemptedAt: Date.now() }, before = footballExtraTail;
  let release;
  footballExtraTail = new Promise(resolve => { release = resolve; });
  footballExtras.set(event.id, entry);
  entry.promise = (async () => {
    await before;
    try {
      if (signal?.aborted) throw new DOMException('Przerwano pobieranie', 'AbortError');
      const query = new URLSearchParams({ sport: 'football', route: event.route, homeId: event.homeId, awayId: event.awayId, fixtureId: event.id, fixtureStart: new Date(event.date).toISOString() });
      return await json(`/api/football-extra-stats?${query}`, signal);
    } finally { release(); }
  })().then(data => { entry.data = data; entry.status = 'ready'; delete entry.promise; updateFootballExtraDetail(event); renderBetting(); return data; })
    .catch(error => { entry.status = signal?.aborted ? 'idle' : 'error'; entry.message = error.message; delete entry.promise; updateFootballExtraDetail(event); renderBetting(); throw error; });
  return entry.promise;
}
function footballExtraSection(upcoming) {
  return `<section id="football-extra-analysis" class="football-extra-section" data-football-extra-analysis><h3>Dodatkowe kierunki — rożne, kartki i strzały</h3><p class="small">Sumy obu drużyn w poprzednich meczach, uzasadnienia, kontrargumenty i porównanie Twojej linii. Są to analizy statystyk; cenę i zasady właściwego rynku sprawdź w ofercie.</p><div class="football-extra-grid">${upcoming.slice(0, footballExtraLimit).map(event => footballExtraCardHTML(footballExtraResult(event), event)).join('')}</div>${upcoming.length > footballExtraLimit ? `<button type="button" data-more-football-extra>Sprawdź kolejne mecze (${upcoming.length - footballExtraLimit})</button>` : ''}</section>`;
}
function bindFootballExtraActions(upcoming, focus) {
  restoreExtraForms($('betting-summary'), focus);
  for (const event of upcoming.slice(0, footballExtraLimit)) {
    const entry = footballExtras.get(event.id), age = Date.now() - Date.parse(entry?.data?.observedAt);
    const expired = entry?.data && age >= (entry.data.status === 'available' ? 5 * 60000 : 30000);
    if (!entry || entry.status === 'idle' || !entry.promise && (expired || entry.status === 'error') && Date.now() - (entry.attemptedAt || 0) >= 60000) void requestFootballExtras(event, loadController?.signal).catch(() => {});
  }
  const more = document.querySelector('[data-more-football-extra]');
  if (more) more.onclick = () => {
    footballExtraLimit += 2;
    renderBetting();
    for (const event of upcoming.slice(0, footballExtraLimit)) void requestFootballExtras(event, loadController?.signal).catch(() => {});
  };
}
function footballAnalysisSection(upcoming) {
  const rows = upcoming.slice(0, footballCardLimit).map(event => {
    const entry = previews.get(previewKey(event)), options = marketOptions(event);
    const analysis = entry?.data ? buildFootballAnalysis(entry.data, event, options) : {
      sport: 'football', route: event.route, fixtureId: event.id,
      status: entry?.status === 'error' ? 'unavailable' : 'loading', best: null, candidates: [],
      reason: entry?.status === 'error' ? 'Źródło analizy jest chwilowo niedostępne. Otwórz szczegóły lub odśwież dane.' : 'Sprawdzanie wyników obu drużyn i rynków meczu…',
    };
    return { event, analysis, options };
  });
  rows.sort((a, b) => Number(Boolean(b.analysis.best)) - Number(Boolean(a.analysis.best)) || Date.parse(a.event.date) - Date.parse(b.event.date));
  return `<section class="football-daily-analysis" data-football-analysis><h3>Analizy dnia — wynik i gole</h3><a class="small" href="#football-extra-analysis">Rożne, kartki i strzały — dodatkowe analizy</a><p class="small">Kierunek z formy, argumenty za i przeciw oraz ostatnie wyniki drużyn. Brak kursu nie ukrywa analizy. Kolejność pokazuje najpierw mecze ze zgodnym kierunkiem historycznym.</p><div class="football-analysis-grid">${rows.map(({ event, analysis, options }) => footballAnalysisCardHTML(analysis, event, options)).join('')}</div>${upcoming.length > footballCardLimit ? `<button type="button" data-more-football>Pokaż kolejne analizy (${upcoming.length - footballCardLimit})</button>` : ''}<p class="small fa-method-note">Liczniki dotyczą wcześniejszych meczów. Wskazanie z formy nie określa szansy trafienia ani opłacalności przy danym kursie.</p></section>`;
}
function bindFootballAnalysisActions(upcoming, focus) {
  bindFootballExtraActions(upcoming, focus);
  document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
  const more = document.querySelector('[data-more-football]');
  if (more) more.onclick = () => {
    footballCardLimit += 6;
    renderBetting();
    queuePreviews(upcoming.slice(0, footballCardLimit).filter(event => !previews.get(previewKey(event))?.data).slice(0, 12));
  };
}
function dailyGameReasons({ event, pick, oddsData }) {
  if (!['nba', 'nhl'].includes(event.sport)) return '';
  const options = { now: Date.now(), compact: true };
  let content;
  if (pick.kind === 'player') content = playerPickReasonsHTML(pick, event, options);
  else {
    const data = previews.get(previewKey(event))?.data;
    if (!data) return '';
    const analysis = (event.sport === 'nhl' ? buildNHLAnalysis : buildNBAAnalysis)(data, event, { ...marketOptions(event), oddsData, ...options });
    const candidate = analysis.candidates.find(row => row.market === pick.market && row.scope === pick.scope
      && (pick.kind === 'total' ? row.direction === pick.direction && row.line === pick.line : row.side === pick.side));
    content = candidate ? (event.sport === 'nhl' ? nhlPickReasonsHTML : nbaPickReasonsHTML)(candidate, event, options) : '';
  }
  return content ? `<details class="daily-pick-explanation" data-daily-${event.sport}-reasons><summary>Dlaczego ten kierunek?</summary>${content}</details>` : '';
}
function nbaAnalysisSection(upcoming) {
  const rows = upcoming.slice(0, nbaCardLimit).map(event => {
    const entry = previews.get(previewKey(event)), options = marketOptions(event);
    const analysis = entry?.data ? buildNBAAnalysis(entry.data, event, options) : {
      sport: 'nba', route: event.route, fixtureId: event.id, status: entry?.status === 'error' ? 'unavailable' : 'loading',
      best: null, candidates: [], reason: entry?.status === 'error' ? 'Źródło analizy jest chwilowo niedostępne. Otwórz szczegóły lub odśwież dane.' : 'Porównywanie formy, wyniku i punktów obu drużyn…',
    };
    return { event, analysis, options };
  });
  rows.sort((a, b) => Number(b.analysis.winnerLean?.status === 'lean') - Number(a.analysis.winnerLean?.status === 'lean') || Date.parse(a.event.date) - Date.parse(b.event.date));
  return `<section id="nba-team-analysis" class="nba-daily-analysis" data-nba-team-analysis><h3>NBA — kto ma lepszą formę i dlaczego?</h3><p class="small">Zwycięzca i suma punktów: ostatnie wyniki, atak, straty punktów, forma dom/wyjazd oraz argumenty za i przeciw. Analiza pozostaje widoczna bez kursu.</p><div class="nba-analysis-grid">${rows.map(({ event, analysis, options }) => nbaAnalysisCardHTML(analysis, event, options)).join('')}</div>${upcoming.length > nbaCardLimit ? `<button type="button" data-more-nba>Pokaż kolejne analizy (${upcoming.length - nbaCardLimit})</button>` : ''}</section>`;
}
function bindNBAAnalysisActions(upcoming) {
  document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
  const more = document.querySelector('[data-more-nba]');
  if (more) more.onclick = () => {
    nbaCardLimit += 4;
    renderBetting();
    queuePreviews(upcoming.slice(0, nbaCardLimit).filter(event => !previews.get(previewKey(event))?.data).slice(0, 12));
  };
}
function nhlAnalysisSection(upcoming) {
  const rows = upcoming.slice(0, nhlCardLimit).map(event => {
    const entry = previews.get(previewKey(event)), options = marketOptions(event);
    const analysis = entry?.data ? buildNHLAnalysis(entry.data, event, options) : {
      sport: 'nhl', route: event.route, fixtureId: event.id, scope: 'including_overtime_shootout', status: entry?.status === 'error' ? 'unavailable' : 'loading',
      best: null, candidates: [], reason: entry?.status === 'error' ? 'Źródło analizy jest chwilowo niedostępne. Otwórz szczegóły lub odśwież dane.' : 'Porównywanie formy, wyniku i goli obu drużyn…',
    };
    return { event, analysis, options };
  });
  rows.sort((a, b) => Number(b.analysis.winnerLean?.status === 'lean') - Number(a.analysis.winnerLean?.status === 'lean') || Date.parse(a.event.date) - Date.parse(b.event.date));
  return `<section id="nhl-team-analysis" class="nhl-daily-analysis" data-nhl-team-analysis><h3>NHL — kto ma lepszą formę i dlaczego?</h3><p class="small">Zwycięzca i suma goli: ostatnie wyniki, gole zdobyte i stracone, dom/wyjazd oraz argumenty za i przeciw. Zakres: końcowy wynik z dogrywką i karnymi. Analiza pozostaje widoczna bez kursu.</p><div class="nhl-analysis-grid">${rows.map(({ event, analysis, options }) => nhlAnalysisCardHTML(analysis, event, options)).join('')}</div>${upcoming.length > nhlCardLimit ? `<button type="button" data-more-nhl>Pokaż kolejne analizy (${upcoming.length - nhlCardLimit})</button>` : ''}</section>`;
}
function bindNHLAnalysisActions(upcoming) {
  document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
  const more = document.querySelector('[data-more-nhl]');
  if (more) more.onclick = () => {
    nhlCardLimit += 4;
    renderBetting();
    queuePreviews(upcoming.slice(0, nhlCardLimit).filter(event => !previews.get(previewKey(event))?.data).slice(0, 12));
  };
}
function playerAnalysisSection(rows, loading) {
  const athletes = new Map();
  for (const { event, pick } of rows) athletes.set(`${event.id}:${pick.playerId}`, `${pick.playerName} · ${pick.teamId === event.homeId ? event.home : event.away}`);
  const metrics = { nba: [['PTS', 'Punkty'], ['AST', 'Asysty'], ['REB', 'Zbiórki']], nhl: [['S', 'Strzały na bramkę']], football: [['SH', 'Strzały']] }[sport] || [];
  const selected = rows.filter(row => (playerCardAthlete === 'all' || `${row.event.id}:${row.pick.playerId}` === playerCardAthlete) && (playerCardMetric === 'all' || row.pick.metric === playerCardMetric));
  const cards = playerFormCardsHTML(selected, { sport, ...pickScreening, analysis: true, limit: 12 });
  const count = (cards.match(/data-player-form-card/g) || []).length;
  const visibleCards = !playerCardsExpanded && count > 4 ? cards.replace('class="player-form-cards"', 'class="player-form-cards pfc-collapsed"') : cards;
  return `<section class="daily-player-section" data-player-analysis><h3>Zawodnicy — linia i ostatnie występy</h3><p class="small">Automatyczne porównania z historią. Brak kursu nie ukrywa wyników; linia analityczna nie jest rekomendacją.</p><div class="player-card-controls"><label>Zawodnik<select data-player-card-athlete><option value="all">Wszyscy zawodnicy</option>${playerCardAthlete !== 'all' && !athletes.has(playerCardAthlete) ? `<option value="${esc(playerCardAthlete)}" selected>Wybrany zawodnik — oczekiwanie na dane</option>` : ''}${[...athletes].sort((a, b) => a[1].localeCompare(b[1], 'pl')).map(([id, name]) => `<option value="${esc(id)}" ${id === playerCardAthlete ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label><label>Statystyka<select data-player-card-metric><option value="all">Wszystkie</option>${metrics.map(([key, name]) => `<option value="${key}" ${key === playerCardMetric ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>${visibleCards || `<p class="small" role="status">${loading ? 'Pobieranie ostatnich występów zawodników…' : 'Brak aktualnej porównywalnej historii dla tego wyboru. Pełne dostępne dane znajdziesz w szczegółach.'}</p>`}${count > 4 ? `<button type="button" data-expand-player-cards>${playerCardsExpanded ? 'Pokaż mniej kart' : `Pokaż pozostałe karty (${count - 4})`}</button>` : ''}</section>`;
}
function renderBetting() {
  const focusedExtra = extraFocus($('betting-summary'));
  const playerContext = `${sport}:${league}:${$('date').value}`;
  if (playerCardContext !== playerContext) { playerCardContext = playerContext; playerCardAthlete = 'all'; playerCardMetric = 'all'; playerCardsExpanded = false; footballCardLimit = 6; nbaCardLimit = 4; nhlCardLimit = 4; footballExtraLimit = 2; }
  const query = $('q').value.toLocaleLowerCase('pl'), status = $('status').value;
  const upcoming = events.filter(event => event.state === 'pre' && Date.parse(event.date) > Date.now()
    && (status === 'all' || status === 'pre')
    && `${event.home} ${event.away} ${event.league}`.toLocaleLowerCase('pl').includes(query));
  $('pick-toolbar').hidden = marketView !== 'players' || sport === 'cs2';
  document.querySelectorAll('[data-market-view]').forEach(button => {
    const active = button.dataset.marketView === marketView;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.body.classList.toggle('daily-mode', marketView === 'daily');
  const dayLabel = $('date').value ? $('date').value.split('-').reverse().join('.') : '';
  $('betting-title').textContent = marketView === 'daily' ? `Typy dnia · ${sports[sport]} · ${dayLabel}` : marketView === 'players' ? 'Zawodnicy — forma i porównania' : 'Drużyny — wynik i sumy';
  if (sport === 'cs2' && !events.length) { $('betting-summary').innerHTML = cs2SourceHTML(); return; }
  if (marketView === 'daily') {
    const candidates = upcoming.flatMap(event => {
      const analysis = previews.get(previewKey(event))?.data;
      const matchPicks = analysis ? buildMatchPicks(analysis, event, marketOptions(event)).candidates : [];
      return [...matchPicks, ...eventPlayerPicks(event)].map(pick => ({ event, pick, oddsData: oddsFor(event) }));
    });
    const analysisRows = upcoming.flatMap(event => eventPlayerPicks(event, { analysis: true }).map(pick => ({ event, pick, oddsData: oddsFor(event) })));
    const analysed = upcoming.filter(event => previews.get(previewKey(event))?.data).length;
    const playerEvents = upcoming.filter(event => ['nba', 'nhl', 'football'].includes(event.sport) && event.route !== 'soccer/pol.1');
    const remaining = playerEvents.filter(event => ![event.homeId, event.awayId].every(id => playerEntryFresh(playerForms.get(playerKey(event, id)))));
    const playerFormsAvailable = playerEvents.filter(event => [event.homeId, event.awayId].some(id => playerForms.get(playerKey(event, id))?.data?.players?.length)).length;
    const loading = upcoming.some(event => previews.get(previewKey(event))?.status === 'loading') || playerEvents.some(event => [event.homeId, event.awayId].some(id => playerForms.get(playerKey(event, id))?.status === 'loading'));
    $('betting-summary').innerHTML = !upcoming.length
      ? '<p class="small">Brak nadchodzących spotkań w wybranym zestawie. Zmień sport lub dzień; rozegrane mecze znajdziesz poniżej.</p>'
      : `${sport === 'football' ? footballAnalysisSection(upcoming) + footballExtraSection(upcoming) : playerEvents.length ? playerAnalysisSection(analysisRows, loading) : ''}${sport === 'nba' ? nbaAnalysisSection(upcoming) : sport === 'nhl' ? nhlAnalysisSection(upcoming) : ''}<section class="daily-priced-section"><h3>Typy dnia z dopasowanym kursem</h3><p class="daily-summary-context">Kurs od ${priceLabel(pickScreening.minOdds)} · godziny w Polsce</p>${loading && !candidates.length ? '<p class="small" role="status">Sprawdzanie meczów i dostępnych kursów…</p>' : dailyPicksHTML(candidates, { sport, ...pickScreening, limit: 5, explanationHTML: dailyGameReasons })}</section>${sport === 'football' && playerEvents.length ? playerAnalysisSection(analysisRows, loading) : ''}<div class="daily-coverage"><span class="small">Analizy meczów: ${analysed}/${upcoming.length}${playerEvents.length ? ` · dane zawodników: ${playerFormsAvailable}/${playerEvents.length}` : ''}.</span>${remaining.length ? `<button type="button" data-more-daily-players ${loading ? 'disabled' : ''}>${loading ? 'Sprawdzanie zawodników…' : 'Sprawdź kolejnych zawodników'}</button>` : ''}</div>`;
    document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
    if (sport === 'football') bindFootballAnalysisActions(upcoming, focusedExtra);
    if (sport === 'nba') bindNBAAnalysisActions(upcoming);
    if (sport === 'nhl') bindNHLAnalysisActions(upcoming);
    const more = document.querySelector('[data-more-daily-players]');
    if (more) more.onclick = () => queuePlayerForms(remaining, 2);
    document.querySelectorAll('[data-player-card-athlete], [data-player-card-metric]').forEach(select => select.onchange = () => {
      playerCardAthlete = document.querySelector('[data-player-card-athlete]').value;
      playerCardMetric = document.querySelector('[data-player-card-metric]').value;
      const target = select.hasAttribute('data-player-card-athlete') ? '[data-player-card-athlete]' : '[data-player-card-metric]';
      renderBetting(); document.querySelector(target)?.focus({ preventScroll: true });
    });
    const expand = document.querySelector('[data-expand-player-cards]');
    if (expand) expand.onclick = () => { playerCardsExpanded = !playerCardsExpanded; renderBetting(); };
    return;
  }
  if (marketView === 'matches') {
    if (sport === 'nhl' && upcoming.length) {
      $('betting-summary').innerHTML = nhlAnalysisSection(upcoming);
      bindNHLAnalysisActions(upcoming);
      return;
    }
    if (sport === 'nba' && upcoming.length) {
      $('betting-summary').innerHTML = nbaAnalysisSection(upcoming);
      bindNBAAnalysisActions(upcoming);
      return;
    }
    if (sport === 'football' && upcoming.length) {
      $('betting-summary').innerHTML = footballAnalysisSection(upcoming) + footballExtraSection(upcoming);
      bindFootballAnalysisActions(upcoming, focusedExtra);
      return;
    }
    const rows = upcoming.flatMap(event => {
      const data = previews.get(previewKey(event))?.data;
      const options = marketOptions(event);
      return data ? [{ event, data, options, picks: buildMatchPicks(data, event, options) }] : [];
    });
    const highlighted = rows.filter(row => row.picks.best).sort((a, b) => Date.parse(a.event.date) - Date.parse(b.event.date));
    const shown = highlighted.slice(0, 6);
    $('betting-summary').innerHTML = !upcoming.length ? '<p class="small">W wybranej dacie nie ma nadchodzących spotkań. Poniżej znajdziesz analizy archiwalne.</p>'
      : `${shown.length ? pricedGroups(shown, row => row.picks.best, ({ event, data, options, picks }) => `<article class="match-signal-card"><div class="match-signal-header"><span class="small">${esc(event.league)} • ${esc(localDate(event.date))}</span><h3>${esc(event.home)} — ${esc(event.away)}</h3></div>${matchPicksHTML(data, event, { ...options, compact: true })}${matchChartsHTML(data, event, { line: picks.totals?.line ?? null, compact: true })}<button data-bet-id="${esc(event.id)}">${['nhl', 'football'].includes(event.sport) ? 'Porównaj wynik i gole' : event.sport === 'nba' ? 'Porównaj wynik i punkty' : 'Porównaj wynik meczu'}</button></article>`, 'match-pick-summary-grid') : `<p class="small">${rows.length ? noPricedPicks() : 'Wczytywanie wcześniejszych spotkań…'}</p>`}
      <p class="small dashboard-summary-note">${highlighted.length ? `Pozycje z pasującym odczytem kursu: ${highlighted.length} z ${upcoming.length} meczów. To filtr ceny, bez potwierdzonej oceny ryzyka.` : rows.length ? 'Pełną historię i porównanie własnej linii znajdziesz w analizie meczu.' : 'Wczytywanie wcześniejszych spotkań…'}</p>`;
    document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
    return;
  }
  if (upcoming.length && upcoming.every(event => event.route === 'soccer/pol.1')) {
    $('betting-summary').innerHTML = '<p class="small">Źródło Ekstraklasy udostępnia wyniki i terminarz. Przejdź do „Wynik i suma goli”, aby porównać formę drużyn i sumę goli. Statystyki zawodników i kursy tej ligi nie są jeszcze dostępne.</p>';
    return;
  }
  const rows = upcoming.flatMap(event => eventPlayerPicks(event).slice(0, 4).map(pick => ({ event, pick })));
  const metric = $('pick-market')?.value || 'all';
  const selected = rows.filter(row => metric === 'all' || row.pick.metric === metric)
    .sort((a, b) => Number(b.pick.priceAvailable) - Number(a.pick.priceAvailable) || b.pick.hits / b.pick.sample - a.pick.hits / a.pick.sample).slice(0, 8);
  const ready = upcoming.filter(event => [event.homeId, event.awayId].every(id => playerForms.get(playerKey(event, id))?.data));
  const loading = upcoming.some(event => [event.homeId, event.awayId].some(id => playerForms.get(playerKey(event, id))?.status === 'loading'));
  const remaining = upcoming.filter(event => !ready.includes(event));
  const overviewEvent = upcoming.find(event => [event.homeId, event.awayId].some(id => playerForms.get(playerKey(event, id))?.data?.players?.length));
  const overview = overviewEvent ? `<section class="player-summary-overview"><h3>Forma zawodników · ${esc(overviewEvent.home)} — ${esc(overviewEvent.away)}</h3><div class="analysis-sides">${playerOverviewHTML(overviewEvent, overviewEvent.homeId)}${playerOverviewHTML(overviewEvent, overviewEvent.awayId)}</div></section>` : '';
  const watch = upcoming.flatMap(event => { const data = previews.get(previewKey(event))?.data; const pick = data && buildMatchPicks(data, event, marketOptions(event)).candidates.find(candidate => candidate.kind === 'result'); return pick ? [{ event, assessment: { candidate: pick } }] : []; });
  $('betting-summary').innerHTML = !upcoming.length
    ? '<p class="small">W wybranym zestawie nie ma nadchodzących spotkań. Analizy rozegranych meczów znajdziesz poniżej.</p>'
    : `${overview}${selected.length ? pricedGroups(selected, row => row.pick, ({ event, pick }) => `<article class="player-pick" data-pick-metric="${esc(pick.metric)}"><span class="small">${esc(event.home)} — ${esc(event.away)}</span><div class="pick-title-row"><span class="player-identity">${playerPhotoHTML({ id: pick.playerId, name: pick.playerName, headshot: pick.headshot }, event.sport)}<h3>${esc(pick.statement)}</h3></span>${pickOddsHTML(oddsFor(event), event, pick)}</div><p class="player-pick-market">${pick.hits} z ${pick.sample} wcześniejszych występów powyżej tej linii</p><p class="small">Średnia: ${Number(pick.average).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} • mediana: ${Number(pick.median).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}</p>${journalPickButtonHTML(event, pick)}<button data-bet-id="${esc(event.id)}">Zobacz formę zawodnika</button></article>`, 'player-picks-grid picks-summary-grid')
      : `<p class="small">${loading ? 'Analizowanie ostatnich 10 meczów zawodników…' : ready.length ? noPricedPicks() : 'Typy zawodników pojawią się po wczytaniu dłuższej formy.'}</p>`}
      <div class="picks-load"><span class="small">Forma zawodników wczytana dla ${ready.length} z ${upcoming.length} meczów.</span>${remaining.length ? `<button data-more-player-picks ${loading ? 'disabled' : ''}>${loading ? 'Wczytywanie…' : 'Wczytaj typy kolejnych meczów'}</button>` : ''}</div>
      ${watch.length ? `<details class="team-picks-list"><summary>Pozycje drużyn z odczytanym kursem (${watch.length})</summary><ul class="betting-watchlist">${watch.map(({ event, assessment }) => `<li><div><b>${esc(assessment.candidate.label)}</b><span class="small">${esc(event.home)} — ${esc(event.away)}</span></div><button data-bet-id="${esc(event.id)}">Uzasadnienie</button></li>`).join('')}</ul></details>` : ''}`;
  document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
  const more = document.querySelector('[data-more-player-picks]');
  if (more) more.onclick = () => queuePlayerForms(remaining, 2);
}

function queuePreviews(selected) {
  const controller = previewController;
  if (!controller || controller.signal.aborted) return;
  const version = ++renderVersion, pending = selected.slice(0, 24);
  for (const event of selected.slice(0, 12)) {
    if (['nba', 'nhl', 'football'].includes(event.sport) && event.state === 'pre' && Date.parse(event.date) > Date.now()) {
      void requestFixtureDetails(event, loadController?.signal).catch(() => {});
    }
  }
  let next = 0;
  async function worker() {
    while (next < pending.length && !controller.signal.aborted && version === renderVersion) {
      const event = pending[next++];
      try { await previewRequest(event, controller.signal); } catch { /* Each card has its own recovery message. */ }
    }
  }
  void Promise.all([worker(), worker(), worker()]);
}
function nav() {
  document.querySelector('[data-market-view=matches]').textContent = ['nhl', 'football'].includes(sport) ? 'Wynik i suma goli' : sport === 'nba' ? 'Wynik i suma punktów' : 'Wynik meczu';
  document.querySelector('.betting-overview > p.small').textContent = sport === 'football'
    ? 'Analiza wyniku, goli i obu drużyn strzelających: forma, argumenty za i przeciw, kurs właściwego rynku. Wybierz mecz po pełne porównanie.'
    : 'Linie zawodników z ostatnimi występami oraz lista typów z dopasowanym kursem. Skuteczność prognoz nie jest potwierdzona.';
  $('sports').innerHTML = Object.entries(sports).map(([key, title]) => `<button data-s="${key}" class="${key === sport ? 'active' : ''}" aria-pressed="${key === sport}">${title}</button>`).join('');
  $('leagues').innerHTML = leagues[sport].map(([key, title]) => `<button data-l="${key}" class="${key === league ? 'active' : ''}" aria-pressed="${key === league}">${title}</button>`).join('');
  $('leagues').hidden = leagues[sport].length === 1;
  document.querySelectorAll('[data-s]').forEach(button => button.onclick = () => { sport = button.dataset.s; league = 'all'; closeDetail(); nav(); renderModel(); renderReadiness(); load(); });
  document.querySelectorAll('[data-l]').forEach(button => button.onclick = () => { league = button.dataset.l; closeDetail(); nav(); renderModel(); renderReadiness(); load(); });
}
function card(event, eager) {
  return `<article class="card"><div class="row small"><span>${esc(event.league)}</span><span>${esc(event.state === 'post' ? `${localDate(event.date)} • zakończony` : event.state === 'in' ? 'Na żywo' : localDate(event.date))}</span></div>
    <div class="teams"><span>${esc(event.home)}</span><small>${event.state === 'pre' ? 'VS' : `${esc(event.homeScore ?? '—')} : ${esc(event.awayScore ?? '—')}`}</small><span>${esc(event.away)}</span></div>
    <div class="match-preview" data-preview="${esc(event.id)}">${eager || previews.has(previewKey(event)) ? previewContent(event) : '<p class="small">Porównanie wcześniejszych wyników i formy dostępne w analizie meczu.</p>'}</div>
    <div class="player-card-preview" data-player-preview="${esc(event.id)}">${playerPreviewContent(event)}</div><button data-id="${esc(event.id)}">Szczegóły meczu</button></article>`;
}
function render() {
  const query = $('q').value.toLocaleLowerCase('pl'), status = $('status').value;
  const matchSearch = event => `${event.home} ${event.away} ${event.league}`.toLocaleLowerCase('pl').includes(query);
  const selected = events.filter(event => matchSearch(event) && (status === 'all' || event.state === status));
  const archive = archiveEvents.filter(matchSearch);
  $('title').textContent = `${sports[sport]} • mecze i analizy (${selected.length})`;
  $('cards').innerHTML = selected.length ? selected.map((event, index) => card(event, index < 12)).join('') : sport === 'cs2' ? '<p class="small">CS2: brak podłączonych danych. Szczegóły i terminarz zewnętrzny znajdziesz powyżej.</p>' : '<div class="panel">Brak spotkań pasujących do wybranej daty i filtrów. Dostępne wcześniejsze analizy znajdziesz w archiwum poniżej.</div>';
  if (!selected.length && !events.length && nextFixture) {
    $('cards').innerHTML = `<section class="panel"><h3>Najbliższy mecz Ekstraklasy</h3><p>${esc(nextFixture.home)} — ${esc(nextFixture.away)}</p><p class="small">${esc(localDate(nextFixture.date))} • inna data niż wybrana w filtrze.</p><button data-next-ekstraklasa>Pokaż mecze tego dnia i ich analizy</button></section>`;
    document.querySelector('[data-next-ekstraklasa]').onclick = () => { $('date').value = nextFixture.date.slice(0, 10); closeDetail(); load(); };
  }
  $('archive').hidden = !archiveEvents.length;
  $('archive-cards').innerHTML = archive.length ? archive.map((event, index) => card(event, index < 12)).join('') : '<p class="small">Brak analiz pasujących do wyszukiwania w tym zestawie.</p>';
  document.querySelectorAll('[data-id]').forEach(button => button.onclick = () => detail(button.dataset.id, button));
  renderBetting();
  queuePreviews([...selected.slice(0, 12), ...archive.slice(0, 12)]);
}
async function loadArchive(signal, scroll = false) {
  $('archive-status').textContent = 'Pobieranie ostatnich analiz…';
  try {
    const end = Date.parse(`${$('date').value}T23:59:59.999Z`);
    if (!Number.isFinite(end)) throw Error('Wybierz poprawną datę.');
    const params = new URLSearchParams({ sport, league, cutoff: new Date(Math.min(Date.now(), end)).toISOString(), limit: '12' });
    const data = await json(`/api/analysis-catalog?${params}`, signal);
    if (signal?.aborted) return;
    archiveEvents = data.events || [];
    $('archive-status').textContent = archiveEvents.length ? `Dostępne analizy: ${archiveEvents.length}. Daty spotkań widoczne na kartach.` : data.reason || 'Brak dostępnego archiwum.';
    render();
    if (scroll && archiveEvents.length) $('archive').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { if (!signal?.aborted) $('archive-status').textContent = `Archiwum jest chwilowo niedostępne: ${error.message}`; }
}
async function load() {
  loadController?.abort(); previewController?.abort();
  const controller = new AbortController(); loadController = controller; previewController = new AbortController();
  viewAsOf = Math.floor(Date.now() / 60000) * 60000;
  previews.clear(); matchLines.clear(); playerForms.clear(); fixtureDetails.clear(); playerQueue = []; events = []; archiveEvents = []; nextFixture = null; ++renderVersion;
  $('archive-status').textContent = ''; $('info').textContent = 'Pobieranie meczów…'; render();
  if (!$('date').value) { $('info').textContent = 'Wybierz datę spotkań.'; return; }
  try {
    const params = new URLSearchParams({ sport, league, date: $('date').value.replaceAll('-', '') });
    const data = await json(`/api/scores?${params}`, controller.signal);
    if (!Array.isArray(data.events)) throw Error('Nieprawidłowa odpowiedź źródła');
    if (controller.signal.aborted || controller !== loadController) return;
    events = data.events.map(event => ({ ...event, sport }));
    nextFixture = sport === 'football' && league === 'pol.1' && data.nextEvent?.route === 'soccer/pol.1' ? data.nextEvent : null;
    $('info').textContent = data.errors?.length ? data.errors.map(message => {
      if (String(message).startsWith('soccer/pol.1:')) return String(message).replace('soccer/pol.1:', 'Ekstraklasa:');
      const label = leagues[sport].find(([id]) => id !== 'all' && String(message).startsWith(`${sport === 'football' ? 'soccer' : sport === 'nba' ? 'basketball' : sport === 'nhl' ? 'hockey' : 'tennis'}/${id}:`))?.[1];
      return label ? `${label}: źródło chwilowo niedostępne.` : String(message);
    }).join(' ') : `Terminarz zaktualizowany • ${localDate(data.fetchedAt)}${league === 'pol.1' ? ' • TheSportsDB: do 3 spotkań na dzień; pokrycie może być niepełne.' : ''}`;
  } catch (error) {
    if (controller.signal.aborted) return;
    $('info').textContent = `Terminarz jest chwilowo niedostępny: ${error.message}. Dostępne analizy archiwalne poniżej.`;
  }
  render();
  queuePlayerForms(events, Math.min(events.length, 12));
  if (!events.length && sport !== 'cs2') await loadArchive(controller.signal);
}
function existingStatsHTML(data, event) {
  let html = '';
  if (data.teamStats?.length) html += '<h3>Statystyki drużyn w tym meczu</h3>' + data.teamStats.map(team => `<div class="panel"><b>${esc(team.team)}</b><p class="small">${team.statistics.slice(0, 18).map(stat => `${esc(stat.name)}: ${esc(stat.value)}`).join(' • ')}</p></div>`).join('');
  if (data.playerAnalysis?.length) html += '<h3>Liderzy tego meczu</h3>' + data.playerAnalysis.map(metric => `<p><b>${esc(metric.title)}</b>: ${metric.leaders.map(player => `${esc(player.name)} — ${player.value}`).join(' • ')}</p>`).join('');
  if (data.players?.length) html += `<h3>Zawodnicy — statystyki tego meczu</h3><div class="scroll"><table><thead><tr><th>Zawodnik</th><th>Drużyna</th><th>Statystyki</th></tr></thead><tbody>${data.players.map(player => `<tr><td><span class="player-identity">${playerPhotoHTML(player, event.sport)}<span>${esc(player.name)}</span></span></td><td>${esc(player.team)}</td><td>${player.didNotPlay ? 'Nie grał(a)' : esc(player.stats.map((value, index) => `${player.labels[index] || ''}: ${value}`).join(' | '))}</td></tr>`).join('')}</tbody></table></div>`;
  if (!html) html = `<p class="small">${event.state === 'pre' ? 'Statystyki tego meczu pojawią się po rozpoczęciu. Powyżej jest analiza wcześniejszej formy.' : 'Źródło nie udostępniło dodatkowego boxscore tego meczu.'}</p>`;
  return html + `<p class="small">${esc(data.note)} • ${esc(data.source)} • ${esc(localDate(data.fetchedAt))}</p>`;
}
async function detail(id, button) {
  const event = [...events, ...archiveEvents].find(item => item.id === id);
  if (!event) return;
  detailEvent = event;
  detailController?.abort(); const controller = new AbortController(); detailController = controller;
  lastDetailButton = button; $('modal').classList.add('on'); $('close').focus();
  $('mtitle').textContent = `${event.home} — ${event.away}`;
  $('detail').innerHTML = `<p class="small">${esc(event.league)} • ${esc(localDate(event.date))}</p>
    ${event.sport !== 'tennis' ? `<section class="player-analysis-section"><h3>Zawodnicy — forma i wykresy</h3><p class="small">Aktualna historia zawodników w tej lidze, również po wybraniu starszego meczu. Wybierz gracza i statystykę; data ostatniego dostępnego występu jest podana przy profilu.</p><div class="analysis-sides"><div id="players-home"><p class="small">Ładowanie: ${esc(event.home)}…</p></div><div id="players-away"><p class="small">Ładowanie: ${esc(event.away)}…</p></div></div></section>` : ''}
    <div id="betting-detail"><p class="small">Porównywanie wyniku i sumy punktów…</p></div>
    ${event.sport !== 'tennis' ? `<section class="match-player-picks"><h3>Typy na zawodników</h3><p class="small">Linie źródłowe lub analityczne porównane z wcześniejszymi występami. Sprawdź ofertę i dostępność zawodnika przed decyzją.</p><div class="analysis-sides"><div id="player-picks-home"><h4>${esc(event.home)}</h4><p class="small">${event.state === 'pre' && Date.parse(event.date) > Date.now() ? 'Analizowanie do 10 wcześniejszych meczów…' : 'Typy zawodników są dostępne przed rozpoczęciem spotkania. Powyżej pozostaje aktualny profil zawodnika.'}</p></div><div id="player-picks-away"><h4>${esc(event.away)}</h4><p class="small">${event.state === 'pre' && Date.parse(event.date) > Date.now() ? 'Analizowanie do 10 wcześniejszych meczów…' : 'Typy zawodników są dostępne przed rozpoczęciem spotkania. Powyżej pozostaje aktualny profil zawodnika.'}</p></div></div></section>` : ''}
    <div id="availability"><p class="small">Sprawdzanie dostępności zawodników…</p></div>
    <details class="panel detail-section"><summary>Pełna forma drużyn i bezpośrednie spotkania</summary><div id="match-detail"><p>Wczytywanie porównania…</p></div></details>
    <details class="panel detail-section"><summary>Kursy i linie ze źródła</summary><div id="source-odds"></div></details>
    <details class="panel detail-section"><summary>Kalkulator kursu i dziennik własnych typów</summary><div id="journal-form"></div></details>
    <details id="game-boxscore" class="panel detail-section" ${event.state !== 'pre' ? 'open' : ''}><summary>${event.state === 'pre' ? 'Dodatkowe informacje o spotkaniu' : 'Statystyki rozegranego meczu'}</summary><div id="match-boxscore"><p class="small">Pobieranie dodatkowych statystyk…</p></div></details>`;
  if (['nhl', 'football'].includes(event.sport)) $('detail').insertBefore($('betting-detail'), $('detail').querySelector('.player-analysis-section'));
  if (event.sport === 'football') {
    const extraNode = document.createElement('div'); extraNode.id = 'football-extra-detail';
    $('detail').insertBefore(extraNode, $('betting-detail').nextSibling);
    updateFootballExtraDetail(event);
    void requestFootballExtras(event, loadController?.signal).catch(() => {});
  }
  journal.open(event, $('journal-form'));
  void previewRequest(event, previewController?.signal).then(data => {
    if (!controller.signal.aborted) {
      updateMatchDetail(event, data);
    }
  }).catch(() => { if (!controller.signal.aborted) { $('betting-detail').innerHTML = '<p class="small">Forma drużyn jest chwilowo niedostępna.</p>'; $('match-detail').innerHTML = '<p>Analiza wcześniejszych wyników jest chwilowo niedostępna. Spróbuj otworzyć ją ponownie.</p>'; } });
  if (event.sport !== 'tennis') {
    updatePlayerViews(event);
    queuePlayerForms([event], 1, true, true);
  }
  void requestFixtureDetails(event, loadController?.signal).then(data => { if (!controller.signal.aborted) {
    updateCurrentDetails(event, data);
  } }).catch(() => { if (!controller.signal.aborted) {
    $('availability').innerHTML = '<p class="small">Nie udało się potwierdzić składów i kontuzji. Brak danych nie oznacza pełnej dostępności zawodników.</p>';
    $('match-boxscore').textContent = 'Dodatkowe statystyki tego spotkania nie są dostępne. Analiza wcześniejszej formy jest niezależna od boxscore.';
  } });
}
function renderModel() {
  if (!report) return;
  const entry = report.sports?.[sport];
  if (!entry) { $('model').textContent = 'Brak raportu dla tej dyscypliny.'; return; }
  const labels = { validated: 'Test historyczny zakończony', research: 'Wyniki badawcze • prognozy wstrzymane', unavailable: 'Model niedostępny' };
  let html = `<p><b>${esc(labels[entry.status] || 'Model niedostępny')}</b></p><p class="small">${esc(entry.reason)}</p>`;
  if (entry.dataQuality) html += `<p class="small">Historia zaktualizowana: ${esc(localDate(entry.dataQuality.historyUpdatedAt))}. Wykluczone błędne rekordy: ${entry.dataQuality.excludedRecords}.</p>`;
  if (report.updateSource) html += `<p class="small">Aktualizacja raportów: ${report.updateSource.origin === 'github' ? 'automatyczna' : 'dane dołączone do wdrożenia'}${report.updateSource.fallback ? ' • aktualizacja niedostępna; pokazano ostatni zapis wdrożenia' : ''}.</p>`;
  let rows = entry.leagues?.length ? entry.leagues : [entry];
  if (league !== 'all') rows = rows.filter(row => row.league === league);
  const tested = rows.filter(row => row.metrics?.count > 0);
  if (tested.length) {
    html += `<div class="scroll"><table><thead><tr><th>Liga</th><th>Trening / kalibracja / wybór / test</th><th>Trafność</th><th>Brier</th><th>Brier bazowy</th><th>Log loss</th></tr></thead><tbody>${tested.map(row => `<tr><td>${esc(row.league || row.sport)}</td><td>${row.samples.train} / ${row.samples.calibration} / ${row.samples.selection} / ${row.samples.test}</td><td>${percent(row.metrics.accuracy)}</td><td>${number(row.metrics.brier)}</td><td>${number(row.baselineMetrics?.brier)}</td><td>${number(row.metrics.logLoss)}</td></tr>`).join('')}</tbody></table></div>`;
    html += tested.map(row => `<p class="small">${esc(row.league || row.sport)}: ${esc(row.modelName)}. Kalibracja ${row.calibration?.selected ? 'zastosowana' : 'odrzucona lub brak próby'}. Brier surowy: ${number(row.rawMetrics?.brier)}. Trafność — 95% przedział ufności: ${percent(row.metrics.accuracyInterval?.lower)}–${percent(row.metrics.accuracyInterval?.upper)}. Zakres danych: ${esc(row.provenance?.firstEventAt?.slice(0, 10))} – ${esc(row.provenance?.lastEventAt?.slice(0, 10))}.</p><p class="small">Ograniczenia ${esc(row.league || row.sport)}: ${esc(row.publication?.reasons?.join(' ') || 'Brak dodatkowych ograniczeń raportu.')}</p>`).join('');
    html += '<p class="small">Brier: średnia kwadratów błędów po klasach wyniku; porównuj z modelem bazowym w tej samej lidze. Wyniki dyscyplin o różnej liczbie klas nie są bezpośrednio porównywalne.</p>';
  } else html += `<p>${sport === 'football' && league === 'pol.1' ? 'Ekstraklasa: osobne dane TheSportsDB służą analizie formy drużyn i sum goli. Nie ma jeszcze niezależnie zweryfikowanego modelu tej ligi.' : 'Brak wystarczającej próby do przedstawienia wyników testu dla wybranej ligi.'}</p>`;
  const forwardSport = report.forward?.sports?.[sport];
  const forward = league === 'all' ? forwardSport : forwardSport?.leagues?.find(row => row.league === league);
  html += '<h3>Walidacja od chwili uruchomienia</h3>';
  html += forward ? `<p class="small">Zarejestrowane przed meczem: ${forward.samples.recorded}. Rozliczone później: ${forward.samples.settled}. Oczekujące: ${forward.samples.pending}. Unieważnione: ${forward.samples.void}.</p>${forward.metrics?.count ? `<p class="small">Trafność rozliczonej próby: ${percent(forward.metrics.accuracy)} • Brier: ${number(forward.metrics.brier)}. Wynik badawczy; niezależny test końcowy jeszcze niepotwierdzony.</p>` : '<p class="small">Brak rozliczonych meczów — nie wyświetlamy skuteczności ani prawdopodobieństw bez próby.</p>'}` : '<p class="small">Brak zarejestrowanej próby dla tej ligi. Prognozy pozostają wstrzymane.</p>';
  const protocol = report.forward?.validation;
  if (protocol) {
    const prefix = { nba: 'basketball/', nhl: 'hockey/', football: 'soccer/', tennis: 'tennis/', cs2: 'cs2/' }[sport];
    const progress = protocol.leagues.filter(row => row.route.startsWith(prefix) && (league === 'all' || row.league === league));
    const phases = { calibration: 'Kalibracja', selection: 'Wybór kalibracji', test: 'Test końcowy', 'completed-awaiting-review': 'Test zamknięty — przegląd', failed: 'Kryteria niespełnione', 'blocked-data': 'Braki danych', invalidated: 'Zmiana dowodów — przegląd' };
    html += `<details id="validation-progress"><summary>Postęp niezależnego testu</summary><p class="small">Protokół zarejestrowany: ${esc(localDate(protocol.registeredAt))}. Każda liga ma własne, ustalone z góry próby: 60 meczów kalibracji, 45 wyboru i 150 testu. Następny etap rozpoczyna się po zamknięciu poprzedniego. Wyniki testu końcowego ujawniamy po jego zakończeniu.</p>`;
    html += progress.length ? `<div class="scroll"><table><thead><tr><th>Liga</th><th>Etap</th><th>Kalibracja</th><th>Wybór</th><th>Test</th></tr></thead><tbody>${progress.map(row => `<tr><td>${esc(leagues[sport].find(([key]) => key === row.league)?.[1] || row.league)}</td><td>${esc(phases[row.phase] || row.phase)}</td>${['calibration', 'selection', 'test'].map(stage => `<td>${row.stages[stage].settled}/${row.stages[stage].target}<br><small>Zapisane: ${row.stages[stage].recorded}, unieważnione: ${row.stages[stage].void}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="small">Dla tej ligi nie ma aktywnego eksperymentu.</p>';
    html += progress.map(row => `${row.reason ? `<p class="small">${esc(row.league)}: ${esc(row.reason)}</p>` : ''}${row.finalTestMetrics ? `<p class="small">Zamknięty test ${esc(row.league)}: ${row.finalTestMetrics.count} meczów • trafność ${percent(row.finalTestMetrics.accuracy)} • Brier ${number(row.finalTestMetrics.brier)} • Brier bazowy ${number(row.baselineMetrics?.brier)}.</p>` : ''}`).join('');
    if (report.forward.audit) html += `<p class="small">Sprawdzone zapisy z dowodami i odtworzeniem modelu: ${report.forward.audit.verified}. Starsze zapisy badawcze: ${report.forward.audit.legacyResearch} — pozostają poza nowym niezależnym testem.</p>`;
    html += '<p class="small">Końcowy test wymaga co najmniej 100 prawidłowych rozliczeń w ustalonej próbie, przewagi nad modelem bazowym i kontroli niepewności. Sam licznik meczów nie odblokowuje prognoz.</p></details>';
  }
  html += `<p class="small">Raport: ${esc(localDate(report.generatedAt))}${report.stale ? ' • raport nieaktualny' : ''}. ${esc(report.method)} ${esc(report.note)}</p>`;
  $('model').innerHTML = html;
}

async function loadModel() {
  try { report = await json('/api/model'); renderModel(); }
  catch { $('model').textContent = 'Raport testów niedostępny'; }
}

function renderReadiness() {
  if (readinessReport) $('readiness').innerHTML = readinessHTML(readinessReport, sport, league);
}
async function loadReadiness() {
  try { readinessReport = await json('/api/readiness'); renderReadiness(); }
  catch { $('readiness').textContent = 'Stan walidacji chwilowo niedostępny. Nie oznacza to dopuszczenia prognoz.'; }
}


function closeDetail() {
  detailController?.abort(); detailEvent = null; $('modal').classList.remove('on');
  if (lastDetailButton?.isConnected) lastDetailButton.focus();
}
let searchTimer;
document.querySelectorAll('[data-market-view]').forEach(button => button.onclick = () => { marketView = button.dataset.marketView; renderBetting(); queuePricedPlayerForms(events); });
$('pick-market').onchange = renderBetting;
$('q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); }; $('status').onchange = render; $('date').onchange = () => { closeDetail(); load(); };
$('refresh').onclick = () => { closeDetail(); load(); loadModel(); loadReadiness(); };
$('show-archive').onclick = () => loadArchive(loadController?.signal, true);
$('close').onclick = closeDetail;
$('modal').onclick = event => { if (event.target === $('modal')) closeDetail(); };
document.addEventListener('click', async click => {
  const save = click.target.closest('[data-journal-pick]');
  if (save) {
    const selected = [...events, ...archiveEvents].find(event => event.id === save.dataset.journalEvent);
    if (!selected || selected.state !== 'pre' || Date.parse(selected.date) <= Date.now()) return;
    let pick; try { pick = JSON.parse(save.dataset.journalPick); } catch { return; }
    if (detailEvent?.id !== selected.id || !$('modal').classList.contains('on')) await detail(selected.id, save);
    if (detailEvent?.id !== selected.id) return;
    journal.openPick(selected, $('journal-form'), pick, { quote: matchPickQuote(oddsFor(selected), selected, pick) });
    $('journal-form').closest('details').open = true;
    $('journal-form').scrollIntoView({ block: 'start' });
    return;
  }
  const button = click.target.closest('[data-use-source-line]');
  if (!button) return;
  const selected = button.dataset.oddsEvent ? [...events, ...archiveEvents].find(event => event.id === button.dataset.oddsEvent) : detailEvent;
  if (!selected) return;
  if (!$('modal').classList.contains('on') || detailEvent?.id !== selected.id) {
    try { await detail(selected.id, button); await previewRequest(selected, previewController?.signal); }
    catch { return; }
  }
  if (detailEvent?.id !== selected.id) return;
  const line = Number(button.dataset.line);
  const quote = matchPickQuote(oddsFor(detailEvent), detailEvent, { kind: 'total', market: ['nhl', 'football'].includes(detailEvent.sport) ? 'total_goals' : 'total_points', scope: detailEvent.sport === 'football' ? 'regulation_90' : detailEvent.sport === 'nhl' ? 'including_overtime_shootout' : 'including_overtime', direction: 'over', line });
  const form = $('betting-detail').querySelector('[data-match-line]');
  if (quote.status !== 'matched' || !form) {
    let message = button.parentElement.querySelector('[data-source-line-status]');
    if (!message) { message = document.createElement('p'); message.className = 'small'; message.dataset.sourceLineStatus = ''; message.setAttribute('role', 'status'); button.after(message); }
    message.textContent = quote.status !== 'matched' ? 'Odczyt kursu wygasł lub nie potwierdza tej linii. Odśwież analizę.' : 'Do porównania potrzebna jest pełniejsza historia obu drużyn.';
    return;
  }
  form.elements.namedItem('totalLine').value = String(line).replace('.', ',');
  form.requestSubmit();
  $('betting-detail').scrollIntoView({ block: 'start' });
});
$('pick-min-odds').value = priceLabel(pickScreening.minOdds);
$('pick-price-band').value = pickScreening.band;
$('pick-screening-status').textContent = `Minimum ${priceLabel(pickScreening.minOdds)}. Podział według ceny; ryzyko i opłacalność nie są potwierdzone.`;
$('pick-screening-form').addEventListener('submit', submit => {
  submit.preventDefault();
  const raw = $('pick-min-odds').value.trim(), minOdds = /^\d+(?:[,.]\d{1,2})?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
  if (!Number.isFinite(minOdds) || minOdds < 1.01 || minOdds > 1000) {
    $('pick-screening-status').textContent = 'Podaj minimalny kurs od 1,01 do 1000. Dotychczasowy filtr pozostaje aktywny.';
    return;
  }
  pickScreening = { minOdds, band: $('pick-price-band').value };
  try { localStorage.setItem('sportlab.pick-screening.v1', JSON.stringify(pickScreening)); } catch { /* The filter still works in this tab. */ }
  $('pick-min-odds').value = priceLabel(minOdds);
  $('pick-screening-status').textContent = `Minimum ${priceLabel(minOdds)}. Podział według ceny; ryzyko i opłacalność nie są potwierdzone.`;
  const all = [...events, ...archiveEvents];
  document.querySelectorAll('[data-preview]').forEach(node => { const event = all.find(row => row.id === node.dataset.preview); if (event) node.innerHTML = previewContent(event); });
  document.querySelectorAll('[data-player-preview]').forEach(node => { const event = all.find(row => row.id === node.dataset.playerPreview); if (event) node.innerHTML = playerPreviewContent(event); });
  if (detailEvent) {
    const data = previews.get(previewKey(detailEvent))?.data;
    if (data) updateMatchDetail(detailEvent, data);
    updatePlayerViews(detailEvent);
  }
  renderBetting();
  queuePricedPlayerForms(events);
});
document.addEventListener('change', change => {
  const select = change.target.closest('[data-player-inspector], [data-player-metric]');
  if (!select) return;
  const host = select.closest('[data-player-explorer]');
  const event = [...events, ...archiveEvents].find(row => row.id === host.dataset.eventId);
  if (!event) return;
  const teamId = host.dataset.teamId;
  playerInspectors.set(`${event.id}:${teamId}`, { playerId: host.querySelector('[data-player-inspector]').value, metric: host.querySelector('[data-player-metric]').value });
  const parent = host.parentElement, playerChanged = select.hasAttribute('data-player-inspector');
  host.outerHTML = playerOverviewHTML(event, teamId);
  const updated = [...parent.querySelectorAll('[data-player-explorer]')].find(node => node.dataset.teamId === teamId && node.dataset.eventId === event.id);
  updated?.querySelector(playerChanged ? '[data-player-inspector]' : '[data-player-metric]')?.focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  if (!$('modal').classList.contains('on')) return;
  if (event.key === 'Escape') closeDetail();
  if (event.key === 'Tab') {
    const focusable = [...$('modal').querySelectorAll('button, summary, a[href], input, select, [tabindex="0"]')].filter(node => !node.disabled && node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
function footballExtraInput(event) {
  const form = event.target.closest?.('[data-football-extra-line]');
  if (form && event.target.name === 'line') {
    const key = `${form.dataset.fixtureId}:${form.dataset.metric}`;
    footballExtraDrafts.set(key, String(event.target.value).slice(0, 50));
    footballExtraLineMessages.delete(key);
    form.querySelector('[data-extra-line-result]').textContent = '';
  }
}
function footballExtraSubmit(submit) {
  const form = submit.target.closest?.('[data-football-extra-line]');
  if (!form) return;
  submit.preventDefault();
  const event = [...events, ...archiveEvents].find(row => row.id === form.dataset.fixtureId), metric = form.dataset.metric;
  if (!event || event.sport !== 'football' || !['corners', 'yellowCards', 'shots', 'shotsOnTarget'].includes(metric)) return;
  const raw = String(form.elements.namedItem('line').value).trim(), line = /^\d+(?:[,.]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
  const maximum = Number(form.dataset.maximum), output = form.querySelector('[data-extra-line-result]');
  if (!Number.isFinite(line) || line < 0.5 || line > maximum || line % 1 !== 0.5) { output.textContent = `Wpisz linię połówkową od 0,5 do ${String(maximum).replace('.', ',')}.`; footballExtraLineMessages.set(`${event.id}:${metric}`, output.textContent); return; }
  if (!footballExtras.get(event.id)?.data) { output.textContent = 'Poczekaj na odczyt wcześniejszych statystyk.'; footballExtraLineMessages.set(`${event.id}:${metric}`, output.textContent); return; }
  footballExtraLines.set(event.id, { ...footballExtraLines.get(event.id), [metric]: line });
  footballExtraDrafts.set(`${event.id}:${metric}`, raw);
  footballExtraLineMessages.set(`${event.id}:${metric}`, `Porównano Twoją linię ${String(line).replace('.', ',')} z wcześniejszymi sumami obu drużyn. To porównanie historyczne.`);
  const owner = $('detail').contains(form) ? $('football-extra-detail') : $('betting-summary');
  updateFootballExtraDetail(event); renderBetting();
  for (const updated of owner.querySelectorAll('[data-football-extra-line]')) if (updated.dataset.fixtureId === event.id && updated.dataset.metric === metric) {
    updated.querySelector('[data-extra-line-result]').textContent = `Porównano Twoją linię ${String(line).replace('.', ',')} z wcześniejszymi sumami obu drużyn. To porównanie historyczne.`;
    updated.elements.namedItem('line').focus({ preventScroll: true });
  }
}
for (const root of [$('betting-summary'), $('detail')]) {
  root.addEventListener('input', footballExtraInput);
  root.addEventListener('submit', footballExtraSubmit);
}
$('detail').addEventListener('submit', submit => {
  const matchForm = submit.target.closest('form[data-match-line]');
  if (matchForm && detailEvent) {
    submit.preventDefault();
    const raw = String(matchForm.elements.namedItem('totalLine').value).trim();
    const line = /^\d+(?:[,.]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
    const goals = ['nhl', 'football'].includes(detailEvent.sport);
    const maximum = detailEvent.sport === 'nhl' ? 25.5 : goals ? 15.5 : 599.5;
    const output = matchForm.querySelector('[data-match-line-result]');
    if (!Number.isFinite(line) || line < (goals ? 0.5 : 1.5) || line > maximum || !Number.isInteger(line * 2) || Number.isInteger(line)) {
      output.textContent = goals ? `Wpisz linię połówkową od 0,5 do ${String(maximum).replace('.', ',')} gola.` : 'Wpisz linię połówkową, np. 224,5.'; return;
    }
    const data = previews.get(previewKey(detailEvent))?.data;
    if (!data) { output.textContent = 'Wczytaj analizę meczu przed porównaniem linii.'; return; }
    const picks = buildMatchPicks(data, detailEvent, { totalLine: line });
    if (!picks.totals) { output.textContent = picks.reason || 'Odśwież analizę przed porównaniem własnej linii.'; return; }
    matchLines.set(detailEvent.id, line);
    updatePreviewNodes(detailEvent);
    const updated = $('betting-detail').querySelector('[data-match-line-result]');
    if (updated) updated.textContent = picks.totals ? `Porównano Twoją linię ${String(line).replace('.', ',')} z wcześniejszymi sumami ${goals ? 'goli' : 'punktów'}.` : picks.reason;
    $('betting-detail').querySelector('[name=totalLine]')?.focus({ preventScroll: true });
    return;
  }
  const form = submit.target.closest('form[data-player-line]');
  if (!form || !detailEvent) return;
  submit.preventDefault();
  const output = form.querySelector('[data-line-result]');
  const raw = String(form.elements.namedItem('line').value).trim();
  const line = /^\d+(?:[,.]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
  const data = playerForms.get(playerKey(detailEvent, form.dataset.teamId))?.data;
  if (!data || !Number.isFinite(line) || line <= 0 || line > 100 || !Number.isInteger(line * 2) || Number.isInteger(line)) {
    output.textContent = 'Wpisz dodatnią linię połówkową, np. 19,5. Maksymalna linia: 99,5.'; return;
  }
  const result = evaluatePlayerLine(data, detailEvent, form.dataset.playerId, form.dataset.metric, line,
    { direction: form.elements.namedItem('direction').value, excludedPlayerIds: excludedPlayers(detailEvent) });
  const comparison = result.comparison;
  if (!comparison) { output.textContent = result.reason || 'Brak porównywalnej historii dla tej linii.'; return; }
  const selected = { ...comparison, kind: 'player', market: 'player_prop', teamId: data.teamId, scope: detailEvent.sport === 'nba' ? 'including_overtime' : detailEvent.sport === 'football' ? 'regulation_90' : 'including_overtime_excluding_shootout' };
  output.innerHTML = `${esc(comparison.statement)}: ${comparison.hits} z ${comparison.sample} wcześniejszych występów. To porównanie historyczne dla Twojej linii. ${pickOddsHTML(oddsFor(detailEvent), detailEvent, selected)}${journalPickButtonHTML(detailEvent, selected)}${['nba', 'nhl'].includes(detailEvent.sport) ? playerPickReasonsHTML(selected, detailEvent, { compact: false }) : ''}`;
});
const journal = createJournalUI({ root: $('journal-root'), fetchJSON: json });
nav(); loadModel(); loadReadiness(); load();
void journal.refresh();
setInterval(() => {
  if (detailEvent && $('modal').classList.contains('on')) {
    if (Date.now() - viewAsOf >= 5 * 60000) {
      const old = previews.get(previewKey(detailEvent))?.data;
      if (old) updateMatchDetail(detailEvent, old);
      for (const [side, teamId] of [['home', detailEvent.homeId], ['away', detailEvent.awayId]]) {
        const previous = playerForms.get(playerKey(detailEvent, teamId));
        if (previous?.data && !playerEntryFresh(previous) && $(`player-picks-${side}`)) renderPlayerPickNode($(`player-picks-${side}`), previous.data, detailEvent);
      }
      viewAsOf = Math.floor(Date.now() / 60000) * 60000;
    }
    const entry = previews.get(previewKey(detailEvent));
    if (!entry?.promise && (!entry?.data) && Date.now() - (entry?.attemptedAt || 0) >= 60000) void previewRequest(detailEvent, loadController?.signal).catch(() => {});
    queuePlayerForms([detailEvent], 1, true, true);
  }
  renderBetting();
  document.querySelectorAll('[data-preview]').forEach(node => {
    const event = [...events, ...archiveEvents].find(item => item.id === node.dataset.preview);
    if (event) node.innerHTML = previewContent(event);
    if (event) updateOddsNodes(event);
  });
  const data = detailEvent && previews.get(previewKey(detailEvent))?.data;
  if (data && $('betting-detail')) {
    updateMatchDetail(detailEvent, data);
    const options = marketOptions(detailEvent);
    const current = buildMatchPicks(data, detailEvent, options);
    if (['unavailable', 'closed'].includes(current.status) && $('betting-detail').dataset.marketStatus !== current.status) {
      $('betting-detail').innerHTML = matchPicksHTML(data, detailEvent, options) + matchChartsHTML(data, detailEvent, { line: current.totals?.line ?? null });
      $('betting-detail').dataset.marketStatus = current.status;
    }
  }
  if (detailEvent) updatePlayerViews(detailEvent);
  if (detailEvent && Date.now() - Date.parse(fixtureDetails.get(detailEvent.id)?.data?.fetchedAt || 0) >= 5 * 60000) {
    void requestFixtureDetails(detailEvent, loadController?.signal).catch(() => {});
  }
}, 30000);
setInterval(() => { if (!document.hidden && !$('modal').classList.contains('on')) load(); }, 300000);
setInterval(() => { if (!document.hidden) { void journal.refresh(); loadReadiness(); } }, 300000);
