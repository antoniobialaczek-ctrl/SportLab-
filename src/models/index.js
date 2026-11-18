import { createHash } from 'node:crypto';
import { validateEvent } from '../data/schema.js';
import { isAllowedRoute } from '../data/catalog.js';
import { nbaDefinition } from './nba.js';
import { footballDefinition } from './football.js';
import { nhlDefinition } from './nhl.js';
import { tennisDefinition } from './tennis.js';
import { outcome } from './utils.js';
import { applyTemperature, fitTemperature, scorePredictions } from './metrics.js';
import { MODEL_CODE_FINGERPRINT } from './fingerprint.js';

export { MODEL_CODE_FINGERPRINT } from './fingerprint.js';

export const MODEL_VERSION = '3.2.0';
const DEFINITIONS = { nba: nbaDefinition, football: footballDefinition, nhl: nhlDefinition, tennis: tennisDefinition };
const DAY = 86_400_000;
const LIMITS = Object.freeze({ total: 400, train: 100, calibration: 40, selection: 30, test: 100, maxAgeDays: 45 });
const METHOD = 'Podział chronologiczny 50/20/10/20% według terminów. Wyniki uczą model dopiero po resultAvailableAt < termin prognozy. Temperatura dopasowana na kalibracji, wybrana na osobnym oknie, oceniona na końcowym teście. Parametry i kalibracja są zamrożone w teście; stan drużyn uczy się kolejnych znanych wyników (walk-forward).';
const sortEvents = events => [...events].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id));

function validEvents(sport, events) {
  if (!Array.isArray(events)) throw new Error('Historia musi być tablicą meczów');
  const seen = new Set();
  for (const event of events) {
    validateEvent(event);
    if (event.sport !== sport) throw new Error('Historia zawiera inną dyscyplinę');
    if (seen.has(event.id)) throw new Error(`Powielony mecz ${event.id}`);
    seen.add(event.id);
  }
  return sortEvents(events);
}

function fingerprint(events) {
  const fields = sortEvents(events).map(e => [e.id, e.startTime, e.resultAvailableAt, e.availabilityBasis, e.homeId, e.awayId, e.homeScore, e.awayScore, e.neutralSite, e.source]);
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function provenance(events) {
  return {
    sources: [...new Set(events.map(e => e.source.provider))],
    firstEventAt: events[0]?.startTime ?? null,
    lastEventAt: events.at(-1)?.startTime ?? null,
    availabilityBases: [...new Set(events.map(e => e.availabilityBasis))],
    // Retrospectively downloaded scores with a 24h delay are research data.
    // A timestamp alone does not prove which version was visible at that time.
    pointInTimeVerified: events.length > 0 && events.every(e => e.availabilityBasis === 'historical-snapshot' && /^[a-f0-9]{64}$/.test(e.source.snapshotSha256 ?? '') && Date.parse(e.source.fetchedAt) <= Date.parse(e.resultAvailableAt)),
    limitation: 'ESPN jest źródłem nieoficjalnym. Retrospektywne wyniki mogą zawierać późniejsze korekty. Bufor 24h nie jest dowodem dostępności informacji w przeszłości.'
  };
}

/** Internal research rows. Never returned by a public forecast API.
 * Separate state per route prevents crossing leagues, ATP/WTA or sports.
 * Processing results by availability (not start order) prevents overlapping
 * games and simultaneous fixtures from leaking each other's outcomes.
 */
export function walkForwardRows(sport, input) {
  const definition = DEFINITIONS[sport];
  if (!definition) return [];
  const events = validEvents(sport, input);
  const groups = Map.groupBy(events, event => event.route);
  const rows = [];
  for (const [, fixtures] of groups) {
    const state = definition.create();
    const pending = [...fixtures].sort((a, b) => Date.parse(a.resultAvailableAt) - Date.parse(b.resultAvailableAt) || a.id.localeCompare(b.id));
    const counts = definition.outcomes.map(() => 1);
    let next = 0;
    for (const event of fixtures) {
      const predictionAt = Date.parse(event.startTime);
      while (next < pending.length && Date.parse(pending[next].resultAvailableAt) < predictionAt) {
        state.update(pending[next]);
        counts[outcome(pending[next])]++;
        next++;
      }
      const sum = counts.reduce((a, b) => a + b, 0);
      rows.push({ id: event.id, route: event.route, league: event.league, startTime: event.startTime, resultAvailableAt: event.resultAvailableAt, outcome: outcome(event), probabilities: state.predict(event), baseline: counts.map(c => c / sum) });
    }
  }
  return rows.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id));
}

