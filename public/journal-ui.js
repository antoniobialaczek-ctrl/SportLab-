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
  ];
  return [{ key: 'winner', name: event.sport === 'nhl' ? 'Zwycięzca z dogrywką i karnymi' : 'Zwycięzca z dogrywką', outcomes: [['home', event.home], ['away', event.away]] }];
}

function recordLabel(record) {
  const names = { home: record.home, away: record.away, draw: 'Remis', home_draw: `${record.home} lub remis (1X)`, draw_away: `Remis lub ${record.away} (X2)` };
  return `${names[record.outcome] || record.outcome} • ${record.market === 'winner' ? record.sport === 'nhl' ? 'z dogrywką i karnymi' : 'z dogrywką' : '90 minut'}`;
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
    root.innerHTML = `<div class="journal-panel"><p class="small">Twój dziennik własnych typów, zapisany wyłącznie w tej przeglądarce. Kursy i wybory podajesz ręcznie. To nie jest rejestr rekomendacji ani skuteczności modeli SportLab. Wpisy można zmienić poza aplikacją — lokalny zapis nie potwierdza historycznego momentu obstawienia.</p>
      ${loaded ? `<div class="stat-grid journal-stats journal-grid"><div class="journal-stat"><span>Rozliczone / oczekujące</span><b>${summary.settled ?? 0} / ${summary.pending ?? 0}</b></div><div class="journal-stat"><span>Wynik w umownych jednostkach</span><b>${decimal(summary.profit)}</b></div><div class="journal-stat"><span>ROI rozliczonej stawki</span><b>${percent(summary.roi)}</b></div><div class="journal-stat"><span>Trafność własnych typów</span><b>${percent(summary.hitRate)}</b></div></div><p class="small">Wygrane: ${summary.won ?? 0} • przegrane: ${summary.lost ?? 0} • zwroty: ${summary.void ?? 0} • sprzeczne: ${summary.conflicted ?? 0}. ROI i trafność pomijają wpisy oczekujące i sprzeczne. Wynik nie uwzględnia podatków ani opłat; stawki to jednostki do ewidencji, bez wpłat i automatycznego obstawiania.</p>` : ''}
      <div class="journal-controls"><button type="button" data-journal-refresh ${blocked || refreshing ? 'disabled' : ''}>${refreshing ? 'Sprawdzanie wyników…' : 'Sprawdź wyniki'}</button><button type="button" data-journal-export ${!loaded && recoveryRaw === null ? 'disabled' : ''}>${recoveryRaw !== null ? 'Pobierz oryginalny zapis' : 'Eksportuj JSON'}</button><label>Importuj JSON <input type="file" data-journal-import accept="application/json,.json" ${blocked || refreshing ? 'disabled' : ''}></label></div>
      <p class="small journal-status" role="status">${esc(message)}</p>
      ${records.length ? `<div class="scroll"><table><thead><tr><th>Dodano / mecz</th><th>Twój wybór</th><th>Kurs / stawka</th><th>Status / wynik</th></tr></thead><tbody>${records.map(record => `<tr><td>${esc(date(record.createdAt))}<br><span class="small">${esc(record.home)} — ${esc(record.away)}<br>${esc(date(record.startTime))}</span></td><td>${esc(recordLabel(record))}${record.bookmaker ? `<br><span class="small">Źródło podane ręcznie: ${esc(record.bookmaker)}</span>` : ''}</td><td>${decimal(record.odds)} / ${decimal(record.stake)} j.</td><td>${esc(statuses[record.conflict ? 'conflict' : record.status] || 'Nieznany status')}${record.settlement ? `<br>Wynik: ${record.settlement.homeScore}:${record.settlement.awayScore}` : ''}<br>${record.conflict || record.status === 'pending' ? '—' : `${decimal(record.status === 'won' ? record.stake * (record.odds - 1) : -record.stake)} j.`}</td></tr>`).join('')}</tbody></table></div>` : loaded ? '<p class="small">Nie masz jeszcze wpisów. Otwórz analizę nadchodzącego meczu, wpisz swój kurs i dodaj własny typ.</p>' : ''}</div>`;
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
    const recorded = journal.records;
    if (!recorded.length) { message = 'Brak wpisów do sprawdzenia.'; render(); return; }
    refreshing = true; message = 'Pobieranie potwierdzonych wyników z historii SportLab…'; render();
    const rows = [], failures = [], missing = new Set();
    try {
      for (const sport of [...new Set(recorded.map(record => record.sport))]) {
        const ids = [...new Set(recorded.filter(record => record.sport === sport).map(record => record.fixtureId))];
        for (let offset = 0; offset < ids.length; offset += 50) {
          const batch = ids.slice(offset, offset + 50);
          try {
            const data = await fetchJSON(`/api/journal-results?${new URLSearchParams({ sport, ids: batch.join(',') })}`);
            if (!Array.isArray(data.rows)) throw new Error('Nieprawidłowa odpowiedź wyników.');
            rows.push(...data.rows);
            for (const id of data.missing || []) missing.add(id);
            if (data.runtimeData?.fallback) failures.push('Aktualizacja źródła była niedostępna; użyto zapisanej historii wdrożenia.');
          } catch { failures.push('Część wyników jest chwilowo niedostępna. Nierozliczone wpisy pozostają oczekujące.'); }
        }
      }
      const next = settleJournal(journal, rows, { now: Date.now() });
      if (JSON.stringify(next) !== JSON.stringify(journal)) persist(next);
      message = `Sprawdzono wyniki.${missing.size ? ` Brak potwierdzonego wyniku dla ${missing.size} meczów.` : ''}${failures.length ? ` ${[...new Set(failures)].join(' ')}` : ''}`;
    } catch (error) { message = `Rozliczenie przerwane: ${error.message}`; }
    finally { refreshing = false; render(); }
  }

  function open(event, host) {
    if (!host) return;
    for (const form of forms) if (!form.isConnected) forms.delete(form);
    if (!['nba', 'nhl', 'football'].includes(event?.sport) || event.state !== 'pre' || !(Date.parse(event.date) > Date.now())) {
      host.innerHTML = '<p class="small">Własny typ można zapisać przed rozpoczęciem meczu NBA, NHL lub obsługiwanej ligi piłkarskiej. Mecze rozpoczęte i archiwalne nie przyjmują wpisów przedmeczowych.</p>';
      return;
    }
    const choices = marketOptions(event);
    host.innerHTML = `<section class="panel journal-form-panel"><h3>Twój kurs i własny typ</h3><p class="small">Wpisz kurs dziesiętny z wybranego źródła. Zapis dotyczy Twojej decyzji, bez rekomendacji modelu. Kurs i czas jego podania nie są niezależnie potwierdzone. Wpisy pozostają na urządzeniu; sprawdzenie wyników przesyła tylko publiczne identyfikatory meczów.</p><form class="journal-form journal-grid"><label>Rynek<select name="market">${choices.map(choice => `<option value="${choice.key}">${esc(choice.name)}</option>`).join('')}</select></label><label>Twój wybór<select name="outcome"></select></label><label>Kurs dziesiętny<input name="odds" type="text" inputmode="decimal" pattern="[0-9]+([,.][0-9]+)?" required placeholder="np. 1,85" title="Kurs od 1,01 do 1000; przecinek lub kropka"></label><label>Stawka w jednostkach<input name="stake" type="text" inputmode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" value="1" required title="Od 0,01 do 100 jednostek, maksymalnie 2 miejsca po przecinku"></label><label>Źródło kursu (opcjonalnie)<input name="bookmaker" type="text" maxlength="80" autocomplete="off" placeholder="Nazwa źródła"></label><div class="journal-price" role="status"></div><button type="submit" data-journal-save ${blocked ? 'disabled' : ''}>Dodaj własny typ do dziennika</button><p class="small journal-form-status" role="status">${blocked ? esc(message) : 'Nie zawieramy zakładów ani nie przesyłamy stawek do bukmachera.'}</p></form></section>`;
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
        const record = createRecord(event, { market: field('market').value, outcome: field('outcome').value, odds, stake, quotedAt: new Date(now).toISOString(), bookmaker: field('bookmaker').value.trim() }, { now });
        persist(appendRecord(journal, record));
        status.textContent = 'Zapisano Twój wybór w lokalnym dzienniku. Wynik będzie rozliczony dopiero po potwierdzeniu w historii SportLab.';
        field('odds').value = ''; renderPrice();
      } catch (error) { status.textContent = `Nie zapisano wpisu: ${error.message}`; }
    };
    updateOutcomes();
    void loadForecast();
  }

  render();
  return { open, refresh };
}
