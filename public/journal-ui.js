import { escapeHTML as esc } from './analysis-view.js';
import {
  emptyJournal, validateJournal, createRecord, appendRecord, mergeJournals,
  settleJournal, summarizeJournal, evaluatePrice,
} from './journal-core.js';

const STORAGE_KEY = 'sportlab.personal-journal.v1';
const IMPORT_LIMIT = 1024 * 1024;
const decimal = value => Number.isFinite(value) ? value.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) : '—';
const percent = value => Number.isFinite(value) ? `${(value * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%` : '—';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pl-PL') : '—';
const statuses = { pending: 'Oczekuje', won: 'Wygrany', lost: 'Przegrany', void: 'Zwrot', conflict: 'Konflikt wyniku — poza statystyką' };
const inputNumber = value => /^[0-9]+([,.][0-9]+)?$/.test(value.trim()) ? Number(value.trim().replace(',', '.')) : NaN;

function marketOptions(event) {
  if (event.sport === 'football') return [
    { key: 'result_90', name: 'Wynik po 90 minutach', outcomes: [['home', event.home], ['draw', 'Remis'], ['away', event.away]] },
    { key: 'double_chance_90', name: 'Podwójna szansa po 90 minutach', outcomes: [['home_draw', `${event.home} lub remis (1X)`], ['draw_away', `Remis lub ${event.away} (X2)`]] },
    ...(['soccer/pol.1', 'soccer/usa.1'].includes(event.route) ? [{ key: 'total_goals', name: 'Suma goli po 90 minutach', outcomes: [['over', 'Powyżej linii'], ['under', 'Poniżej linii']] }] : []),
  ];
  return [{ key: 'winner', name: event.sport === 'nhl' ? 'Zwycięzca z dogrywką i karnymi' : 'Zwycięzca z dogrywką', outcomes: [['home', event.home], ['away', event.away]] },
    ...(event.sport === 'nba' ? [{ key: 'total_points', name: 'Suma punktów z dogrywką', outcomes: [['over', 'Powyżej linii'], ['under', 'Poniżej linii']] }] : [])];
}

const metricUnit = { PTS: 'punktu', AST: 'asysty', REB: 'zbiórki', S: 'strzału na bramkę', SH: 'strzału' };
const scopeLabel = { including_overtime: 'z dogrywką', including_overtime_shootout: 'z dogrywką i karnymi', including_overtime_excluding_shootout: 'z dogrywką, bez karnych', regulation_90: '90 minut' };
const totalMarket = market => ['total_points', 'total_goals'].includes(market);

export function journalRecordLabel(record) {
  const scope = scopeLabel[record.scope] || (record.market === 'winner' ? record.sport === 'nhl' ? 'z dogrywką i karnymi' : 'z dogrywką' : '90 minut');
  if (record.market === 'player_prop' || totalMarket(record.market)) {
    const unit = record.market === 'player_prop' ? metricUnit[record.metric] : record.market === 'total_goals' ? 'gola' : 'punktu';
    return `${record.market === 'player_prop' ? `${record.playerName} — ` : ''}${record.outcome === 'under' ? 'Poniżej' : 'Powyżej'} ${decimal(record.line)} ${unit} • ${scope}`;
  }
  const names = { home: record.home, away: record.away, draw: 'Remis', home_draw: `${record.home} lub remis (1X)`, draw_away: `Remis lub ${record.away} (X2)` };
  return `${names[record.outcome] || record.outcome} • ${scope}`;
}

/** Convert a visible analytical selection into an exact personal entry. A
 * preview record uses the same validation as the eventual save, but is neither
 * persisted nor sent anywhere. Labels and hit counts never determine a price.
 */
