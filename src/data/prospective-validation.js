import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_HISTORY_ROUTES } from './catalog.js';
import { MODEL_VERSION } from '../models/index.js';
import { MODEL_CODE_FINGERPRINT } from '../models/fingerprint.js';
import { applyTemperature, fitTemperature, scorePredictions } from '../models/metrics.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const implementationHash = createHash('sha256');
for (const name of ['prospective-validation.js', 'snapshots.js', 'evidence-audit.js', 'espn.js', 'schema.js', 'catalog.js']) {
  implementationHash.update(name + '\0').update(readFileSync(new URL(name, import.meta.url))).update('\0');
}
const IMPLEMENTATION = implementationHash.digest('hex');
const STAGES = ['calibration', 'selection', 'test'];
const POLICY = Object.freeze({
  slots: { calibration: 60, selection: 45, test: 150 },
  minimumValid: { calibration: 40, selection: 30, test: 100 },
  minimumKnownTrainingEvents: 100, maximumVoidRate: 0.05,
  minimumTestDays: 7, unresolvedAfterDays: 14, bootstrapReplicates: 1000,
  calibrationMaximumECE: 0.1,
});
const outcomeIndex = event => event.homeScore > event.awayScore ? 0 : event.homeScore === event.awayScore ? 1 : event.sport === 'football' ? 2 : 1;

export function createValidationProtocol(registeredAt) {
  const header = { schemaVersion: 1, version: 'prospective-1', registeredAt, modelVersion: MODEL_VERSION, modelCodeFingerprint: MODEL_CODE_FINGERPRINT, implementationFingerprint: IMPLEMENTATION, policy: structuredClone(POLICY) };
  if (!Number.isFinite(Date.parse(registeredAt))) throw new Error('Nieprawidłowy czas rejestracji eksperymentu');
  return { ...header, policyHash: digest(header), leagues: Object.fromEntries(Object.values(DEFAULT_HISTORY_ROUTES).flat().map(route => [route, {
    route, league: route.split('/').at(-1), phase: 'calibration', openedAt: registeredAt,
    slots: { calibration: [], selection: [], test: [] }, freezes: {},
  }])) };
}

function checkProtocol(protocol) {
  const { policyHash, leagues, ...header } = protocol;
  if (!leagues || digest(header) !== policyHash || digest(protocol.policy) !== digest(POLICY)
    || protocol.modelCodeFingerprint !== MODEL_CODE_FINGERPRINT || protocol.implementationFingerprint !== IMPLEMENTATION || protocol.modelVersion !== MODEL_VERSION) {
    throw new Error('Zmiana zamrożonego protokołu lub kodu modelu wymaga osobnego przeglądu; eksperyment nie został wyzerowany');
  }
  return protocol;
}

export function enrollValidationForecast(protocol, forecast) {
  checkProtocol(protocol);
  const league = protocol.leagues[forecast.route];
  if (!league || !STAGES.includes(league.phase) || forecast.modelVersion !== protocol.modelVersion || forecast.modelCodeFingerprint !== protocol.modelCodeFingerprint
    || Date.parse(forecast.issuedAt) <= Date.parse(league.openedAt) || Date.parse(forecast.issuedAt) < Date.parse(protocol.registeredAt)
    || forecast.knownEventCount < POLICY.minimumKnownTrainingEvents) return false;
  const all = Object.values(protocol.leagues).flatMap(l => STAGES.flatMap(stage => l.slots[stage]));
  if (all.some(slot => slot.id === forecast.id)) return false;
  const slots = league.slots[league.phase];
  if (slots.length >= POLICY.slots[league.phase]) return false;
  slots.push({ id: forecast.id, enrolledAt: forecast.issuedAt, temperature: league.phase === 'test' ? league.freezes.selection.temperature : 1 });
  return true;
}

function rowsFor(protocol, league, stage, state, now) {
  const forecasts = new Map(state.forecasts.map(f => [f.id, f]));
  const events = new Map(state.events.filter(e => Date.parse(e.resultAvailableAt) <= Date.parse(now)).map(e => [e.id, e]));
  const conflicts = new Set(state.conflicts.filter(c => Date.parse(c.observedAt) <= Date.parse(now)).map(c => c.id));
  const voids = new Set((state.voids || []).filter(v => Date.parse(v.observedAt) <= Date.parse(now)).map(v => v.id));
  const rows = [], statuses = [];
  for (const slot of league.slots[stage]) {
    if (Date.parse(slot.enrolledAt) > Date.parse(now)) continue;
    const f = forecasts.get(slot.id);
    if (!f || f.route !== league.route || f.modelCodeFingerprint !== protocol.modelCodeFingerprint || f.modelVersion !== protocol.modelVersion
      || f.issuedAt !== slot.enrolledAt || Date.parse(f.issuedAt) <= Date.parse(stage === 'calibration' ? protocol.registeredAt : league.freezes[stage === 'selection' ? 'calibration' : 'selection'].at)) {
      throw new Error('Niespójne przypisanie prognozy do zamrożonego etapu');
    }
    if (slot.temperature !== (stage === 'test' ? league.freezes.selection.temperature : 1)) throw new Error('Zmiana temperatury przypisanej przed meczem do próby');
    const event = events.get(slot.id);
    if (conflicts.has(slot.id) || voids.has(slot.id)
      || (event && (event.homeId !== f.homeId || event.awayId !== f.awayId || event.startTime !== f.startTime || Date.parse(event.resultAvailableAt) <= Date.parse(f.issuedAt)))
      || (!event && Date.parse(now) - Date.parse(f.startTime) > POLICY.unresolvedAfterDays * 86400000)) {
      statuses.push({ id: slot.id, status: 'void' });
    } else if (!event) statuses.push({ id: slot.id, status: 'pending' });
    else {
      statuses.push({ id: slot.id, status: 'settled' });
      rows.push({ id: f.id, startTime: f.startTime, outcome: outcomeIndex(event), probabilities: f.probabilities, baseline: f.baseline });
    }
  }
  return { rows, statuses, fingerprint: digest({ rows, statuses }) };
}

