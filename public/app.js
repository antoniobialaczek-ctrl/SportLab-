import { previewHTML, matchDetailHTML, playerFormHTML } from '/analysis-view.js';
import { assessBetting } from '/betting-view.js';
import { createJournalUI } from '/journal-ui.js';
import { contextHTML, availabilityHTML } from '/context-view.js';
import { readinessHTML } from '/readiness-view.js';
import { oddsHTML } from '/odds-view.js';
import { buildPlayerPicks, playerPicksHTML, evaluatePlayerLine } from '/player-picks.js';
import { buildMatchPicks, matchPicksHTML } from '/match-picks.js';
import { matchChartsHTML } from '/match-charts.js';
const sports = { football: '⚽ Piłka', nba: '🏀 NBA', nhl: '🏒 NHL', tennis: '🎾 Tenis', cs2: '🎮 CS2' };
const leagues = {
  football: [['all', 'Wszystkie ligi'], ['eng.1', 'Premier League'], ['esp.1', 'La Liga'], ['ger.1', 'Bundesliga'], ['ita.1', 'Serie A'], ['fra.1', 'Ligue 1'], ['pol.1', 'Ekstraklasa'], ['uefa.champions', 'Liga Mistrzów'], ['uefa.europa', 'Liga Europy'], ['eng.2', 'Championship'], ['ned.1', 'Eredivisie'], ['por.1', 'Portugalia']],
  nba: [['all', 'NBA']], nhl: [['all', 'NHL']], tennis: [['all', 'ATP i WTA'], ['atp', 'ATP'], ['wta', 'WTA']], cs2: [['all', 'CS2']],
};
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => Number.isFinite(value) ? value.toFixed(3) : '—';
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const localDate = value => value ? new Date(value).toLocaleString('pl-PL') : '—';
let sport = 'nba', league = 'all', events = [], archiveEvents = [], report = null, readinessReport = null, detailEvent = null;
let loadController, detailController, previewController, lastDetailButton, renderVersion = 0;
let viewAsOf = Math.floor(Date.now() / 60000) * 60000;
let marketView = 'matches';
const previews = new Map();
const matchLines = new Map();
const playerForms = new Map(), fixtureDetails = new Map();
let playerQueue = [], playerWorkers = 0;
const today = new Date();
$('date').value = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

