import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { ekstraklasaDayURL, fetchEkstraklasaJSON, normalizeEkstraklasaResponse, EKSTRAKLASA_SOURCE } from '../src/server/ekstraklasa-source.js';
import { validateEkstraklasaHistory } from '../src/server/ekstraklasa-history.js';

// Separate descriptive observations only. Do not mix with data/history or the
// preregistered model experiment. Official day endpoint, <= 10 requests/minute.
const DAY = 86400000;
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const end = arg('--to') || new Date(Date.now() - DAY).toISOString().slice(0, 10);
const begin = arg('--from') || new Date(Date.parse(`${end}T00:00:00Z`) - 99 * DAY).toISOString().slice(0, 10);
ekstraklasaDayURL(begin); ekstraklasaDayURL(end);
const from = Date.parse(`${begin}T00:00:00Z`), to = Date.parse(`${end}T00:00:00Z`);
if (to < from || to - from > 366 * DAY || to >= Date.now()) throw new Error('Zakres importu musi obejmować 1–367 wcześniejszych dni UTC');
const destination = new URL('../data/supplemental/ekstraklasa.json', import.meta.url);
const checkpoint = new URL('../data/supplemental/ekstraklasa.in-progress.json', import.meta.url);
let previous = null;
try { previous = JSON.parse(await readFile(destination, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previous) validateEkstraklasaHistory(previous);
let partial = null;
try { partial = JSON.parse(await readFile(checkpoint, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (partial) validateEkstraklasaHistory({ schemaVersion: 1, kind: 'supplemental-descriptive-history', route: 'soccer/pol.1', modelExperimentEligible: false, fetchedAt: new Date().toISOString(), events: partial.events });
const events = new Map([...(previous?.events || []), ...(partial?.events || [])].map(event => [event.id, event]));
const observations = new Map([...(previous?.observations || []), ...(partial?.observations || [])].map(observation => [observation.day, observation]));
let requestAt = 0, processed = 0;
for (let timestamp = from; timestamp <= to; timestamp += DAY) {
  const day = new Date(timestamp).toISOString().slice(0, 10);
  if (partial?.from === begin && partial?.to === end && observations.has(day)) continue;
  const delay = 6000 - (Date.now() - requestAt);
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  requestAt = Date.now();
  const sourceURL = ekstraklasaDayURL(day);
  const data = await fetchEkstraklasaJSON(sourceURL);
  const observedAt = new Date().toISOString();
  const normalized = normalizeEkstraklasaResponse(data, { day, sourceURL, observedAt });
  for (let event of normalized.history) {
    const old = events.get(event.id);
    if (old && ['homeId', 'awayId', 'route'].some(field => old[field] !== event[field])) throw new Error(`Konflikt tożsamości: ${event.id}`);
    if (old) {
      const unchanged = ['homeScore', 'awayScore', 'startTime'].every(field => old[field] === event[field]);
      event = { ...event, firstObservedAt: old.firstObservedAt || old.source.fetchedAt,
        resultAvailableAt: unchanged ? old.resultAvailableAt : event.resultAvailableAt,
        ...(old.revisions ? { revisions: old.revisions } : {}) };
      if (!unchanged) event.revisions = [...(old.revisions || []), { observedAt, previous: { homeScore: old.homeScore, awayScore: old.awayScore, startTime: old.startTime, resultAvailableAt: old.resultAvailableAt } }];
    }
    events.set(event.id, event);
  }
  observations.set(day, { day, sourceURL, observedAt, rawCount: data.events?.length || 0, completedCount: normalized.history.length,
    possiblyTruncated: normalized.coverage.possiblyTruncated, exclusions: normalized.exclusions });
  await mkdir(new URL('../data/supplemental/', import.meta.url), { recursive: true });
  const checkpointNext = new URL(`${checkpoint.href}.tmp`);
  await writeFile(checkpointNext, JSON.stringify({ from: begin, to: end, events: [...events.values()], observations: [...observations.values()] }) + '\n');
  await rename(checkpointNext, checkpoint);
  if (++processed % 10 === 0) process.stdout.write(`Odczytano ${processed} dni; ${events.size} potwierdzonych wyników.\n`);
}
const result = {
  schemaVersion: 1, kind: 'supplemental-descriptive-history', sport: 'football', route: 'soccer/pol.1',
  source: EKSTRAKLASA_SOURCE, createdAt: previous?.createdAt || new Date().toISOString(), fetchedAt: new Date().toISOString(),
  modelExperimentEligible: false,
  coverage: { complete: false, from: begin, to: end, dayLimit: 3, note: 'Darmowy oficjalny dzienny odczyt TheSportsDB: do 3 spotkań, bez gwarancji pełnego sezonu. Dostępność wyniku zaczyna się przy rzeczywistej obserwacji z co najmniej 24h od rozpoczęcia meczu.' },
  events: [...events.values()].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id)),
  observations: [...observations.values()].sort((a, b) => a.day.localeCompare(b.day)),
};
await mkdir(new URL('../data/supplemental/', import.meta.url), { recursive: true });
validateEkstraklasaHistory(result);
await writeFile(new URL(`${destination.href}.tmp`), JSON.stringify(result, null, 2) + '\n');
await rename(new URL(`${destination.href}.tmp`), destination);
await unlink(checkpoint).catch(error => { if (error.code !== 'ENOENT') throw error; });
process.stdout.write(`Zapisano ${result.events.length} rzeczywistych wyników do ${destination.pathname}.\n`);