const scaled = (rows, temperature) => rows.map(row => ({ ...row, probabilities: applyTemperature(row.probabilities, temperature) }));
const metrics = rows => rows.length ? scorePredictions(rows) : null;
const baseline = rows => metrics(rows.map(row => ({ ...row, probabilities: row.baseline })));

function pairedImprovement(rows) {
  const groups = new Map();
  for (const row of rows) {
    const day = row.startTime.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    const model = row.probabilities.reduce((s, p, i) => s + (p - Number(i === row.outcome)) ** 2, 0) / row.probabilities.length;
    const base = row.baseline.reduce((s, p, i) => s + (p - Number(i === row.outcome)) ** 2, 0) / row.baseline.length;
    groups.get(day).push(base - model);
  }
  const blocks = [...groups.values()];
  if (!blocks.length) return null;
  let seed = 73129;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const values = [];
  for (let i = 0; i < POLICY.bootstrapReplicates; i++) {
    let total = 0, count = 0;
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[Math.floor(random() * blocks.length)];
      total += block.reduce((s, n) => s + n, 0); count += block.length;
    }
    values.push(total / count);
  }
  values.sort((a, b) => a - b);
  return { method: 'paired-UTC-day-block-bootstrap', level: 0.95, blocks: blocks.length, replicates: POLICY.bootstrapReplicates,
    lower: values[Math.floor(values.length * 0.025)], upper: values[Math.floor(values.length * 0.975)],
    point: blocks.flat().reduce((s, n) => s + n, 0) / rows.length };
}

function deriveFreeze(protocol, league, stage, state, at) {
  const result = rowsFor(protocol, league, stage, state, at);
  const voidCount = result.statuses.filter(row => row.status === 'void').length;
  if (!Number.isFinite(Date.parse(at)) || result.statuses.length !== POLICY.slots[stage] || result.statuses.some(row => row.status === 'pending')
    || result.rows.length < POLICY.minimumValid[stage] || voidCount / result.statuses.length > POLICY.maximumVoidRate) throw new Error('Zamrożony etap nie ma kompletnej, prawidłowej próby w zapisanym czasie');
  const freeze = { at, fingerprint: result.fingerprint, count: result.rows.length, void: voidCount };
  if (stage === 'calibration') freeze.temperature = fitTemperature(result.rows);
  else if (stage === 'selection') {
    const candidate = league.freezes.calibration.temperature;
    const raw = metrics(result.rows), calibrated = metrics(scaled(result.rows, candidate));
    freeze.selected = candidate !== 1 && calibrated.brier < raw.brier && calibrated.logLoss <= raw.logLoss;
    freeze.temperature = freeze.selected ? candidate : 1;
  } else {
    const evaluated = scaled(result.rows, league.freezes.selection.temperature);
    const test = metrics(evaluated), reference = baseline(result.rows), improvement = pairedImprovement(evaluated);
    const ece = test.reliabilityBins.reduce((sum, bin) => sum + bin.count * Math.abs((bin.accuracy ?? 0) - (bin.confidence ?? 0)), 0) / test.count;
    freeze.metrics = test; freeze.rawMetrics = metrics(result.rows); freeze.baselineMetrics = reference;
    freeze.brierImprovementInterval = improvement; freeze.expectedCalibrationError = ece;
    freeze.checks = { sample: test.count >= POLICY.minimumValid.test, days: improvement.blocks >= POLICY.minimumTestDays,
      brier: improvement.lower > 0, logLoss: test.logLoss <= reference.logLoss, calibration: ece <= POLICY.calibrationMaximumECE };
  }
  return freeze;
}

