import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePredictions, wilsonInterval, applyTemperature, fitTemperature } from '../src/models/metrics.js';

test('proper scores match known binary and three-way outcomes', () => {
  const binary = scorePredictions([
    { probabilities: [0.8, 0.2], outcome: 0 },
    { probabilities: [0.6, 0.4], outcome: 1 },
  ]);
  assert.equal(binary.count, 2);
  assert.equal(binary.accuracy, 0.5);
  assert.ok(Math.abs(binary.brier - 0.2) < 1e-12);
  assert.ok(Math.abs(binary.logLoss - (-Math.log(0.8) - Math.log(0.4)) / 2) < 1e-12);
  const threeWay = scorePredictions([{ probabilities: [1 / 3, 1 / 3, 1 / 3], outcome: 2 }]);
  assert.ok(Math.abs(threeWay.brier - 2 / 9) < 1e-12);
  assert.ok(Math.abs(threeWay.logLoss - Math.log(3)) < 1e-12);
});

test('empty samples yield missing metrics, never fabricated accuracy', () => {
  const score = scorePredictions([]);
  assert.equal(score.count, 0);
  assert.equal(score.accuracy, null);
  assert.equal(score.brier, null);
  assert.equal(score.logLoss, null);
  assert.equal(score.accuracyInterval.lower, null);
  assert.equal(score.reliabilityBins.length, 10);
  assert.ok(score.reliabilityBins.every(bin => bin.count === 0 && bin.confidence === null && bin.accuracy === null));
});

test('perfect and impossible forecasts remain finite and calibrated bins retain counts', () => {
  const perfect = scorePredictions([{ probabilities: [1, 0], outcome: 0 }]);
  assert.equal(perfect.brier, 0);
  assert.equal(perfect.logLoss, 0);
  assert.equal(perfect.reliabilityBins[9].count, 1);
  const impossible = scorePredictions([{ probabilities: [1, 0], outcome: 1 }]);
  assert.equal(impossible.brier, 1);
  assert.ok(Number.isFinite(impossible.logLoss) && impossible.logLoss > 30);
  assert.equal(impossible.reliabilityBins[9].accuracy, 0);
  const mixed = scorePredictions([
    { probabilities: [0.8, 0.2], outcome: 0 },
    { probabilities: [0.85, 0.15], outcome: 1 },
    { probabilities: [0.45, 0.55], outcome: 1 },
  ]);
  assert.equal(mixed.reliabilityBins.reduce((sum, bin) => sum + bin.count, 0), mixed.count);
  assert.equal(mixed.reliabilityBins[8].accuracy, 0.5);
  assert.ok(Math.abs(mixed.reliabilityBins[8].confidence - 0.825) < 1e-12);
});

test('scoring rejects non-probabilities and malformed outcomes instead of publishing numbers', () => {
  for (const probabilities of [[NaN, 0.5], [0.6, 0.6], [-0.1, 1.1], [1], [Infinity, 0]]) {
    assert.throws(() => scorePredictions([{ probabilities, outcome: 0 }]), TypeError);
  }
  assert.throws(() => scorePredictions([{ probabilities: [0.5, 0.5], outcome: 2 }]), TypeError);
  assert.throws(() => scorePredictions([{ probabilities: [0.5, 0.5], outcome: 0.5 }]), TypeError);
  assert.throws(() => scorePredictions([
    { probabilities: [0.5, 0.5], outcome: 0 },
    { probabilities: [0.3, 0.3, 0.4], outcome: 1 },
  ]), TypeError);
});

test('Wilson interval reflects uncertainty and handles boundary counts', () => {
  const small = wilsonInterval(5, 10);
  const large = wilsonInterval(500, 1000);
  assert.ok(small.lower < 0.5 && small.upper > 0.5);
  assert.ok(large.upper - large.lower < small.upper - small.lower);
  assert.ok(wilsonInterval(0, 10).upper > 0);
  assert.ok(wilsonInterval(10, 10).lower < 1);
  assert.deepEqual(wilsonInterval(0, 0), { lower: null, upper: null, level: 0.95 });
  assert.throws(() => wilsonInterval(2, 1), TypeError);
});

test('temperature preserves normalized probabilities and softens overconfidence', () => {
  const probabilities = [0.8, 0.15, 0.05];
  assert.deepEqual(applyTemperature(probabilities, 1), probabilities);
  const softened = applyTemperature(probabilities, 2);
  assert.ok(softened[0] < probabilities[0]);
  assert.ok(softened[2] > probabilities[2]);
  assert.ok(Math.abs(softened.reduce((sum, p) => sum + p, 0) - 1) < 1e-12);
  assert.deepEqual(applyTemperature([1, 0], 3), [1, 0]);
  assert.throws(() => applyTemperature(probabilities, 0), TypeError);
  assert.throws(() => applyTemperature(probabilities, NaN), TypeError);
});

test('temperature fit uses only supplied calibration rows and defaults to identity without evidence', () => {
  const overconfident = Array.from({ length: 20 }, (_, i) => ({ probabilities: [0.9, 0.1], outcome: i % 2 }));
  const temperature = fitTemperature(overconfident);
  assert.ok(temperature > 1);
  const raw = scorePredictions(overconfident).logLoss;
  const calibrated = scorePredictions(overconfident.map(row => ({ ...row, probabilities: applyTemperature(row.probabilities, temperature) }))).logLoss;
  assert.ok(calibrated < raw);
  assert.equal(fitTemperature([]), 1);
  assert.equal(fitTemperature([{ probabilities: [0.5, 0.5], outcome: 0 }]), 1);
});
