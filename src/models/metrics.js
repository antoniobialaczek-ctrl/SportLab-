/** Proper scores for out-of-sample forecasts. Brier is sum((p-y)^2) / classes.
 * For binary forecasts this equals the usual (p_home-y_home)^2. */
const EPSILON = 1e-15;
const TEMPERATURES = [0.6, 0.8, 1, 1.2, 1.5, 2, 3];

function validateProbabilities(probabilities) {
  if (!Array.isArray(probabilities) || ![2, 3].includes(probabilities.length)) {
    throw new TypeError('Expected two or three outcome probabilities');
  }
  if (probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1)) {
    throw new TypeError('Probabilities must be finite values between zero and one');
  }
  const sum = probabilities.reduce((value, p) => value + p, 0);
  if (Math.abs(sum - 1) > 1e-6) throw new TypeError('Probabilities must sum to one');
}

function validateRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Expected prediction rows');
  let classes;
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new TypeError('Invalid prediction row');
    validateProbabilities(row.probabilities);
    classes ??= row.probabilities.length;
    if (row.probabilities.length !== classes) throw new TypeError('Mixed outcome dimensions');
    if (!Number.isInteger(row.outcome) || row.outcome < 0 || row.outcome >= classes) {
      throw new TypeError('Outcome must index a valid probability');
    }
  }
}

export function wilsonInterval(successes, total) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(successes) || successes < 0 || successes > total) {
    throw new TypeError('Expected integer counts with zero <= successes <= total');
  }
  if (total === 0) return { lower: null, upper: null, level: 0.95 };
  const z = 1.959963984540054;
  const fraction = successes / total;
  const denominator = 1 + z * z / total;
  const center = (fraction + z * z / (2 * total)) / denominator;
  const half = z * Math.sqrt(fraction * (1 - fraction) / total + z * z / (4 * total * total)) / denominator;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half), level: 0.95 };
}

export function scorePredictions(rows) {
  validateRows(rows);
  const reliabilityBins = Array.from({ length: 10 }, (_, index) => ({
    lower: index / 10,
    upper: (index + 1) / 10,
    count: 0,
    confidence: null,
    accuracy: null,
  }));
  const sums = reliabilityBins.map(() => ({ confidence: 0, correct: 0 }));
  let brier = 0;
  let logLoss = 0;
  let correct = 0;
  for (const { probabilities, outcome } of rows) {
    let pick = 0;
    for (let index = 1; index < probabilities.length; index++) {
      if (probabilities[index] > probabilities[pick]) pick = index;
    }
    const hit = Number(pick === outcome);
    correct += hit;
    brier += probabilities.reduce((sum, p, index) => sum + (p - Number(index === outcome)) ** 2, 0) / probabilities.length;
    logLoss -= Math.log(Math.max(EPSILON, probabilities[outcome]));
    const bin = Math.min(9, Math.floor(probabilities[pick] * 10));
    reliabilityBins[bin].count++;
    sums[bin].confidence += probabilities[pick];
    sums[bin].correct += hit;
  }
  for (let index = 0; index < reliabilityBins.length; index++) {
    const bin = reliabilityBins[index];
    if (bin.count > 0) {
      bin.confidence = sums[index].confidence / bin.count;
      bin.accuracy = sums[index].correct / bin.count;
    }
  }
  const count = rows.length;
  return {
    count,
    correct,
    accuracy: count ? correct / count : null,
    accuracyInterval: wilsonInterval(correct, count),
    brier: count ? brier / count : null,
    logLoss: count ? logLoss / count : null,
    reliabilityBins,
  };
}

/** Temperature rescales log probabilities without introducing any outcome data. */
export function applyTemperature(probabilities, temperature) {
  validateProbabilities(probabilities);
  if (!Number.isFinite(temperature) || temperature <= 0) throw new TypeError('Temperature must be finite and positive');
  const logits = probabilities.map(p => p === 0 ? -Infinity : Math.log(p) / temperature);
  const maximum = Math.max(...logits);
  const weights = logits.map(value => Math.exp(value - maximum));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  return weights.map(weight => weight / sum);
}

/** Fit on a calibration partition only. Caller must select and test on later data. */
export function fitTemperature(rows) {
  validateRows(rows);
  if (rows.length === 0) return 1;
  const loss = temperature => rows.reduce((sum, row) =>
    sum - Math.log(Math.max(EPSILON, applyTemperature(row.probabilities, temperature)[row.outcome])), 0) / rows.length;
  let selected = 1;
  let best = loss(selected);
  for (const temperature of TEMPERATURES) {
    const candidate = loss(temperature);
    // Identity wins numerical ties, avoiding unsupported changes on an indifferent sample.
    if (candidate < best - 1e-12) {
      selected = temperature;
      best = candidate;
    }
  }
  return selected;
}