function checkFrozenTransitions(protocol, state, now) {
  for (const league of Object.values(protocol.leagues)) {
    for (const stage of STAGES) {
      const freeze = league.freezes[stage];
      if (!freeze) continue;
      if (Date.parse(freeze.at) > Date.parse(now)) throw new Error('Nie można wykorzystać przyszłego stanu eksperymentu we wcześniejszym raporcie');
      const replay = deriveFreeze(protocol, league, stage, state, freeze.at);
      if (!isDeepStrictEqual(freeze, replay)) throw new Error('Odtworzenie nie potwierdza zamrożonej kalibracji, wyboru lub metryk');
    }
    if (['completed-awaiting-review', 'failed'].includes(league.phase)) {
      if (!league.freezes.test) throw new Error('Brak dowodu zamknięcia końcowego testu');
      const passed = Object.values(league.freezes.test.checks).every(Boolean);
      if (passed !== (league.phase === 'completed-awaiting-review')) throw new Error('Status nie odpowiada zamrożonym kryteriom');
    }
  }
}

/** Advances only when the predetermined cohort has completely resolved.
 * Calibrator and selection are frozen before ANY enrollment in the next stage.
 */
export function advanceValidationProtocol(protocol, state, now) {
  checkProtocol(protocol);
  checkFrozenTransitions(protocol, state, now);
  const seen = new Set();
  for (const league of Object.values(protocol.leagues)) {
    for (const stage of STAGES) {
      if (league.slots[stage].length > POLICY.slots[stage]) throw new Error('Przekroczono uprzednio zarejestrowaną próbę');
      for (const slot of league.slots[stage]) {
        if (seen.has(slot.id)) throw new Error('Prognoza występuje w więcej niż jednym etapie');
        seen.add(slot.id);
      }
      if (league.freezes[stage]) {
        const current = rowsFor(protocol, league, stage, state, now);
        if (current.fingerprint !== league.freezes[stage].fingerprint) {
          league.phase = 'invalidated'; league.reason = 'Zmieniły się dowody wcześniej zamrożonego etapu; wymagany przegląd.';
        }
      }
    }
    const stage = league.phase;
    if (!STAGES.includes(stage) || league.slots[stage].length < POLICY.slots[stage]) continue;
    const result = rowsFor(protocol, league, stage, state, now);
    if (result.statuses.some(row => row.status === 'pending')) continue;
    const voidCount = result.statuses.filter(row => row.status === 'void').length;
    if (result.rows.length < POLICY.minimumValid[stage] || voidCount / result.statuses.length > POLICY.maximumVoidRate) {
      league.phase = 'blocked-data'; league.reason = 'Ustalona próba ma za dużo brakujących lub unieważnionych wyników. Nie rozszerzamy jej po obejrzeniu rezultatów.';
      continue;
    }
    const freeze = deriveFreeze(protocol, league, stage, state, now);
    if (stage === 'calibration') {
      league.freezes.calibration = freeze;
      league.phase = 'selection'; league.openedAt = now;
    } else if (stage === 'selection') {
      league.freezes.selection = freeze;
      league.phase = 'test'; league.openedAt = now;
    } else {
      league.freezes.test = freeze;
      league.phase = Object.values(freeze.checks).every(Boolean) ? 'completed-awaiting-review' : 'failed';
      league.reason = league.phase === 'failed' ? 'Zamknięty test nie spełnił zarejestrowanych kryteriów. Wynik nie służy do dostrajania tej samej próby.' : 'Test spełnił kryteria; przed publikacją prognoz wymagany jest przegląd dowodów i zakresu zastosowania.';
    }
  }
  return protocol;
}

export function publicValidationProgress(protocol, state, now) {
  if (!protocol) return null;
  if (Date.parse(now) < Date.parse(protocol.registeredAt)) return null;
  checkProtocol(protocol);
  if (Object.values(protocol.leagues).some(l => STAGES.some(stage => l.slots[stage].some(slot => Date.parse(slot.enrolledAt) > Date.parse(now))))) throw new Error('Nie można wykorzystać przyszłego stanu eksperymentu we wcześniejszym raporcie');
  checkFrozenTransitions(protocol, state, now);
  return { version: protocol.version, registeredAt: protocol.registeredAt, policyHash: protocol.policyHash,
    modelVersion: protocol.modelVersion, policy: protocol.policy, publication: { eligible: false },
    leagues: Object.values(protocol.leagues).map(league => ({ route: league.route, league: league.league, phase: league.phase, reason: league.reason || null,
      stages: Object.fromEntries(STAGES.map(stage => {
        const result = rowsFor(protocol, league, stage, state, now);
        return [stage, { target: POLICY.slots[stage], minimumValid: POLICY.minimumValid[stage], recorded: result.statuses.length,
          settled: result.rows.length, pending: result.statuses.filter(row => row.status === 'pending').length, void: result.statuses.filter(row => row.status === 'void').length,
          frozenAt: league.freezes[stage]?.at || null }];
      })),
      finalTestMetrics: ['completed-awaiting-review', 'failed'].includes(league.phase) ? league.freezes.test?.metrics || null : null,
      baselineMetrics: ['completed-awaiting-review', 'failed'].includes(league.phase) ? league.freezes.test?.baselineMetrics || null : null,
      brierImprovementInterval: ['completed-awaiting-review', 'failed'].includes(league.phase) ? league.freezes.test?.brierImprovementInterval || null : null,
      checks: ['completed-awaiting-review', 'failed'].includes(league.phase) ? league.freezes.test?.checks || null : null,
    })) };
}