export function journalSelectionForPick(event, pick, { now = Date.now() } = {}) {
  if (!pick || typeof pick !== 'object' || Array.isArray(pick)) throw new Error('Brak dokładnego typu do zapisania.');
  const kind = pick.kind || (pick.playerId && pick.metric ? 'player' : null);
  let input;
  if (kind === 'player' && (pick.market == null || pick.market === 'player_prop')) {
    input = { market: 'player_prop', outcome: pick.direction, line: pick.line, scope: pick.scope,
      playerId: pick.playerId, teamId: pick.teamId, metric: pick.metric, playerName: pick.playerName };
  } else if (kind === 'total' && totalMarket(pick.market)) {
    input = { market: pick.market, outcome: pick.direction, line: pick.line, scope: pick.scope };
  } else if (kind === 'result') {
    const chance = { '1X': 'home_draw', X2: 'draw_away' }[pick.market];
    if (chance) input = { market: 'double_chance_90', outcome: chance, scope: pick.scope };
    else if (pick.market === 'winner') input = { market: event.sport === 'football' ? 'result_90' : 'winner', outcome: pick.side, scope: pick.scope };
    else if (['result_90', 'double_chance_90'].includes(pick.market)) input = { market: pick.market, outcome: pick.outcome ?? pick.side, scope: pick.scope };
  }
  if (!input) throw new Error('Ten typ nie ma obsługiwanego rynku rozliczenia.');
  const preview = createRecord(event, { ...input, odds: 2, stake: 1 }, { now, id: 'journal-selection-preview' });
  return Object.fromEntries(['market', 'outcome', 'line', 'scope', 'playerId', 'teamId', 'metric', 'playerName'].filter(key => preview[key] != null).map(key => [key, preview[key]]));
}

/** Bounded public result requests. Entries, prices, stakes and selections
 * stay local. Older results retain rotating coverage for late corrections.
 */
