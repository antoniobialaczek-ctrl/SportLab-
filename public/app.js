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
let sport = 'nba', league = 'all', events = [], report = null, loadController, detailController, lastDetailButton;
const today = new Date();
$('date').value = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

async function json(url, signal) {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}

function nav() {
  $('sports').innerHTML = Object.entries(sports).map(([key, title]) => `<button data-s="${key}" class="${key === sport ? 'active' : ''}" aria-pressed="${key === sport}">${title}</button>`).join('');
  $('leagues').innerHTML = leagues[sport].map(([key, title]) => `<button data-l="${key}" class="${key === league ? 'active' : ''}" aria-pressed="${key === league}">${title}</button>`).join('');
  document.querySelectorAll('[data-s]').forEach(button => button.onclick = () => {
    sport = button.dataset.s; league = 'all'; closeDetail(); nav(); renderModel(); load();
  });
  document.querySelectorAll('[data-l]').forEach(button => button.onclick = () => {
    league = button.dataset.l; nav(); renderModel(); load();
  });
}

function render() {
  const query = $('q').value.toLocaleLowerCase('pl'), status = $('status').value;
  const selected = events.filter(event => `${event.home} ${event.away} ${event.league}`.toLocaleLowerCase('pl').includes(query) && (status === 'all' || event.state === status));
  $('title').textContent = `${sports[sport]} • ${selected.length} meczów`;
  $('cards').innerHTML = selected.length ? selected.map(event => `<article class="card">
    <div class="row small"><span>${esc(event.league)}</span><span>${esc(event.state === 'post' ? event.statusDetail || 'Zakończony' : event.state === 'in' ? 'Na żywo' : localDate(event.date))}</span></div>
    <div class="teams"><span>${esc(event.home)}</span><small>${event.state === 'pre' ? 'VS' : `${esc(event.homeScore ?? '—')} : ${esc(event.awayScore ?? '—')}`}</small><span>${esc(event.away)}</span></div>
    <p class="small">Bilanse źródła: ${esc(event.homeRecord || 'brak')} / ${esc(event.awayRecord || 'brak')}</p>
    <p class="small">Prognoza: wstrzymana do czasu wiarygodnej walidacji przedmeczowej.</p>
    <button data-id="${esc(event.id)}">Zobacz statystyki</button></article>`).join('') : '<div class="panel">Brak danych dla wybranej daty lub dyscypliny.</div>';
  document.querySelectorAll('[data-id]').forEach(button => button.onclick = () => detail(button.dataset.id, button));
}

async function load() {
  loadController?.abort();
  const controller = new AbortController(); loadController = controller;
  $('info').textContent = 'Ładowanie…'; events = []; render();
  try {
    const params = new URLSearchParams({ sport, league, date: $('date').value.replaceAll('-', '') });
    const data = await json(`/api/scores?${params}`, controller.signal);
    if (!Array.isArray(data.events)) throw Error('Nieprawidłowa odpowiedź źródła');
    events = data.events;
    $('info').textContent = data.errors?.length ? `Część źródeł niedostępna: ${data.errors.join(', ')}` : `Dane zaktualizowane • ${localDate(data.fetchedAt)}`;
  } catch (error) {
    if (controller.signal.aborted) return;
    $('info').textContent = `Błąd pobierania: ${error.message}`;
  }
  render();
}

function formHTML(summary, name, tennis) {
  const unit = tennis ? 'sety' : sport === 'nba' ? 'punkty' : 'gole';
  return `<div class="panel"><b>${esc(name)}</b>${summary.sample ? `
    <p>Próba: ${summary.sample} • zwycięstwa ${summary.wins} / remisy ${summary.draws} / porażki ${summary.losses}</p>
    <p class="small">Średnio ${unit}: zdobyte ${number(summary.averageFor)}, stracone ${number(summary.averageAgainst)}</p>
    <p class="small">${summary.recent.map(row => `${esc(row.date.slice(0, 10))}: ${esc(row.opponent)} ${row.scoreFor}:${row.scoreAgainst} (${row.outcome})`).join('<br>')}</p>` : '<p class="small">Brak wcześniejszych spotkań w zapisanej historii.</p>'}</div>`;
}

