import { ROUTES, leagueLabel } from './catalog.js';

const STAGES = ['calibration', 'selection', 'test'];
const TARGETS = { calibration: 60, selection: 45, test: 150 };
const MINIMUMS = { calibration: 40, selection: 30, test: 100 };
const PHASES = {
  calibration: 'Kalibracja', selection: 'Wybór kalibracji', test: 'Niezależny test',
  'completed-awaiting-review': 'Test zamknięty — przegląd dowodów', failed: 'Kryteria niespełnione',
  'blocked-data': 'Braki danych', invalidated: 'Zmiana dowodów — przegląd',
};
const integer = value => Number.isSafeInteger(value) && value >= 0;
const validTime = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;

function sourceHealth(report, now) {
  const generatedAt = report?.generatedAt || null;
  const source = report?.runtimeData;
  const status = !report ? 'missing' : !validTime(generatedAt, now) ? 'invalid'
    : now - Date.parse(generatedAt) > 12 * 3600000 ? 'stale' : 'fresh';
  return { generatedAt, status, ageMinutes: validTime(generatedAt, now) ? Math.floor((now - Date.parse(generatedAt)) / 60000) : null,
    origin: source?.origin === 'github' ? 'github' : 'local', fallback: source?.fallback === true };
}

function stagesFor(row, registeredAt, generatedAt) {
  const stages = {};
  for (const stage of STAGES) {
    const value = row?.stages?.[stage];
    if (!value || value.target !== TARGETS[stage] || value.minimumValid !== MINIMUMS[stage]
      || !['recorded', 'settled', 'pending', 'void'].every(key => integer(value[key]))
      || value.recorded > value.target || value.settled + value.pending + value.void !== value.recorded
      || (value.frozenAt != null && (!validTime(value.frozenAt, generatedAt) || Date.parse(value.frozenAt) < registeredAt))) return null;
    stages[stage] = { target: value.target, minimumValid: value.minimumValid, recorded: value.recorded,
      settled: value.settled, pending: value.pending, void: value.void, frozenAt: value.frozenAt || null };
  }
  // A later phase must not appear before its predecessor has actually closed.
  const phaseIndex = ['calibration', 'selection', 'test', 'completed-awaiting-review', 'failed'].indexOf(row.phase);
  for (let index = 0; index < Math.min(phaseIndex, STAGES.length); index++) {
    const value = stages[STAGES[index]];
    if (!value.frozenAt || value.recorded !== value.target || value.pending !== 0) return null;
    if (index && Date.parse(value.frozenAt) < Date.parse(stages[STAGES[index - 1]].frozenAt)) return null;
  }
  return stages;
}

function nextStep(phase) {
  if (phase === 'completed-awaiting-review') return 'Sprawdzić dowody, zakres zastosowania i wyniki zamkniętego testu. Sam licznik nie odblokowuje prognoz.';
  if (phase === 'failed') return 'Zachować wynik tego eksperymentu. Nowy model wymaga osobnej wersji i nowej próby.';
  if (['blocked-data', 'invalidated'].includes(phase)) return 'Sprawdzić braki lub zmianę dowodów. Dotychczasowa próba pozostaje zachowana.';
  return 'Dalej automatycznie: zapisywać przedmeczowe obserwacje i rozliczać wyniki kolejnych spotkań. Następny etap po zamknięciu bieżącej próby.';
}

/** Read-only health summary. Public aggregate counts do not certify a forecast
 * or prove that a scheduler is currently running. Test metrics are omitted.
 */