export function planJournalRefresh(value, { now = Date.now(), priorityCursor = 0, olderCursor = 0, limit = 10 } = {}) {
  const checked = validateJournal(value), current = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(current) || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Nieprawidłowy zakres sprawdzenia dziennika.');
  const fixtures = new Map();
  for (const record of checked.records) {
    if (Date.parse(record.startTime) >= current) continue;
    const key = `${record.sport}:${record.fixtureId}`, existing = fixtures.get(key);
    const priority = record.status === 'pending' || Date.parse(record.startTime) >= current - 7 * 86400000;
    if (!existing) fixtures.set(key, { sport: record.sport, id: record.fixtureId, start: record.startTime, priority });
    else existing.priority ||= priority;
  }
  const all = [...fixtures.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  const priority = all.filter(row => row.priority), older = all.filter(row => !row.priority);
  const take = (list, cursor, count) => {
    const start = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor % Math.max(1, list.length) : 0;
    const rows = Array.from({ length: Math.min(count, list.length) }, (_, offset) => list[(start + offset) % list.length]);
    return { rows, next: list.length ? (start + rows.length) % list.length : 0 };
  };
  const oldCount = priority.length ? Math.min(2, older.length, Math.max(0, limit - 1)) : Math.min(limit, older.length);
  const chosenPriority = take(priority, priorityCursor, limit - oldCount);
  const chosenOlder = take(older, olderCursor, Math.min(older.length, limit - chosenPriority.rows.length));
  const chosen = [...chosenPriority.rows, ...chosenOlder.rows], requests = [];
  for (const sport of [...new Set(chosen.map(row => row.sport))]) {
    const ids = chosen.filter(row => row.sport === sport).map(row => row.id);
    for (let offset = 0; offset < ids.length; offset += 2) requests.push({ sport, ids: ids.slice(offset, offset + 2), details: '1' });
  }
  return { requests, eligibleCount: all.length, selectedCount: chosen.length,
    priorityCursor: chosenPriority.next, olderCursor: chosenOlder.next };
}

function matchingObservedQuote(quote, event, selection, now) {
  const observed = Date.parse(quote?.observedAt);
  if (!quote || quote.status !== 'matched' || quote.fixtureId !== event.id || quote.scope !== selection.scope
    || typeof quote.provider !== 'string' || !quote.provider.trim() || quote.provider.length > 100
    || !Number.isFinite(observed) || observed > now || now - observed > 5 * 60000
    || !(typeof quote.decimal === 'number' && Number.isFinite(quote.decimal) && quote.decimal >= 1.01 && quote.decimal <= 1000)
    || quote.selection !== selection.outcome || (selection.line == null ? quote.line != null : quote.line !== selection.line)) return null;
  const market = selection.market === 'result_90' ? 'winner' : selection.market;
  if (quote.market !== market || selection.market === 'player_prop' && ['playerId', 'teamId', 'metric'].some(key => quote[key] !== selection[key])) return null;
  return quote;
}

function download(content, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Personal, device-local journal. Neither manual quotes nor local timestamps
 * are certified evidence of a model's performance or of bookmaker availability.
 */
export function createJournalUI({ root, fetchJSON }) {
  if (!root || typeof fetchJSON !== 'function') throw new Error('Brak elementu dziennika lub obsługi API.');
  let journal = emptyJournal(), storage, lastRaw = null, recoveryRaw = null;
  let blocked = false, loaded = false, message = '', refreshing = false;
  let priorityCursor = 0, olderCursor = 0;
  const forms = new Set();
  try {
    storage = window.localStorage;
    lastRaw = storage.getItem(STORAGE_KEY);
    if (lastRaw !== null) {
      recoveryRaw = lastRaw;
      journal = validateJournal(JSON.parse(lastRaw));
      recoveryRaw = null;
    }
    loaded = true;
  } catch {
    blocked = true;
    message = recoveryRaw !== null
      ? 'Zapisany dziennik ma nieprawidłowy format. Zachowano oryginalny zapis. Pobierz kopię do odzyskania; dodawanie i import są wyłączone.'
      : 'Pamięć przeglądarki jest niedostępna. Dodawanie i import są wyłączone, aby nie utracić wpisów.';
  }

  function announceForms() {
    for (const form of forms) {
      if (!form.isConnected) { forms.delete(form); continue; }
      const save = form.querySelector('[data-journal-save]');
      if (save) save.disabled = blocked;
    }
  }

  function persist(next) {
    if (blocked) throw new Error('Zapis dziennika jest wyłączony.');
    const checked = validateJournal(next);
    try {
      if (storage.getItem(STORAGE_KEY) !== lastRaw) throw new Error('Dziennik zmienił się w innej karcie. Odśwież stronę przed dalszą pracą.');
      const serialized = JSON.stringify(checked);
      storage.setItem(STORAGE_KEY, serialized);
      lastRaw = serialized; journal = checked;
    } catch (error) {
      blocked = true;
      message = error.message?.includes('innej karcie') ? error.message : 'Nie udało się zapisać dziennika w pamięci przeglądarki. Poprzednie wpisy pozostają zachowane; dalszy zapis wyłączono.';
      render(); announceForms();
      throw new Error(message);
    }
    render();
  }

  function render() {
    const summary = summarizeJournal(journal);
    const records = [...journal.records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    root.innerHTML = `<div class="journal-panel"><p class="small">Twój dziennik własnych typów, zapisany wyłącznie w tej przeglądarce. Zapisujesz wynik, sumę punktów lub goli albo dokładny typ zawodnika; kurs i stawkę zatwierdzasz samodzielnie. To nie jest rejestr skuteczności modeli SportLab. Wpisy można zmienić poza aplikacją — lokalny zapis nie potwierdza historycznego momentu obstawienia.</p>
      ${loaded ? `<div class="stat-grid journal-stats journal-grid"><div class="journal-stat"><span>Rozliczone / oczekujące</span><b>${summary.settled ?? 0} / ${summary.pending ?? 0}</b></div><div class="journal-stat"><span>Wynik w umownych jednostkach</span><b>${decimal(summary.profit)}</b></div><div class="journal-stat"><span>ROI rozliczonej stawki</span><b>${percent(summary.roi)}</b></div><div class="journal-stat"><span>Trafność własnych typów</span><b>${percent(summary.hitRate)}</b></div></div><p class="small">Wygrane: ${summary.won ?? 0} • przegrane: ${summary.lost ?? 0} • zwroty: ${summary.void ?? 0} • sprzeczne: ${summary.conflicted ?? 0}. ROI i trafność pomijają wpisy oczekujące i sprzeczne. Wynik nie uwzględnia podatków ani opłat; stawki to jednostki do ewidencji, bez wpłat i automatycznego obstawiania.</p>` : ''}
      <div class="journal-controls"><button type="button" data-journal-refresh ${blocked || refreshing ? 'disabled' : ''}>${refreshing ? 'Sprawdzanie wyników…' : 'Sprawdź wyniki'}</button><button type="button" data-journal-export ${!loaded && recoveryRaw === null ? 'disabled' : ''}>${recoveryRaw !== null ? 'Pobierz oryginalny zapis' : 'Eksportuj JSON'}</button><label>Importuj JSON <input type="file" data-journal-import accept="application/json,.json" ${blocked || refreshing ? 'disabled' : ''}></label></div>
      <p class="small journal-status" role="status">${esc(message)}</p>
      ${records.length ? `<div class="scroll"><table><thead><tr><th>Dodano / mecz</th><th>Twój wybór</th><th>Kurs / stawka</th><th>Status / wynik</th></tr></thead><tbody>${records.map(record => `<tr><td>${esc(date(record.createdAt))}<br><span class="small">${esc(record.home)} — ${esc(record.away)}<br>${esc(date(record.startTime))}</span></td><td>${esc(journalRecordLabel(record))}${record.bookmaker ? `<br><span class="small">Zapisane źródło kursu: ${esc(record.bookmaker)}</span>` : ''}</td><td>${decimal(record.odds)} / ${decimal(record.stake)} j.</td><td>${esc(statuses[record.conflict ? 'conflict' : record.status] || 'Nieznany status')}${record.settlement ? `<br>Wynik meczu: ${record.settlement.homeScore}:${record.settlement.awayScore}${Number.isFinite(record.settlement.value) ? `<br>${record.market === 'player_prop' ? 'Statystyka zawodnika' : 'Suma'}: ${decimal(record.settlement.value)}` : ''}` : ''}<br>${record.conflict || record.status === 'pending' ? '—' : `${decimal(record.status === 'won' ? record.stake * (record.odds - 1) : -record.stake)} j.`}</td></tr>`).join('')}</tbody></table></div>` : loaded ? '<p class="small">Nie masz jeszcze wpisów. Otwórz analizę nadchodzącego meczu, wybierz typ, potwierdź swój kurs i dodaj wpis.</p>' : ''}</div>`;
    root.querySelector('[data-journal-refresh]').onclick = () => { void refresh(); };
    root.querySelector('[data-journal-export]').onclick = () => download(recoveryRaw ?? JSON.stringify(journal, null, 2), recoveryRaw !== null ? 'sportlab-dziennik-do-odzyskania.txt' : 'sportlab-dziennik.json', recoveryRaw !== null ? 'text/plain' : 'application/json');
    root.querySelector('[data-journal-import]').onchange = async event => {
      const file = event.target.files?.[0];
      if (!file || blocked) return;
      try {
        if (file.size > IMPORT_LIMIT) throw new Error('Plik jest za duży. Limit importu: 1 MB.');
        const incoming = validateJournal(JSON.parse(await file.text()));
        const next = mergeJournals(journal, incoming);
        persist(next); message = 'Zaimportowano poprawne wpisy. Identyczne duplikaty pominięto; wpisów nie nadpisujemy.'; render();
      } catch (error) { message = `Import przerwany: ${error.message}`; render(); }
    };
  }

  async function refresh() {
    if (refreshing || blocked) return;
    if (!journal.records.length) { message = 'Brak wpisów do sprawdzenia.'; render(); return; }
    const plan = planJournalRefresh(journal, { now: Date.now(), priorityCursor, olderCursor });
    if (!plan.selectedCount) { message = 'Zapisane mecze jeszcze się nie rozpoczęły. Wpisy oczekują na potwierdzone wyniki.'; render(); return; }
    priorityCursor = plan.priorityCursor; olderCursor = plan.olderCursor;
    refreshing = true; message = `Sprawdzanie ${plan.selectedCount} meczów i dostępnych statystyk zawodników…`; render();
    const rows = [], failures = [], missing = new Set();
    try {
      for (const request of plan.requests) {
          try {
            const data = await fetchJSON(`/api/journal-results?${new URLSearchParams({ sport: request.sport, ids: request.ids.join(','), details: request.details })}`);
            if (!Array.isArray(data.rows)) throw new Error('Nieprawidłowa odpowiedź wyników.');
            rows.push(...data.rows);
            for (const id of data.missing || []) missing.add(id);
            if (data.runtimeData?.fallback) failures.push('Aktualizacja źródła była niedostępna; użyto zapisanej historii wdrożenia.');
          } catch { failures.push('Część wyników jest chwilowo niedostępna. Nierozliczone wpisy pozostają oczekujące.'); }
      }
      const next = settleJournal(journal, rows, { now: Date.now() });
      if (JSON.stringify(next) !== JSON.stringify(journal)) persist(next);
      const waiting = next.records.filter(record => record.status === 'pending' && Date.parse(record.startTime) < Date.now()).length;
      message = `Sprawdzono ${plan.selectedCount} z ${plan.eligibleCount} rozpoczętych meczów.${plan.eligibleCount > plan.selectedCount ? ' Kolejna partia przy następnym sprawdzeniu; starsze wyniki również są sprawdzane pod kątem korekt.' : ''}${missing.size ? ` Brak potwierdzonego wyniku dla ${missing.size} meczów z tej partii.` : ''}${waiting ? ` Na wynik lub porównywalną statystykę nadal oczekuje ${waiting} wpisów.` : ''}${failures.length ? ` ${[...new Set(failures)].join(' ')}` : ''}`;
    } catch (error) { message = `Rozliczenie przerwane: ${error.message}`; }
    finally { refreshing = false; render(); }
  }

  function open(event, host, pick = null, options = {}) {
    if (!host) return;
    for (const form of forms) if (!form.isConnected) forms.delete(form);
    if (!['nba', 'nhl', 'football'].includes(event?.sport) || event.state !== 'pre' || !(Date.parse(event.date) > Date.now())) {
      host.innerHTML = '<p class="small">Własny typ można zapisać przed rozpoczęciem meczu NBA, NHL lub obsługiwanej ligi piłkarskiej. Mecze rozpoczęte i archiwalne nie przyjmują wpisów przedmeczowych.</p>';
      return;
    }
    let selected = null;
    try { if (pick) selected = journalSelectionForPick(event, pick); }
    catch (error) { host.innerHTML = `<p class="small" role="status">Nie można przygotować wpisu: ${esc(error.message)}</p>`; return; }
    const selectionNames = { winner: 'Zwycięzca', result_90: 'Wynik po 90 minutach', double_chance_90: 'Podwójna szansa', total_points: 'Suma punktów', total_goals: 'Suma goli', player_prop: 'Statystyka zawodnika' };
    const selectionLabel = selected ? journalRecordLabel({ ...event, ...selected }) : '';
    const choices = selected ? [{ key: selected.market, name: selectionNames[selected.market], outcomes: [[selected.outcome, selectionLabel]] }] : marketOptions(event);
    const observed = selected ? matchingObservedQuote(options.quote, event, selected, Date.now()) : null;
    host.innerHTML = `<section class="panel journal-form-panel"><h3>${selected ? 'Zapisz wybrany typ' : 'Twój kurs i własny typ'}</h3>${selected ? `<p data-journal-selection><b>${esc(selectionLabel)}</b></p>` : ''}<p class="small">Potwierdź swój kurs dziesiętny i stawkę. Zapis dotyczy Twojej decyzji, bez rekomendacji modelu. Kurs i czas jego podania nie są niezależnie potwierdzone. Wpisy pozostają na urządzeniu; sprawdzenie wyników przesyła tylko publiczne identyfikatory meczów.</p>${observed ? `<p class="small" data-journal-observed-price>Podstawiono odczyt ${esc(observed.provider || 'źródła')} z ${esc(date(observed.observedAt))}${observed.sourceRecordUpdatedAt ? `; rekord źródła z ${esc(date(observed.sourceRecordUpdatedAt))}` : ''}. To nie potwierdza aktualnej oferty. Zapisz kurs, z którym podejmujesz własną decyzję.</p>` : ''}<form class="journal-form journal-grid"><label>Rynek<select name="market" ${selected ? 'disabled' : ''}>${choices.map(choice => `<option value="${choice.key}">${esc(choice.name)}</option>`).join('')}</select></label><label>Twój wybór<select name="outcome" ${selected ? 'disabled' : ''}></select></label><label data-journal-line hidden>Linia<input name="line" type="text" inputmode="decimal" pattern="[0-9]+([,.][0-9]+)?" placeholder="${event.sport === 'nba' ? 'np. 224,5' : 'np. 2,5'}" ${selected?.line != null ? `value="${decimal(selected.line)}" readonly` : ''} title="Dodatnia linia połówkowa, np. 2,5"></label><label>Kurs dziesiętny<input name="odds" type="text" inputmode="decimal" pattern="[0-9]+([,.][0-9]+)?" required ${observed ? `value="${observed.decimal.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })}"` : ''} placeholder="np. 1,85" title="Kurs od 1,01 do 1000; przecinek lub kropka"></label><label>Stawka w jednostkach<input name="stake" type="text" inputmode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" value="1" required title="Od 0,01 do 100 jednostek, maksymalnie 2 miejsca po przecinku"></label><label>Źródło kursu (opcjonalnie)<input name="bookmaker" type="text" maxlength="80" autocomplete="off" ${observed?.provider ? `value="${esc(observed.provider.slice(0, 80))}"` : ''} placeholder="Nazwa źródła"></label><div class="journal-price" role="status"></div><button type="submit" data-journal-save ${blocked ? 'disabled' : ''}>Dodaj własny typ do dziennika</button><p class="small journal-form-status" role="status">${blocked ? esc(message) : 'Nie zawieramy zakładów ani nie przesyłamy stawek do bukmachera.'}</p></form></section>`;
    const form = host.querySelector('form'); forms.add(form);
    const field = name => form.elements.namedItem(name);
    const price = form.querySelector('.journal-price'), status = form.querySelector('.journal-form-status');
    let forecast = null, generation = 0;
    function renderPrice() {
      if (!form.isConnected) return;
      try {
        const evaluation = evaluatePrice(inputNumber(field('odds').value), forecast, { event, market: field('market').value, outcome: field('outcome').value, now: Date.now() });
        price.innerHTML = `<p>Próg rentowności z kursu: <b>${percent(evaluation.breakEven)}</b>.</p><p class="small">To próg wynikający z ceny zakładu, nie prognoza szans wygranej.</p>${evaluation.status === 'available' ? `<p>Zweryfikowana prognoza: ${percent(evaluation.modelProbability)} • wartość oczekiwana na jednostkę: ${decimal(evaluation.expectedValue)}.</p>` : `<p class="small">${esc(evaluation.reason || 'Brak zweryfikowanej prognozy — nie wyliczamy przewagi ani wartości oczekiwanej.')}</p>`}`;
      } catch { price.innerHTML = '<p class="small">Wpisz poprawny kurs dziesiętny od 1,01 do 1000, aby zobaczyć próg rentowności.</p>'; }
    }
    async function loadForecast() {
      const request = ++generation;
      forecast = null; renderPrice();
      if (selected?.market === 'player_prop' || totalMarket(selected?.market) || event.route === 'soccer/pol.1') return;
      const params = new URLSearchParams({ sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId, id: event.id, startTime: new Date(event.date).toISOString() });
      try {
        const data = await fetchJSON(`/api/forecast?${params}`);
        if (request !== generation || !form.isConnected) return;
        forecast = data; renderPrice();
      } catch { if (request === generation && form.isConnected) { forecast = { status: 'withheld', reason: 'Prognoza jest chwilowo niedostępna; można zapisać wyłącznie własny wybór.' }; renderPrice(); } }
    }
    function updateOutcomes() {
      const choice = choices.find(item => item.key === field('market').value);
      field('outcome').innerHTML = choice.outcomes.map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('');
      const needsLine = totalMarket(choice.key) || choice.key === 'player_prop';
      form.querySelector('[data-journal-line]').hidden = !needsLine;
      field('line').disabled = !needsLine; field('line').required = needsLine;
      renderPrice();
    }
    field('market').onchange = updateOutcomes;
    field('outcome').onchange = renderPrice;
    field('odds').oninput = renderPrice;
    form.onsubmit = submit => {
      submit.preventDefault();
      if (!form.reportValidity() || blocked) return;
      try {
        const now = Date.now();
        const odds = inputNumber(field('odds').value), stake = inputNumber(field('stake').value);
        if (!(odds >= 1.01 && odds <= 1000)) throw new Error('Kurs musi wynosić od 1,01 do 1000.');
        if (!(stake >= 0.01 && stake <= 100)) throw new Error('Stawka musi wynosić od 0,01 do 100 jednostek.');
        const market = field('market').value;
        const selection = selected || { market, outcome: field('outcome').value,
          ...(totalMarket(market) ? { line: inputNumber(field('line').value), scope: market === 'total_goals' ? 'regulation_90' : 'including_overtime' } : {}) };
        const record = createRecord(event, { ...selection, odds, stake, quotedAt: new Date(now).toISOString(), bookmaker: field('bookmaker').value.trim() }, { now });
        persist(appendRecord(journal, record));
        status.textContent = 'Zapisano Twój wybór w lokalnym dzienniku. Rozliczenie wymaga potwierdzonego wyniku lub dokładnej statystyki zawodnika. Brak danych pozostawia wpis oczekujący.';
        field('odds').value = ''; renderPrice();
      } catch (error) { status.textContent = `Nie zapisano wpisu: ${error.message}`; }
    };
    updateOutcomes();
    void loadForecast();
  }

  render();
  return { open: (event, host) => open(event, host), openPick: (event, host, pick, options = {}) => open(event, host, pick, options), refresh };
}