async function json(url, signal) {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}
function cutoffFor(event) {
  const time = new Date(Math.min(viewAsOf, Date.parse(event.date)));
  time.setUTCSeconds(0, 0);
  return time.toISOString();
}
function previewKey(event) { return `${event.id}:${cutoffFor(event)}`; }
function playerCutoffFor(event) { return new Date(Math.floor(Date.parse(cutoffFor(event)) / 900000) * 900000).toISOString(); }
function playerKey(event, teamId) { return `${event.route}:${teamId}:${playerCutoffFor(event)}`; }
function excludedPlayers(event) {
  const availability = fixtureDetails.get(event.id)?.data?.availability;
  const fetched = Date.parse(availability?.fetchedAt);
  if (!availability?.identityVerified || availability.eventId !== event.sourceEventId
    || Date.parse(availability.startTime) !== Date.parse(event.date)
    || !Number.isFinite(fetched) || fetched > Date.now() + 60000 || Date.now() - fetched > 15 * 60000
    || !availability.teams?.every(team => [event.homeId, event.awayId].includes(team.id))) return [];
  return availability.teams.flatMap(team => (team.injuries?.items || []).filter(player => /^(out|doubtful|inactive|suspended|ruled out)$/i.test(player.status)).map(player => player.id));
}
function eventPlayerPicks(event) {
  const options = { excludedPlayerIds: excludedPlayers(event) };
  const home = playerForms.get(playerKey(event, event.homeId))?.data;
  const away = playerForms.get(playerKey(event, event.awayId))?.data;
  const lists = [home, away].map(data => data ? buildPlayerPicks(data, event, options).picks : []);
  const all = lists[0].flatMap((pick, index) => [pick, lists[1][index]].filter(Boolean)).concat(lists[1].slice(lists[0].length));
  const first = [], metrics = new Set();
  for (const pick of all) if (!metrics.has(pick.metric)) { metrics.add(pick.metric); first.push(pick); }
  return first.concat(all.filter(pick => !first.includes(pick)));
}
function playerPreviewContent(event) {
  if (!['nba', 'nhl', 'football'].includes(event.sport) || event.state !== 'pre' || Date.parse(event.date) <= Date.now()) return '';
  const picks = eventPlayerPicks(event).slice(0, 3);
  const entries = [event.homeId, event.awayId].map(id => playerForms.get(playerKey(event, id)));
  return `<div class="preview-heading">Typy na zawodników</div>${picks.length
    ? picks.map(pick => `<p class="player-preview-pick"><b>${esc(pick.statement)}</b><span class="small">${pick.hits} z ${pick.sample} wcześniejszych występów powyżej linii</span></p>`).join('')
    : `<p class="small">${entries.some(entry => entry?.status === 'loading') ? 'Analizowanie do 10 wcześniejszych meczów…' : entries.every(entry => entry?.data) ? 'Dostępne wyniki nie spełniają kryteriów typu zawodnika. Pełna forma w analizie.' : 'Punkty, asysty, zbiórki i strzały — otwórz typy zawodników.'}</p>`}`;
}
function updatePlayerViews(event) {
  document.querySelectorAll('[data-player-preview]').forEach(node => { if (node.dataset.playerPreview === event.id) node.innerHTML = playerPreviewContent(event); });
  if (detailEvent?.id === event.id && $('modal').classList.contains('on')) {
    for (const [side, teamId, name] of [['home', event.homeId, event.home], ['away', event.awayId, event.away]]) {
      const entry = playerForms.get(playerKey(event, teamId));
      if (entry?.data) {
        const key = `${entry.data.fetchedAt}:${excludedPlayers(event).join(',')}:${event.state}:${Date.parse(event.date) <= Date.now()}`;
        const pickNode = $(`player-picks-${side}`), formNode = $(`players-${side}`);
        if (pickNode && pickNode.dataset.renderKey !== key) { pickNode.innerHTML = playerPicksHTML(entry.data, event, { excludedPlayerIds: excludedPlayers(event), showNote: false }); pickNode.dataset.renderKey = key; }
        if (formNode && formNode.dataset.renderKey !== entry.data.fetchedAt) { formNode.innerHTML = playerFormHTML(entry.data, name); formNode.dataset.renderKey = entry.data.fetchedAt; }
      } else if (entry?.status === 'error') {
        if ($(`player-picks-${side}`)) $(`player-picks-${side}`).innerHTML = `<p class="small">Statystyki ${esc(name)} są chwilowo niedostępne. Otwórz analizę ponownie, aby powtórzyć pobranie.</p>`;
      }
    }
  }
  renderBetting();
}
function requestPlayerForm(event, teamId, signal) {
  const key = playerKey(event, teamId), existing = playerForms.get(key);
  if (existing?.promise) return existing.promise;
  if (existing?.data) return Promise.resolve(existing.data);
  const entry = { status: 'loading' };
  playerForms.set(key, entry);
  const params = new URLSearchParams({ sport: event.sport, route: event.route, teamId, cutoff: playerCutoffFor(event), count: '10' });
  entry.promise = json(`/api/player-form?${params}`, signal).then(data => {
    entry.status = 'ready'; entry.data = data; delete entry.promise; updatePlayerViews(event); return data;
  }).catch(error => { entry.status = signal?.aborted ? 'idle' : 'error'; delete entry.promise; updatePlayerViews(event); throw error; });
  updatePlayerViews(event);
  return entry.promise;
}
function requestFixtureDetails(event, signal) {
  const cached = fixtureDetails.get(event.id);
  if (cached?.promise) return cached.promise;
  if (cached?.data && Date.now() - Date.parse(cached.data.fetchedAt) < 5 * 60000) return Promise.resolve(cached.data);
  const params = new URLSearchParams({ sport: event.sport, route: event.route, id: event.sourceEventId });
  const entry = {};
  entry.promise = json(`/api/details?${params}`, signal).then(data => { entry.data = data; delete entry.promise; updatePlayerViews(event); return data; })
    .catch(error => { delete entry.promise; throw error; });
  fixtureDetails.set(event.id, entry);
  return entry.promise;
}
function queuePlayerForms(selected, count = 2, prioritize = false, includePast = false) {
  const signal = loadController?.signal;
  const candidates = selected.filter(event => ['nba', 'nhl', 'football'].includes(event.sport) && (includePast || event.state === 'pre' && Date.parse(event.date) > Date.now())
    && ![event.homeId, event.awayId].every(id => playerForms.get(playerKey(event, id))?.data));
  for (const event of candidates.slice(0, count)) {
    void requestFixtureDetails(event, signal).catch(() => {});
    for (const teamId of [event.homeId, event.awayId]) {
      const key = playerKey(event, teamId);
      if (!playerForms.get(key)?.data && !playerForms.get(key)?.promise && !playerQueue.some(job => job.key === key)) {
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
  const entry = { status: 'loading' };
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
    const options = matchLines.has(event.id) ? { totalLine: matchLines.get(event.id) } : {};
    const picks = buildMatchPicks(entry.data, event, options);
    return matchPicksHTML(entry.data, event, { ...options, compact: true })
      + matchChartsHTML(entry.data, event, { line: picks.totals?.line ?? null, compact: true })
      + `<details class="card-form-details"><summary>Forma obu drużyn</summary>${previewHTML(entry.data, event)}</details>`;
  }
  if (entry?.status === 'error') return '<p class="small">Podsumowanie chwilowo niedostępne. Otwórz analizę, aby spróbować ponownie.</p>';
  return '<p class="small">Pobieranie porównania ostatnich wyników…</p>';
}
function updatePreviewNodes(event) {
  document.querySelectorAll('[data-preview]').forEach(node => { if (node.dataset.preview === event.id) node.innerHTML = previewContent(event); });
  renderBetting();
}
function renderBetting() {
  const query = $('q').value.toLocaleLowerCase('pl'), status = $('status').value;
  const upcoming = events.filter(event => event.state === 'pre' && Date.parse(event.date) > Date.now()
    && (status === 'all' || status === 'pre')
    && `${event.home} ${event.away} ${event.league}`.toLocaleLowerCase('pl').includes(query));
  $('pick-toolbar').hidden = marketView !== 'players';
  document.querySelectorAll('[data-market-view]').forEach(button => {
    const active = button.dataset.marketView === marketView;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  if (marketView === 'matches') {
    const rows = upcoming.flatMap(event => {
      const data = previews.get(previewKey(event))?.data;
      const options = matchLines.has(event.id) ? { totalLine: matchLines.get(event.id) } : {};
      return data ? [{ event, data, options, picks: buildMatchPicks(data, event, options) }] : [];
    });
    const strength = row => row.picks.best ? Math.min(row.picks.best.support.home.hits / row.picks.best.support.home.sample, row.picks.best.support.away.hits / row.picks.best.support.away.sample) : -1;
    const highlighted = rows.filter(row => row.picks.best).sort((a, b) => strength(b) - strength(a));
    const shown = (highlighted.length ? highlighted : rows).slice(0, 4);
    $('betting-summary').innerHTML = !upcoming.length ? '<p class="small">W wybranej dacie nie ma nadchodzących spotkań. Poniżej znajdziesz analizy archiwalne.</p>'
      : `${shown.length ? `<div class="match-pick-summary-grid">${shown.map(({ event, data, options, picks }) => `<article class="match-signal-card"><div class="match-signal-header"><span class="small">${esc(event.league)} • ${esc(localDate(event.date))}</span><h3>${esc(event.home)} — ${esc(event.away)}</h3></div>${matchPicksHTML(data, event, { ...options, compact: true })}${matchChartsHTML(data, event, { line: picks.totals?.line ?? null, compact: true })}<button data-bet-id="${esc(event.id)}">Porównaj wynik i punkty</button></article>`).join('')}</div>` : '<p class="small">Porównywanie ostatnich wyników i sum punktów…</p>'}
      <p class="small dashboard-summary-note">${highlighted.length ? `Wyraźniejsze wskazanie z historii: ${highlighted.length} z ${upcoming.length} meczów.` : rows.length ? 'Porównaj pokazane wyniki z własną linią punktową w analizie meczu.' : 'Wczytywanie wcześniejszych spotkań…'}</p>`;
    document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
    return;
  }
  const rows = upcoming.flatMap(event => eventPlayerPicks(event).slice(0, 4).map(pick => ({ event, pick })));
  const metric = $('pick-market')?.value || 'all';
  const selected = rows.filter(row => metric === 'all' || row.pick.metric === metric).slice(0, 8);
  const ready = upcoming.filter(event => [event.homeId, event.awayId].every(id => playerForms.get(playerKey(event, id))?.data));
  const loading = upcoming.some(event => [event.homeId, event.awayId].some(id => playerForms.get(playerKey(event, id))?.status === 'loading'));
  const remaining = upcoming.filter(event => !ready.includes(event));
  const watch = upcoming.flatMap(event => { const data = previews.get(previewKey(event))?.data; const assessment = data && assessBetting(data, event); return assessment?.candidate ? [{ event, assessment }] : []; });
  $('betting-summary').innerHTML = !upcoming.length
    ? '<p class="small">W wybranym zestawie nie ma nadchodzących spotkań. Analizy rozegranych meczów znajdziesz poniżej.</p>'
    : `${selected.length ? `<div class="player-picks-grid picks-summary-grid">${selected.map(({ event, pick }) => `<article class="player-pick" data-pick-metric="${esc(pick.metric)}"><span class="small">${esc(event.home)} — ${esc(event.away)}</span><h3>${esc(pick.statement)}</h3><p class="player-pick-market">${pick.hits} z ${pick.sample} wcześniejszych występów powyżej tej linii</p><p class="small">Średnia: ${Number(pick.average).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} • mediana: ${Number(pick.median).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}</p><button data-bet-id="${esc(event.id)}">Zobacz formę i pozostałe typy</button></article>`).join('')}</div>`
      : `<p class="small">${loading ? 'Analizowanie ostatnich 10 meczów zawodników…' : ready.length ? 'Dla wybranego rynku nie ma wskazania spełniającego kryteria. Możesz sprawdzić własną linię w analizie zawodnika.' : 'Typy zawodników pojawią się po wczytaniu dłuższej formy.'}</p>`}
      <div class="picks-load"><span class="small">Forma zawodników wczytana dla ${ready.length} z ${upcoming.length} meczów.</span>${remaining.length ? `<button data-more-player-picks ${loading ? 'disabled' : ''}>${loading ? 'Wczytywanie…' : 'Wczytaj typy kolejnych meczów'}</button>` : ''}</div>
      ${watch.length ? `<details class="team-picks-list"><summary>Typy z formy drużyn (${watch.length})</summary><ul class="betting-watchlist">${watch.map(({ event, assessment }) => `<li><div><b>${esc(assessment.candidate.label)}</b><span class="small">${esc(event.home)} — ${esc(event.away)}</span></div><button data-bet-id="${esc(event.id)}">Uzasadnienie</button></li>`).join('')}</ul></details>` : ''}`;
  document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
  const more = document.querySelector('[data-more-player-picks]');
  if (more) more.onclick = () => queuePlayerForms(remaining, 2);
}

function queuePreviews(selected) {
  const controller = previewController;
  if (!controller || controller.signal.aborted) return;
  const version = ++renderVersion, pending = selected.slice(0, 24);
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
    <div class="player-card-preview" data-player-preview="${esc(event.id)}">${playerPreviewContent(event)}</div><button data-id="${esc(event.id)}">Zobacz typy i analizę</button></article>`;
}
function render() {
  const query = $('q').value.toLocaleLowerCase('pl'), status = $('status').value;
  const matchSearch = event => `${event.home} ${event.away} ${event.league}`.toLocaleLowerCase('pl').includes(query);
  const selected = events.filter(event => matchSearch(event) && (status === 'all' || event.state === status));
  const archive = archiveEvents.filter(matchSearch);
  $('title').textContent = `${sports[sport]} • mecze i analizy (${selected.length})`;
  $('cards').innerHTML = selected.length ? selected.map((event, index) => card(event, index < 12)).join('') : '<div class="panel">Brak spotkań pasujących do wybranej daty i filtrów. Dostępne wcześniejsze analizy znajdziesz w archiwum poniżej.</div>';
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
  previews.clear(); matchLines.clear(); playerForms.clear(); fixtureDetails.clear(); playerQueue = []; events = []; archiveEvents = []; ++renderVersion;
  $('archive-status').textContent = ''; $('info').textContent = 'Pobieranie meczów…'; render();
  if (!$('date').value) { $('info').textContent = 'Wybierz datę spotkań.'; return; }
  try {
    const params = new URLSearchParams({ sport, league, date: $('date').value.replaceAll('-', '') });
    const data = await json(`/api/scores?${params}`, controller.signal);
    if (!Array.isArray(data.events)) throw Error('Nieprawidłowa odpowiedź źródła');
    events = data.events.map(event => ({ ...event, sport }));
    $('info').textContent = data.errors?.length ? data.errors.map(message => {
      if (String(message).startsWith('soccer/pol.1:')) return 'Ekstraklasa: brak danych źródłowych.';
      const label = leagues[sport].find(([id]) => id !== 'all' && String(message).startsWith(`${sport === 'football' ? 'soccer' : sport === 'nba' ? 'basketball' : sport === 'nhl' ? 'hockey' : 'tennis'}/${id}:`))?.[1];
      return label ? `${label}: źródło chwilowo niedostępne.` : String(message);
    }).join(' ') : `Terminarz zaktualizowany • ${localDate(data.fetchedAt)}`;
  } catch (error) {
    if (controller.signal.aborted) return;
    $('info').textContent = `Terminarz jest chwilowo niedostępny: ${error.message}. Dostępne analizy archiwalne poniżej.`;
  }
  render();
  queuePlayerForms(events, 2);
  if (!events.length) await loadArchive(controller.signal);
}
function existingStatsHTML(data, event) {
  let html = '';
  if (data.teamStats?.length) html += '<h3>Statystyki drużyn w tym meczu</h3>' + data.teamStats.map(team => `<div class="panel"><b>${esc(team.team)}</b><p class="small">${team.statistics.slice(0, 18).map(stat => `${esc(stat.name)}: ${esc(stat.value)}`).join(' • ')}</p></div>`).join('');
  if (data.playerAnalysis?.length) html += '<h3>Liderzy tego meczu</h3>' + data.playerAnalysis.map(metric => `<p><b>${esc(metric.title)}</b>: ${metric.leaders.map(player => `${esc(player.name)} — ${player.value}`).join(' • ')}</p>`).join('');
  if (data.players?.length) html += `<h3>Zawodnicy — statystyki tego meczu</h3><div class="scroll"><table><thead><tr><th>Zawodnik</th><th>Drużyna</th><th>Statystyki</th></tr></thead><tbody>${data.players.map(player => `<tr><td>${esc(player.name)}</td><td>${esc(player.team)}</td><td>${player.didNotPlay ? 'Nie grał(a)' : esc(player.stats.map((value, index) => `${player.labels[index] || ''}: ${value}`).join(' | '))}</td></tr>`).join('')}</tbody></table></div>`;
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
    <div id="betting-detail"><p class="small">Porównywanie wyniku i sumy punktów…</p></div>
    ${event.sport !== 'tennis' ? `<section class="match-player-picks"><h3>Typy na zawodników</h3><p class="small">Linie analityczne z wcześniejszych występów; sprawdź linię z oferty i dostępność zawodnika przed decyzją.</p><div class="analysis-sides"><div id="player-picks-home"><h4>${esc(event.home)}</h4><p class="small">${event.state === 'pre' && Date.parse(event.date) > Date.now() ? 'Analizowanie do 10 wcześniejszych meczów…' : 'Typy zawodników są dostępne przed rozpoczęciem spotkania. Poniżej pozostaje analiza archiwalna.'}</p></div><div id="player-picks-away"><h4>${esc(event.away)}</h4><p class="small">${event.state === 'pre' && Date.parse(event.date) > Date.now() ? 'Analizowanie do 10 wcześniejszych meczów…' : 'Typy zawodników są dostępne przed rozpoczęciem spotkania. Poniżej pozostaje analiza archiwalna.'}</p></div></div></section>` : ''}
    <div id="availability"><p class="small">Sprawdzanie dostępności zawodników…</p></div>
    <details class="panel detail-section"><summary>Pełna forma drużyn i bezpośrednie spotkania</summary><div id="match-detail"><p>Wczytywanie porównania…</p></div></details>
    ${event.sport !== 'tennis' ? `<details class="panel detail-section"><summary>Pełna forma zawodników — do 10 meczów</summary><div class="analysis-sides"><div id="players-home"><p class="small">Ładowanie: ${esc(event.home)}…</p></div><div id="players-away"><p class="small">Ładowanie: ${esc(event.away)}…</p></div></div></details>` : ''}
    <details class="panel detail-section"><summary>Kursy na wynik meczu ze źródła</summary><div id="source-odds"></div></details>
    <details class="panel detail-section"><summary>Kalkulator kursu i dziennik własnych typów na wynik</summary><div id="journal-form"></div></details>
    <details id="game-boxscore" class="panel detail-section" ${event.state !== 'pre' ? 'open' : ''}><summary>${event.state === 'pre' ? 'Dodatkowe informacje o spotkaniu' : 'Statystyki rozegranego meczu'}</summary><div id="match-boxscore"><p class="small">Pobieranie dodatkowych statystyk…</p></div></details>`;
  journal.open(event, $('journal-form'));
  if (['nba', 'nhl', 'football'].includes(event.sport) && event.state === 'pre' && Date.parse(event.date) > Date.now()) {
    const params = new URLSearchParams({ sport: event.sport, route: event.route, id: event.id, homeId: event.homeId, awayId: event.awayId, startTime: new Date(event.date).toISOString() });
    void json(`/api/odds?${params}`, controller.signal).then(data => {
      if (!controller.signal.aborted) $('source-odds').innerHTML = oddsHTML(data, event);
    }).catch(() => { if (!controller.signal.aborted) $('source-odds').innerHTML = '<p class="small">Kursy źródłowe są chwilowo niedostępne. Możesz ręcznie wpisać kurs w kalkulatorze.</p>'; });
  }
  void previewRequest(event, previewController?.signal).then(data => {
    if (!controller.signal.aborted) {
      const options = matchLines.has(event.id) ? { totalLine: matchLines.get(event.id) } : {};
      const marketPicks = buildMatchPicks(data, event, options);
      $('betting-detail').innerHTML = matchPicksHTML(data, event, options) + matchChartsHTML(data, event, { line: marketPicks.totals?.line ?? null });
      $('betting-detail').dataset.marketStatus = marketPicks.status;
      $('match-detail').innerHTML = matchDetailHTML(data, event) + contextHTML(data, event);
    }
  }).catch(() => { if (!controller.signal.aborted) { $('betting-detail').innerHTML = '<p class="small">Forma drużyn jest chwilowo niedostępna.</p>'; $('match-detail').innerHTML = '<p>Analiza wcześniejszych wyników jest chwilowo niedostępna. Spróbuj otworzyć ją ponownie.</p>'; } });
  if (event.sport !== 'tennis') {
    updatePlayerViews(event);
    queuePlayerForms([event], 1, true, true);
  }
  void requestFixtureDetails(event, loadController?.signal).then(data => { if (!controller.signal.aborted) {
    $('availability').innerHTML = availabilityHTML(data, event);
    $('match-boxscore').innerHTML = existingStatsHTML(data, event);
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
  } else html += `<p>${sport === 'football' && league === 'pol.1' ? 'Ekstraklasa: brak zweryfikowanego darmowego źródła historii. Model tej ligi jest niedostępny.' : 'Brak wystarczającej próby do przedstawienia wyników testu dla wybranej ligi.'}</p>`;
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
document.querySelectorAll('[data-market-view]').forEach(button => button.onclick = () => { marketView = button.dataset.marketView; renderBetting(); });
$('pick-market').onchange = renderBetting;
$('q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); }; $('status').onchange = render; $('date').onchange = () => { closeDetail(); load(); };
$('refresh').onclick = () => { closeDetail(); load(); loadModel(); loadReadiness(); };
$('show-archive').onclick = () => loadArchive(loadController?.signal, true);
$('close').onclick = closeDetail;
$('modal').onclick = event => { if (event.target === $('modal')) closeDetail(); };
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
$('detail').addEventListener('submit', submit => {
  const matchForm = submit.target.closest('form[data-match-line]');
  if (matchForm && detailEvent) {
    submit.preventDefault();
    const raw = String(matchForm.elements.namedItem('totalLine').value).trim();
    const line = /^\d+(?:[,.]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
    const output = matchForm.querySelector('[data-match-line-result]');
    if (!Number.isFinite(line) || line < 1.5 || line >= 600 || !Number.isInteger(line * 2) || Number.isInteger(line)) {
      output.textContent = 'Wpisz linię połówkową, np. 224,5.'; return;
    }
    const data = previews.get(previewKey(detailEvent))?.data;
    if (!data) { output.textContent = 'Wczytaj analizę meczu przed porównaniem linii.'; return; }
    const picks = buildMatchPicks(data, detailEvent, { totalLine: line });
    if (!picks.totals) { output.textContent = picks.reason || 'Odśwież analizę przed porównaniem własnej linii.'; return; }
    matchLines.set(detailEvent.id, line);
    $('betting-detail').innerHTML = matchPicksHTML(data, detailEvent, { totalLine: line }) + matchChartsHTML(data, detailEvent, { line });
    $('betting-detail').dataset.marketStatus = picks.status;
    const updated = $('betting-detail').querySelector('[data-match-line-result]');
    if (updated) updated.textContent = picks.totals ? `Porównano Twoją linię ${String(line).replace('.', ',')} z wcześniejszymi sumami punktów.` : picks.reason;
    updatePreviewNodes(detailEvent);
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
  output.textContent = comparison ? `${comparison.statement}: ${comparison.hits} z ${comparison.sample} wcześniejszych występów. To porównanie historyczne dla Twojej linii.` : result.reason || 'Brak porównywalnej historii dla tej linii.';
});
const journal = createJournalUI({ root: $('journal-root'), fetchJSON: json });
nav(); loadModel(); loadReadiness(); load();
void journal.refresh();
setInterval(() => {
  renderBetting();
  document.querySelectorAll('[data-preview]').forEach(node => {
    const event = [...events, ...archiveEvents].find(item => item.id === node.dataset.preview);
    if (event && previews.get(previewKey(event))?.data) node.innerHTML = previewContent(event);
  });
  const data = detailEvent && previews.get(previewKey(detailEvent))?.data;
  if (data && $('betting-detail')) {
    const options = matchLines.has(detailEvent.id) ? { totalLine: matchLines.get(detailEvent.id) } : {};
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
