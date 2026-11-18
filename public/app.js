import { previewHTML, matchDetailHTML, playerFormHTML } from '/analysis-view.js';
import { assessBetting, bettingHTML, bettingDetailHTML } from '/betting-view.js';
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
let sport = 'nba', league = 'all', events = [], archiveEvents = [], report = null, detailEvent = null;
let loadController, detailController, previewController, lastDetailButton, renderVersion = 0;
let viewAsOf = Math.floor(Date.now() / 60000) * 60000;
const previews = new Map();
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
  if (entry?.data) return previewHTML(entry.data, event) + bettingHTML(entry.data, event);
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
  const assessed = upcoming.flatMap(event => {
    const entry = previews.get(previewKey(event));
    return entry?.data ? [{ event, assessment: assessBetting(entry.data, event) }] : [];
  });
  const watch = assessed.filter(row => row.assessment.status === 'watch');
  const failed = upcoming.filter(event => previews.get(previewKey(event))?.status === 'error').length;
  const pending = upcoming.length - assessed.length - failed;
  $('betting-summary').innerHTML = !upcoming.length
    ? '<p class="small">Brak nadchodzących spotkań w wybranej dacie i filtrach. Dla meczów rozpoczętych i archiwalnych nie podajemy typów przedmeczowych.</p>'
    : `<p><b>Na teraz: odpuść zakłady.</b> Brakuje zweryfikowanej prognozy przedmeczowej i aktualnych kursów, więc nie ma podstaw do potwierdzenia opłacalności.</p>
      <p class="small">Sprawdzone mecze: ${assessed.length}/${upcoming.length}. Kierunki do obserwacji: ${watch.length}.${pending ? ` Pozostałe ${pending}: porównanie w trakcie pobierania lub dostępne po otwarciu analizy.` : ''}${failed ? ` Nie udało się pobrać porównania dla ${failed} spotkań.` : ''}</p>
      ${watch.length ? `<ul class="betting-watchlist">${watch.map(({ event, assessment }) => `<li><div><b>${esc(assessment.candidate.label)}</b><span class="small">${esc(event.home)} — ${esc(event.away)} • ${esc(localDate(event.date))}<br>Kierunek z formy; opłacalność niepotwierdzona.</span></div><button data-bet-id="${esc(event.id)}">Zobacz dlaczego</button></li>`).join('')}</ul>` : `<p class="small">${pending ? 'Kierunki pojawią się po sprawdzeniu porównań.' : 'Żaden ze sprawdzonych meczów nie spełnia reguł listy obserwacyjnej.'}</p>`}`;
  document.querySelectorAll('[data-bet-id]').forEach(button => button.onclick = () => detail(button.dataset.betId, button));
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
  document.querySelectorAll('[data-s]').forEach(button => button.onclick = () => { sport = button.dataset.s; league = 'all'; closeDetail(); nav(); renderModel(); load(); });
  document.querySelectorAll('[data-l]').forEach(button => button.onclick = () => { league = button.dataset.l; closeDetail(); nav(); renderModel(); load(); });
}
function card(event, eager) {
  return `<article class="card"><div class="row small"><span>${esc(event.league)}</span><span>${esc(event.state === 'post' ? `${localDate(event.date)} • zakończony` : event.state === 'in' ? 'Na żywo' : localDate(event.date))}</span></div>
    <div class="teams"><span>${esc(event.home)}</span><small>${event.state === 'pre' ? 'VS' : `${esc(event.homeScore ?? '—')} : ${esc(event.awayScore ?? '—')}`}</small><span>${esc(event.away)}</span></div>
    <div class="match-preview" data-preview="${esc(event.id)}">${eager || previews.has(previewKey(event)) ? previewContent(event) : '<p class="small">Porównanie wcześniejszych wyników i formy dostępne w analizie meczu.</p>'}</div>
    <button data-id="${esc(event.id)}">Otwórz analizę meczu</button></article>`;
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
  previews.clear(); events = []; archiveEvents = []; ++renderVersion;
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
  if (!events.length) await loadArchive(controller.signal);
}
function existingStatsHTML(data, event) {
  let html = '';
  if (data.teamStats?.length) html += '<h3>Statystyki drużyn w tym meczu</h3>' + data.teamStats.map(team => `<div class="panel"><b>${esc(team.team)}</b><p class="small">${team.statistics.slice(0, 18).map(stat => `${esc(stat.name)}: ${esc(stat.value)}`).join(' • ')}</p></div>`).join('');
  if (data.playerAnalysis?.length) html += '<h3>Liderzy tego meczu</h3>' + data.playerAnalysis.map(metric => `<p><b>${esc(metric.title)}</b>: ${metric.leaders.map(player => `${esc(player.name)} — ${player.value}`).join(' • ')}</p>`).join('');
  if (data.players?.length) html += `<h3>Zawodnicy — statystyki tego meczu</h3><div class="scroll"><table><thead><tr><th>Zawodnik</th><th>Drużyna</th><th>Statystyki</th></tr></thead><tbody>${data.players.map(player => `<tr><td>${esc(player.name)}</td><td>${esc(player.team)}</td><td>${player.didNotPlay ? 'Nie grał(a)' : esc(player.stats.map((value, index) => `${player.labels[index] || ''}: ${value}`).join(' | '))}</td></tr>`).join('')}</tbody></table></div>`;
  if (data.injuries?.length) html += '<h3>Kontuzje — stan źródła w chwili pobrania</h3>' + data.injuries.map(row => `<p>${esc(row.name)} (${esc(row.team)}) — ${esc(row.status)}</p>`).join('');
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
  $('detail').innerHTML = `<p class="small">${esc(event.league)} • ${esc(localDate(event.date))}</p><div id="betting-detail"><p class="small">Co warto obstawić? Sprawdzanie danych…</p></div><div id="match-detail"><p>Pobieranie porównania formy…</p></div>${event.sport !== 'tennis' ? `<h3>Forma zawodników z ostatnich meczów</h3><p class="small">Dostępne statystyki z maksymalnie dwóch wcześniejszych spotkań każdej drużyny. To opis ostatnich występów, a nie potwierdzenie składu na kolejny mecz.</p><div class="analysis-sides"><div id="players-home"><p class="small">Ładowanie: ${esc(event.home)}…</p></div><div id="players-away"><p class="small">Ładowanie: ${esc(event.away)}…</p></div></div>` : ''}<details id="game-boxscore" ${event.state !== 'pre' ? 'open' : ''}><summary>${event.state === 'pre' ? 'Dostępne informacje o spotkaniu' : 'Statystyki rozegranego meczu'}</summary><div id="match-boxscore"><p class="small">Pobieranie dodatkowych statystyk…</p></div></details>`;
  void previewRequest(event, previewController?.signal).then(data => {
    if (!controller.signal.aborted) {
      $('betting-detail').innerHTML = bettingDetailHTML(data, event);
      $('match-detail').innerHTML = matchDetailHTML(data, event);
    }
  }).catch(() => { if (!controller.signal.aborted) { $('betting-detail').innerHTML = '<section class="betting-box"><h3>Co warto obstawić?</h3><p><b>Odpuść — dane chwilowo niedostępne.</b></p></section>'; $('match-detail').innerHTML = '<p>Analiza wcześniejszych wyników jest chwilowo niedostępna. Spróbuj otworzyć ją ponownie.</p>'; } });
  if (event.sport !== 'tennis') {
    for (const [side, teamId, name] of [['home', event.homeId, event.home], ['away', event.awayId, event.away]]) {
      const params = new URLSearchParams({ sport: event.sport, route: event.route, teamId, cutoff: cutoffFor(event), count: '2' });
      void json(`/api/player-form?${params}`, controller.signal).then(data => { if (!controller.signal.aborted) $(`players-${side}`).innerHTML = playerFormHTML(data, name); })
        .catch(() => { if (!controller.signal.aborted) $(`players-${side}`).innerHTML = `<p class="small">Forma zawodników ${esc(name)} jest chwilowo niedostępna.</p>`; });
    }
  }
  const params = new URLSearchParams({ sport: event.sport, route: event.route, id: event.sourceEventId });
  void json(`/api/details?${params}`, controller.signal).then(data => { if (!controller.signal.aborted) $('match-boxscore').innerHTML = existingStatsHTML(data, event); })
    .catch(() => { if (!controller.signal.aborted) $('match-boxscore').textContent = 'Dodatkowe statystyki tego spotkania nie są dostępne. Analiza wcześniejszej formy jest niezależna od boxscore.'; });
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


function closeDetail() {
  detailController?.abort(); detailEvent = null; $('modal').classList.remove('on');
  if (lastDetailButton?.isConnected) lastDetailButton.focus();
}
let searchTimer;
$('q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); }; $('status').onchange = render; $('date').onchange = () => { closeDetail(); load(); };
$('refresh').onclick = () => { closeDetail(); load(); loadModel(); };
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
nav(); loadModel(); load();
setInterval(() => {
  renderBetting();
  document.querySelectorAll('[data-preview]').forEach(node => {
    const event = [...events, ...archiveEvents].find(item => item.id === node.dataset.preview);
    if (event && previews.get(previewKey(event))?.data) node.innerHTML = previewContent(event);
  });
  const data = detailEvent && previews.get(previewKey(detailEvent))?.data;
  if (data && $('betting-detail')) $('betting-detail').innerHTML = bettingDetailHTML(data, detailEvent);
}, 30000);
setInterval(() => { if (!document.hidden && !$('modal').classList.contains('on')) load(); }, 300000);
