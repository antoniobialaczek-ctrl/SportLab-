import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateHistory } from '../data/schema.js';

const SPORTS = ['nba', 'football', 'nhl', 'tennis'];
const REPOSITORY = 'antoniobialaczek-ctrl/SportLab-';
const BRANCH = 'sportlab-data';
const MAX_AGE = 7 * 86400000;
const MAX_FUTURE = 5 * 60000;
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const FILES = new Set([...SPORTS.map(sport => `history/${sport}.json`), 'reports/models.json', 'reports/forward.json']);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const freshTimestamp = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + MAX_FUTURE && Date.parse(value) >= now - MAX_AGE;

export function validateManifest(value, now = Date.now()) {
  if (!value || value.schemaVersion !== 1 || value.repository !== REPOSITORY || value.branch !== BRANCH || !COMMIT.test(value.dataCommit || '') || !freshTimestamp(value.generatedAt, now) || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('Nieaktualny lub nieprawidłowy manifest danych');
  for (const [path, info] of Object.entries(value.files)) {
    if (!FILES.has(path) || !info || !SHA.test(info.sha256 || '') || !Number.isSafeInteger(info.bytes) || info.bytes < 2 || info.bytes > 32 * 1024 * 1024) throw new Error('Nieprawidłowy wpis manifestu');
  }
  if (!value.files['reports/models.json'] || SPORTS.some(sport => !value.files[`history/${sport}.json`])) throw new Error('Niepełny manifest danych');
  return value;
}

/** Public artifacts contain evaluation summaries, never fixture forecast vectors. */
export function validatePublicReport(value, { forward = false } = {}) {
  if (!value || value.schemaVersion !== 1 || !Number.isFinite(Date.parse(value.generatedAt)) || !value.sports || typeof value.sports !== 'object' || Array.isArray(value.sports)) throw new Error('Nieprawidłowy raport modeli');
  const walk = entry => {
    if (!entry || typeof entry !== 'object') return;
    for (const [key, item] of Object.entries(entry)) {
      if (['probabilities', 'predictions', 'forecasts', 'rawResponses', 'rawSnapshots', 'apiKey', 'token'].includes(key)) throw new Error('Raport zawiera niepubliczne dane prognoz');
      walk(item);
    }
  };
  walk(value);
  if (!forward) for (const [sport, report] of Object.entries(value.sports)) {
    if (![...SPORTS, 'cs2'].includes(sport) || !report || !['research', 'validated', 'unavailable'].includes(report.status)) throw new Error('Nieprawidłowy sport lub status raportu');
    if (report.metrics != null && (!Number.isInteger(report.metrics.count) || report.metrics.count < 0 || !Number.isFinite(report.metrics.accuracy) || report.metrics.accuracy < 0 || report.metrics.accuracy > 1 || !Number.isFinite(report.metrics.brier) || report.metrics.brier < 0 || !Number.isFinite(report.metrics.logLoss) || report.metrics.logLoss < 0)) throw new Error('Nieprawidłowe metryki raportu');
  }
  return value;
}

/** Injectable factory also keeps local development/tests independent of GitHub. */
export function createStorage({ root = new URL('../../data/', import.meta.url), remoteEnabled = false, fetchImpl = globalThis.fetch, now = Date.now, cacheTTL = 300000, timeoutMs = 8000 } = {}) {
  let manifestCache;
  const fileCache = new Map();

  async function download(url, limit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Dane GitHub: HTTP ${response.status}`);
      const declared = response.headers?.get('content-length');
      if (declared && Number(declared) > limit) throw new Error('Przekroczono limit rozmiaru danych');
      let bytes;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > limit) { await reader.cancel(); throw new Error('Przekroczono limit rozmiaru danych'); }
          chunks.push(Buffer.from(next.value));
        }
        bytes = Buffer.concat(chunks, size);
      } else {
        bytes = Buffer.from(await response.text());
        if (bytes.length > limit) throw new Error('Przekroczono limit rozmiaru danych');
      }
      return bytes;
    } finally { clearTimeout(timer); }
  }

  async function remote(path, validate) {
    const timestamp = now();
    if (!manifestCache || timestamp - manifestCache.cachedAt >= cacheTTL) {
      const bytes = await download(`https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}/manifest.json`, 32768);
      manifestCache = { value: validateManifest(JSON.parse(bytes.toString('utf8')), timestamp), cachedAt: timestamp };
    }
    const manifest = validateManifest(manifestCache.value, timestamp);
    const info = manifest.files[path];
    if (!info) return null;
    const key = `${manifest.dataCommit}:${path}`;
    let cached = fileCache.get(key);
    if (!cached) {
      // Immutable commit pins every file to the exact generation in manifest.
      const bytes = await download(`https://raw.githubusercontent.com/${REPOSITORY}/${manifest.dataCommit}/${path}`, info.bytes);
      if (bytes.length !== info.bytes || sha256(bytes) !== info.sha256) throw new Error('Niezgodny skrót lub rozmiar opublikowanych danych');
      cached = validate(JSON.parse(bytes.toString('utf8')));
      fileCache.set(key, cached);
      // Bound serverless-memory use to one generation of the six public files.
      for (const previous of fileCache.keys()) if (!previous.startsWith(`${manifest.dataCommit}:`)) fileCache.delete(previous);
    }
    return { ...cached, runtimeData: { origin: 'github', fallback: false, publishedAt: manifest.generatedAt, dataCommit: manifest.dataCommit } };
  }

  async function local(path, validate) {
    try { return validate(JSON.parse(await readFile(new URL(path, root), 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async function read(path, validate) {
    let reason;
    if (remoteEnabled) {
      try {
        const data = await remote(path, validate);
        if (data) return data;
        reason = 'Brak tego raportu w opublikowanym zbiorze.';
      } catch {
        // Internal errors and network details never leak credentials or URLs.
        reason = 'Aktualizacja danych jest niedostępna lub nie przeszła weryfikacji; użyto danych dołączonych do wdrożenia.';
      }
    }
    const data = await local(path, validate);
    return data ? { ...data, runtimeData: { origin: 'local', fallback: remoteEnabled, ...(reason ? { reason } : {}) } } : null;
  }

  return {
    async readHistory(sport) {
      if (!SPORTS.includes(sport)) throw new Error('Nieznana dyscyplina historii');
      const data = await read(`history/${sport}.json`, value => validateHistory(value, sport));
      return data ? { ...data, available: true } : { available: false, events: [], updatedAt: null, runtimeData: { origin: 'local', fallback: remoteEnabled } };
    },
    readReports: () => read('reports/models.json', value => validatePublicReport(value)),
    readForwardReport: () => read('reports/forward.json', value => validatePublicReport(value, { forward: true })),
  };
}

const storage = createStorage({ remoteEnabled: Boolean(process.env.VERCEL) || process.env.SPORTLAB_REMOTE_DATA === '1' });
export const readHistory = sport => storage.readHistory(sport);
export const readReports = () => storage.readReports();
export const readForwardReport = () => storage.readForwardReport();