function emptyReport(sport, reason, generatedAt) {
  return { sport, modelVersion: MODEL_VERSION, modelName: DEFINITIONS[sport]?.name ?? 'Model niedostępny', generatedAt, status: 'unavailable', reason, method: METHOD, outcomes: DEFINITIONS[sport]?.outcomes ?? [], samples: { total: 0, train: 0, calibration: 0, selection: 0, test: 0 }, metrics: null, rawMetrics: null, baselineMetrics: null, calibration: null, publication: { eligible: false, reasons: [reason] }, provenance: provenance([]), leagues: [] };
}

function partitionRows(rows) {
  // All fixtures at the same timestamp stay in the same partition.
  const times = [...new Set(rows.map(r => r.startTime))].sort((a, b) => Date.parse(a) - Date.parse(b));
  const at = fraction => Date.parse(times[Math.floor(times.length * fraction)] ?? times.at(-1));
  const calibrationAt = at(0.5), selectionAt = at(0.7), testAt = at(0.8);
  const train = rows.filter(r => Date.parse(r.startTime) < calibrationAt);
  const calibration = rows.filter(r => Date.parse(r.startTime) >= calibrationAt && Date.parse(r.startTime) < selectionAt && Date.parse(r.resultAvailableAt) < selectionAt);
  const selection = rows.filter(r => Date.parse(r.startTime) >= selectionAt && Date.parse(r.startTime) < testAt && Date.parse(r.resultAvailableAt) < testAt);
  const test = rows.filter(r => Date.parse(r.startTime) >= testAt);
  return { train, calibration, selection, test, boundaries: { calibrationAt: new Date(calibrationAt).toISOString(), selectionAt: new Date(selectionAt).toISOString(), testAt: new Date(testAt).toISOString() } };
}

function calibrated(rows, temperature) {
  return rows.map(row => ({ ...row, probabilities: applyTemperature(row.probabilities, temperature) }));
}

function evaluateLeague(sport, events, now) {
  const rows = walkForwardRows(sport, events);
  const partitions = partitionRows(rows);
  const enoughCalibration = partitions.calibration.length >= LIMITS.calibration && partitions.selection.length >= LIMITS.selection;
  const candidate = enoughCalibration ? fitTemperature(partitions.calibration) : 1;
  const selectionRaw = scorePredictions(partitions.selection);
  const selectionCalibrated = scorePredictions(calibrated(partitions.selection, candidate));
  // The final test never chooses the calibrator or any hyperparameter.
  const selected = enoughCalibration && candidate !== 1 && selectionCalibrated.brier < selectionRaw.brier && selectionCalibrated.logLoss <= selectionRaw.logLoss;
  const temperature = selected ? candidate : 1;
  const testRows = calibrated(partitions.test, temperature);
  const metrics = scorePredictions(testRows), rawMetrics = scorePredictions(partitions.test);
  const baselineRows = partitions.test.map(row => ({ ...row, probabilities: row.baseline }));
  const baselineMetrics = scorePredictions(baselineRows);
  const samples = { total: events.length, train: partitions.train.length, calibration: partitions.calibration.length, selection: partitions.selection.length, test: partitions.test.length };
  const prov = provenance(events);
  const reasons = [];
  for (const field of ['total', 'train', 'calibration', 'selection', 'test']) if (samples[field] < LIMITS[field]) reasons.push(`Za mała próba ${field}: ${samples[field]}/${LIMITS[field]}.`);
  if (!prov.pointInTimeVerified) reasons.push('Brak archiwalnych migawek potwierdzających dostępność danych w czasie prognozy.');
  if (now - Date.parse(prov.lastEventAt) > LIMITS.maxAgeDays * DAY) reasons.push('Historia nie obejmuje ostatnich 45 dni.');
  if (metrics.brier === null || metrics.brier >= baselineMetrics.brier || metrics.logLoss >= baselineMetrics.logLoss) reasons.push('Końcowy test nie potwierdza przewagi nad bazowym rozkładem wyników.');
  if (events.some(e => e.sport === 'tennis')) reasons.push('Brak zweryfikowanych danych o nawierzchni i formacie spotkania; model tenisowy pozostaje badawczy.');
  const report = {
    sport, league: events[0].league, route: events[0].route, modelVersion: MODEL_VERSION, modelName: DEFINITIONS[sport].name,
    generatedAt: new Date(now).toISOString(), status: reasons.length ? 'research' : 'validated', reason: reasons[0] ?? 'Walidacja chronologiczna zakończona.',
    outcomes: DEFINITIONS[sport].outcomes, method: METHOD, samples, boundaries: partitions.boundaries, metrics, rawMetrics, baselineMetrics,
    calibration: { method: 'temperature', temperature, candidateTemperature: candidate, selected, selectionRawBrier: selectionRaw.brier, selectionCalibratedBrier: selectionCalibrated.brier, reason: selected ? 'Wybrana na wcześniejszym oknie walidacyjnym.' : enoughCalibration ? 'Brak poprawy na wcześniejszym oknie; użyto modelu surowego.' : 'Za mało danych do niezależnego dopasowania i wyboru kalibracji.' },
    publication: { eligible: reasons.length === 0, reasons }, provenance: prov,
    dataFingerprint: fingerprint(events)
  };
  return { report, testRows, rawRows: partitions.test, baselineRows };
}

