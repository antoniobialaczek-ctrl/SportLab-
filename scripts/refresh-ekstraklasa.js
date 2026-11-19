import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ekstraklasaDayURL, fetchEkstraklasaJSON, normalizeEkstraklasaResponse, EKSTRAKLASA_SOURCE } from '../src/server/ekstraklasa-source.js';
import { validateEkstraklasaHistory, mergeEkstraklasaHistory } from '../src/server/ekstraklasa-history.js';

const DAY = 86400000;
const MIN_REQUEST_INTERVAL = 6000;
const destination = new URL('../data/supplemental/ekstraklasa.json', import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Supplemental descriptive observations only. The seven-day overlap catches
 * source corrections without moving unchanged result availability backwards.
 * This feed never enters the preregistered ESPN experiment.
 */
export async function refreshEkstraklasa(previous, { clock = Date.now, wait = sleep, fetchDay = fetchEkstraklasaJSON, days = 7 } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('Aktualizacja obejmuje od 1 do 7 zakończonych dni UTC');
  if (previous) validateEkstraklasaHistory(previous);
  const now = clock();
  if (!Number.isFinite(now)) throw new Error('Nieprawidłowy czas aktualizacji Ekstraklasy');
  const end = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - DAY;
  const start = end - (days - 1) * DAY;
  let events = previous?.events || [], lastRequestAt = null;
  const observations = new Map((previous?.observations || []).map(row => [row.day, row]));
  for (let timestamp = start; timestamp <= end; timestamp += DAY) {
    if (lastRequestAt !== null) {
      const delay = MIN_REQUEST_INTERVAL - (clock() - lastRequestAt);
      if (delay > 0) await wait(delay);
    }
    const day = new Date(timestamp).toISOString().slice(0, 10), sourceURL = ekstraklasaDayURL(day);
    lastRequestAt = clock();
    // No retries, especially after HTTP 429. The caller writes only when every
    // requested day has completed and the entire resulting artifact validates.
    const data = await fetchDay(sourceURL);
    const observedAt = new Date(clock()).toISOString();
    const normalized = normalizeEkstraklasaResponse(data, { day, sourceURL, observedAt });
    events = mergeEkstraklasaHistory(events, normalized.history);
    observations.set(day, { day, sourceURL, observedAt, rawCount: data.events?.length || 0, completedCount: normalized.history.length,
      possiblyTruncated: normalized.coverage.possiblyTruncated, exclusions: normalized.exclusions });
  }
  const fetchedAt = new Date(clock()).toISOString();
  const fromDay = new Date(start).toISOString().slice(0, 10), toDay = new Date(end).toISOString().slice(0, 10);
  const result = {
    schemaVersion: 1, kind: 'supplemental-descriptive-history', sport: 'football', route: 'soccer/pol.1',
    source: EKSTRAKLASA_SOURCE, createdAt: previous?.createdAt || fetchedAt, fetchedAt, modelExperimentEligible: false,
    coverage: { complete: false, from: previous?.coverage?.from && previous.coverage.from < fromDay ? previous.coverage.from : fromDay,
      to: previous?.coverage?.to && previous.coverage.to > toDay ? previous.coverage.to : toDay, dayLimit: 3, refreshDays: days,
      note: 'Darmowy dzienny odczyt TheSportsDB: do 3 spotkań, bez gwarancji pełnego sezonu. Wynik jest dostępny od rzeczywistej obserwacji, z co najmniej 24h od rozpoczęcia meczu.' },
    events, observations: [...observations.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
  return validateEkstraklasaHistory(result);
}

export async function refreshEkstraklasaFile({ path = destination, ...options } = {}) {
  let previous = null;
  try { previous = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = await refreshEkstraklasa(previous, options);
  const file = path instanceof URL ? fileURLToPath(path) : path;
  const temporary = `${file}.tmp`;
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(temporary, JSON.stringify(result, null, 2) + '\n');
  await rename(temporary, file);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Automatyczna aktualizacja pobiera wyłącznie ostatnie 7 zakończonych dni UTC');
  const result = await refreshEkstraklasaFile();
  console.log(JSON.stringify({ source: 'TheSportsDB', events: result.events.length, fetchedAt: result.fetchedAt, modelExperimentEligible: false }));
}