export function buildReadiness(report, forward, { now = Date.now() } = {}) {
  if (!Number.isFinite(now)) throw new Error('Nieprawidłowy czas kontroli');
  const sources = { history: sourceHealth(report, now), forward: sourceHealth(forward, now) };
  const protocol = forward?.validation;
  const registeredAt = Date.parse(protocol?.registeredAt);
  const forwardAt = Date.parse(forward?.generatedAt);
  const headerValid = protocol && validTime(protocol.registeredAt, now) && Number.isFinite(forwardAt)
    && forwardAt <= now && registeredAt <= forwardAt && /^[a-f0-9]{64}$/.test(protocol.policyHash || '')
    && Array.isArray(protocol.leagues) && protocol.leagues.length > 0;
  const rows = new Map();
  let malformed = false;
  if (headerValid) for (const row of protocol.leagues) {
    const sport = Object.keys(ROUTES).find(name => ROUTES[name].includes(row?.route));
    const stages = sport && stagesFor(row, registeredAt, forwardAt);
    if (!sport || rows.has(row.route) || row.league !== row.route.split('/').at(-1) || !Object.hasOwn(PHASES, row.phase) || !stages) {
      malformed = true; continue;
    }
    rows.set(row.route, { route: row.route, league: row.league, label: leagueLabel(row.route), phase: row.phase,
      phaseLabel: PHASES[row.phase], stages, nextStep: nextStep(row.phase), reason: typeof row.reason === 'string' ? row.reason : null });
  }
  const protocolStatus = !protocol ? 'missing' : !headerValid || malformed ? 'invalid' : 'reported';
  const common = [];
  if (sources.history.status !== 'fresh') common.push('Raport historyczny jest niedostępny, nieaktualny lub ma nieprawidłową datę.');
  if (sources.forward.status !== 'fresh') common.push('Raport obserwacji przedmeczowych jest niedostępny, nieaktualny lub ma nieprawidłową datę.');
  if (sources.history.fallback || sources.forward.fallback) common.push('Aktualizacja zdalna jest niedostępna; pokazano dane dołączone do wdrożenia.');
  if (protocolStatus !== 'reported') common.push('Brak spójnego publicznego raportu zarejestrowanego protokołu walidacji.');
  const sports = Object.fromEntries(Object.keys(ROUTES).map(sport => {
    const sportBlockers = [...common];
    if (!report?.sports?.[sport]) sportBlockers.push('Brak raportu historycznego dla tej dyscypliny.');
    const leagues = ROUTES[sport].map(route => {
      const row = protocolStatus === 'reported' ? rows.get(route) : null;
      const blockers = [...sportBlockers];
      if (!row) blockers.push('Ta liga nie ma dostępnej, spójnej próby w niezależnym protokole.');
      if (row && ['blocked-data', 'invalidated', 'failed'].includes(row.phase)) blockers.push(row.reason || row.phaseLabel);
      if (row?.phase === 'completed-awaiting-review') blockers.push('Zamknięcie testu wymaga przeglądu dowodów przed publikacją prognoz.');
      return { route, league: route.split('/').at(-1), label: leagueLabel(route), phase: row?.phase || 'unavailable',
        phaseLabel: row?.phaseLabel || 'Brak próby', stages: row?.stages || null, nextStep: row?.nextStep || 'Zachować dotychczasowe dane. Najpierw wyjaśnić brak raportu tej ligi.',
        status: !row ? 'unavailable' : blockers.length ? 'attention' : ['calibration', 'selection', 'test'].includes(row.phase) ? 'collecting' : 'attention', blockers };
    });
    const blockers = [...sportBlockers, ...(leagues.length ? [] : ['Brak wiarygodnego źródła i zarejestrowanej próby dla tej dyscypliny.'])];
    const status = !leagues.some(row => row.status !== 'unavailable') ? 'unavailable'
      : blockers.length || leagues.some(row => row.status !== 'collecting') ? 'attention' : 'collecting';
    return [sport, { sport, status, blockers, leagues }];
  }));
  const needsReview = [...rows.values()].some(row => !['calibration', 'selection', 'test'].includes(row.phase));
  return { version: '3.1', asOf: new Date(now).toISOString(), status: protocolStatus !== 'reported' ? 'unavailable' : common.length || needsReview ? 'attention' : 'collecting',
    publication: { eligible: false }, sources, protocol: { registeredAt: headerValid ? protocol.registeredAt : null,
      policyHash: headerValid ? protocol.policyHash : null, status: protocolStatus,
      note: 'Identyfikator pochodzi z publicznego raportu. Ten panel nie zastępuje odtworzenia prywatnych dowodów i nie zeruje eksperymentu.' },
    sports, note: 'Zakończenie walidacji wymaga nowych, rzeczywiście rozegranych spotkań. Nie podajemy daty zakończenia. Świeży raport nie potwierdza, że harmonogram działa w tej chwili.' };
}