export function evaluateSport(sport, input, options = {}) {
  const now = Date.parse(options.now ?? new Date().toISOString());
  if (!Number.isFinite(now)) return emptyReport(sport, 'Nieprawidłowa data oceny.', null);
  const generatedAt = new Date(now).toISOString();
  if (sport === 'cs2') return emptyReport(sport, 'CS2: brak zweryfikowanego darmowego źródła historii map, składów i wyników.', generatedAt);
  if (!DEFINITIONS[sport]) return emptyReport(sport, 'Nieobsługiwana dyscyplina.', generatedAt);
  let events;
  try { events = validEvents(sport, input).filter(e => Date.parse(e.resultAvailableAt) <= now); }
  catch (error) { return emptyReport(sport, `Odrzucono historię: ${error.message}`, generatedAt); }
  if (!events.length) return emptyReport(sport, 'Brak zweryfikowanych zakończonych meczów w historii.', generatedAt);
  const evaluated = [...Map.groupBy(events, event => event.route).values()].map(group => evaluateLeague(sport, group, now));
  const leagues = evaluated.map(item => item.report);
  const publicationReasons = leagues.flatMap(report => report.publication.reasons.map(reason => `${report.league}: ${reason}`));
  const samples = Object.fromEntries(['total', 'train', 'calibration', 'selection', 'test'].map(field => [field, leagues.reduce((sum, report) => sum + report.samples[field], 0)]));
  const merged = field => scorePredictions(evaluated.flatMap(item => item[field]));
  return {
    sport, modelVersion: MODEL_VERSION, modelName: DEFINITIONS[sport].name, generatedAt,
    status: leagues.every(report => report.publication.eligible) ? 'validated' : 'research',
    reason: publicationReasons[0] ?? 'Walidacja chronologiczna zakończona.', method: METHOD,
    outcomes: DEFINITIONS[sport].outcomes, samples, metrics: merged('testRows'), rawMetrics: merged('rawRows'), baselineMetrics: merged('baselineRows'),
    calibration: { method: 'temperature-per-league', selected: leagues.some(report => report.calibration.selected), temperature: leagues.length === 1 ? leagues[0].calibration.temperature : null },
    publication: { eligible: leagues.every(report => report.publication.eligible), reasons: publicationReasons },
    provenance: provenance(events), dataFingerprint: fingerprint(events), leagues
  };
}

/** Public forecast boundary. Research probabilities never leave this function.
 * Invalid, stale or mismatched reports cannot unlock a forecast.
 */