async function detail(id, button) {
  const event = events.find(item => item.id === id);
  if (!event) return;
  detailController?.abort();
  const controller = new AbortController(); detailController = controller;
  lastDetailButton = button;
  $('modal').classList.add('on'); $('close').focus();
  $('mtitle').textContent = `${event.home} — ${event.away}`;
  $('detail').innerHTML = '<p>Ładowanie analiz…</p>';
  const selectedSport = sport;
  const cutoff = new Date(Math.min(Date.now(), Date.parse(event.date))).toISOString();
  const analysis = participantId => json(`/api/analysis?${new URLSearchParams({ sport: selectedSport, route: event.route, participantId, cutoff })}`, controller.signal);
  const results = await Promise.allSettled([
    json(`/api/details?${new URLSearchParams({ sport: selectedSport, route: event.route, id: event.sourceEventId })}`, controller.signal),
    analysis(event.homeId), analysis(event.awayId),
  ]);
  if (controller.signal.aborted) return;
  let html = `<h3>${selectedSport === 'tennis' ? 'Forma zawodników' : 'Analiza drużyn'} przed meczem</h3>
    <p class="small">Wyniki dostępne przed ${esc(localDate(cutoff))}. Próba ostatnich 10 zapisanych meczów danej ligi; niepełna historia nie jest pełnym bilansem sezonu.</p>`;
  html += results.slice(1).map((result, index) => result.status === 'fulfilled'
    ? formHTML(result.value, index === 0 ? event.home : event.away, selectedSport === 'tennis')
    : `<p class="small">Analiza ${esc(index === 0 ? event.home : event.away)} niedostępna.</p>`).join('');
  if (results[0].status === 'fulfilled') {
    const data = results[0].value;
    html += '<h3>Statystyki drużyn w tym meczu</h3>';
    html += (data.teamStats || []).map(team => `<div class="panel"><b>${esc(team.team)}</b><p class="small">${team.statistics.slice(0, 18).map(s => `${esc(s.name)}: ${esc(s.value)}`).join(' • ')}</p></div>`).join('') || '<p>Brak danych</p>';
    html += '<h3>Analiza zawodników w tym meczu</h3><p class="small">Liderzy według dostępnych statystyk meczowych; wartości opisowe, bez prognozy. Brakującej wartości nie zastępujemy zerem.</p>';
    html += (data.playerAnalysis || []).map(metric => `<p><b>${esc(metric.title)}</b> (dostępne dane: ${metric.sample} zawodników): ${metric.leaders.map(p => `${esc(p.name)} — ${p.value}`).join(' • ')}</p>`).join('') || '<p>Brak porównywalnych danych zawodników.</p>';
    html += '<h3>Zawodnicy — pełne statystyki</h3>';
    html += data.players?.length ? `<div class="scroll"><table><thead><tr><th>Zawodnik</th><th>Drużyna</th><th>Statystyki</th></tr></thead><tbody>${data.players.map(player => `<tr><td>${esc(player.name)}</td><td>${esc(player.team)}</td><td>${player.didNotPlay ? 'Nie grał(a)' : esc(player.stats.map((value, i) => `${player.labels[i] || ''}: ${value}`).join(' | '))}</td></tr>`).join('')}</tbody></table></div>` : '<p>Brak statystyk zawodników</p>';
    html += '<h3>Kontuzje — stan źródła w chwili pobrania</h3>';
    html += data.injuries?.length ? data.injuries.map(injury => `<p>${esc(injury.name)} (${esc(injury.team)}) — ${esc(injury.status)}</p>`).join('') : '<p>Źródło nie zwróciło listy kontuzji.</p>';
    html += `<p class="small">${esc(data.note)} • ${esc(data.source)} • ${esc(localDate(data.fetchedAt))}</p>`;
  } else html += `<p>Nie udało się pobrać szczegółów: ${esc(results[0].reason.message)}</p>`;
  $('detail').innerHTML = html;
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
  html += `<p class="small">Raport: ${esc(localDate(report.generatedAt))}${report.stale ? ' • raport nieaktualny' : ''}. ${esc(report.method)} ${esc(report.note)}</p>`;
  $('model').innerHTML = html;
}

async function loadModel() {
  try { report = await json('/api/model'); renderModel(); }
  catch { $('model').textContent = 'Raport testów niedostępny'; }
}

function closeDetail() {
  detailController?.abort(); $('modal').classList.remove('on');
  if (lastDetailButton?.isConnected) lastDetailButton.focus();
}
$('q').oninput = render; $('status').onchange = render; $('date').onchange = load;
$('refresh').onclick = () => { load(); loadModel(); };
$('close').onclick = closeDetail;
$('modal').onclick = event => { if (event.target === $('modal')) closeDetail(); };
document.addEventListener('keydown', event => {
  if (!$('modal').classList.contains('on')) return;
  if (event.key === 'Escape') closeDetail();
  // The close button is the only interactive element inside this dialog.
  if (event.key === 'Tab') { event.preventDefault(); $('close').focus(); }
});
nav(); loadModel(); load();
setInterval(() => { if (!document.hidden) load(); }, 300000);