export function predictFixture(fixture, input, report, options = {}) {
  const withheld = reason => ({ status: 'withheld', probabilities: null, reason });
  const now = Date.parse(options.now ?? new Date().toISOString());
  const startTime = Date.parse(fixture?.startTime ?? fixture?.date);
  if (!Number.isFinite(now) || !Number.isFinite(startTime) || startTime <= now) return withheld('Prognozy dotyczą wyłącznie przyszłych spotkań.');
  const sport = fixture?.sport;
  if (!DEFINITIONS[sport] || !isAllowedRoute(sport, fixture?.route)) return withheld('Brak modelu dla wybranej dyscypliny lub ligi.');
  if (!fixture.homeId || !fixture.awayId || fixture.homeId === fixture.awayId || typeof fixture.neutralSite !== 'boolean') return withheld('Brak zweryfikowanych uczestników lub miejsca spotkania.');
  if (report?.sport !== sport || report?.modelVersion !== MODEL_VERSION || report?.status !== 'validated' || !report?.publication?.eligible || !report?.provenance?.pointInTimeVerified) return withheld('Model nie ma potwierdzonej walidacji do publikacji prognoz.');
  const reportAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(reportAt) || reportAt > now || now - reportAt > 7 * DAY) return withheld('Raport walidacji jest nieaktualny.');
  let history;
  try { history = validEvents(sport, input).filter(event => Date.parse(event.resultAvailableAt) <= reportAt); }
  catch { return withheld('Historia zawiera nieprawidłowe dane.'); }
  if (fingerprint(history) !== report.dataFingerprint) return withheld('Historia nie odpowiada raportowi walidacji.');
  // A hash binds records to a report but cannot authenticate flags or fitted
  // parameters. Recompute all publication checks from the bound records; a
  // caller cannot unlock retrospective probabilities by editing report flags.
  const verifiedReport = evaluateSport(sport, history, { now: report.generatedAt });
  if (!verifiedReport.publication.eligible || !verifiedReport.provenance.pointInTimeVerified) return withheld('Historia nie potwierdza uprawnienia raportu do publikacji prognoz.');
  const leagueReport = verifiedReport.leagues.find(item => item.route === fixture.route);
  if (!leagueReport?.publication?.eligible || !leagueReport?.provenance?.pointInTimeVerified) return withheld('Liga nie ma niezależnej walidacji.');
  if (now - Date.parse(leagueReport.provenance.lastEventAt) > LIMITS.maxAgeDays * DAY) return withheld('Historia tej ligi jest nieaktualna.');
  const known = history.filter(event => event.route === fixture.route && Date.parse(event.resultAvailableAt) < now);
  if (['homeId', 'awayId'].some(side => known.filter(event => event.homeId === fixture[side] || event.awayId === fixture[side]).length < 10)) return withheld('Za mało historii jednego z uczestników.');
  const state = DEFINITIONS[sport].create();
  known.sort((a, b) => Date.parse(a.resultAvailableAt) - Date.parse(b.resultAvailableAt) || a.id.localeCompare(b.id)).forEach(event => state.update(event));
  return { status: 'validated', modelVersion: MODEL_VERSION, outcomes: DEFINITIONS[sport].outcomes, probabilities: applyTemperature(state.predict(fixture), leagueReport.calibration.temperature), asOf: new Date(now).toISOString(), reportAt: report.generatedAt };
}

/** Internal preregistration only: persist before kick-off, never show as a
 * verified forecast. Explicit source collection timestamps ensure that even
 * retrospectively downloaded training facts were known when this is issued.
 */
export function recordResearchForecast(fixture, input, { now = new Date().toISOString() } = {}) {
  const issuedAt = Date.parse(now), startAt = Date.parse(fixture?.startTime);
  const definition = DEFINITIONS[fixture?.sport];
  if (!definition || !isAllowedRoute(fixture.sport, fixture.route)) throw new Error('Brak modelu badawczego dla tej ligi');
  if (!Number.isFinite(issuedAt) || !Number.isFinite(startAt) || startAt - issuedAt < 5 * 60_000) throw new Error('Za późno na rejestrację prognozy przedmeczowej');
  if (!fixture.homeId || !fixture.awayId || fixture.homeId === fixture.awayId || typeof fixture.neutralSite !== 'boolean') throw new Error('Niejednoznaczni uczestnicy lub obiekt');
  const known = validEvents(fixture.sport, input).filter(event => event.route === fixture.route && Date.parse(event.resultAvailableAt) < issuedAt && Date.parse(event.source.fetchedAt) < issuedAt);
  const state = definition.create();
  const counts = definition.outcomes.map(() => 1);
  [...known].sort((a, b) => Date.parse(a.resultAvailableAt) - Date.parse(b.resultAvailableAt) || a.id.localeCompare(b.id)).forEach(event => {
    state.update(event);
    counts[outcome(event)]++;
  });
  const sum = counts.reduce((a, b) => a + b, 0);
  return {
    record: { status: 'research-record-only', publish: false, modelVersion: MODEL_VERSION, modelCodeFingerprint: MODEL_CODE_FINGERPRINT, issuedAt: new Date(issuedAt).toISOString(), outcomes: definition.outcomes, probabilities: state.predict(fixture), baseline: counts.map(count => count / sum), dataFingerprint: fingerprint(known), knownEventCount: known.length, calibration: { method: 'none', temperature: 1 } },
    trainingEvents: known,
  };
}
