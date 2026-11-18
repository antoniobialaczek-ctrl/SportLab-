import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_HISTORY_ROUTES, ESPN_UNAVAILABLE_HISTORY_ROUTES, SPORTS, isAllowedRoute, parseDay, scoreboardURL } from './catalog.js';
import { SCHEMA_VERSION, validateHistory, mergeEvents } from './schema.js';
import { normalizeScoreboard } from './espn.js';
import { fetchJSON, mapConcurrent } from './fetch.js';

export async function atomicJSON(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, path);
}

export async function readHistory(root, sport) {
  if (!SPORTS.includes(sport)) throw new Error('Nieznana dyscyplina');
  try { return validateHistory(JSON.parse(await readFile(join(root, `${sport}.json`), 'utf8')), sport); }
  catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: SCHEMA_VERSION, updatedAt: null, events: [], errors: [] };
    throw error;
  }
}

export function historyDays(from, to, now = new Date()) {
  const first = parseDay(from);
  const last = parseDay(to);
  const midnight = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  if (last < first) throw new Error('Data końcowa poprzedza początkową');
  if (last >= midnight) throw new Error('Historia obejmuje wyłącznie zakończone dni UTC');
  if ((last - first) / 86_400_000 > 1095) throw new Error('Jedno pobranie może obejmować maksymalnie 1096 dni');
  return Array.from({ length: Math.floor((last - first) / 86_400_000) + 1 }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10));
}

/** A failed or malformed response never replaces a sport's last complete history. */
export async function ingestHistory({ root, from, to, sports = SPORTS, routes, dryRun = false, concurrency = 3, fetchImpl, now = new Date(), onProgress = () => {} }) {
  const fetchedAt = new Date(now).toISOString();
  const days = historyDays(from, to, now);
  if (!Array.isArray(sports) || !sports.length || sports.some(sport => !SPORTS.includes(sport)) || new Set(sports).size !== sports.length) throw new Error('Nieprawidłowa lista dyscyplin');
  if (routes && (!routes.length || routes.some(route => !sports.some(sport => isAllowedRoute(sport, route))))) throw new Error('Nieprawidłowa lista lig');
  const report = { schemaVersion: SCHEMA_VERSION, startedAt: fetchedAt, from, to, dryRun, sports: {}, hasErrors: false, hasExclusions: false };
  const jobs = [];
  const histories = {};
  for (const sport of sports) {
    const selected = (routes ? routes.filter(route => isAllowedRoute(sport, route)) : DEFAULT_HISTORY_ROUTES[sport]).filter(route => !Object.hasOwn(ESPN_UNAVAILABLE_HISTORY_ROUTES, route));
    const unavailableSources = Object.entries(ESPN_UNAVAILABLE_HISTORY_ROUTES).filter(([route]) => isAllowedRoute(sport, route) && (!routes || routes.includes(route))).map(([route, detail]) => ({ route, ...detail }));
    report.sports[sport] = { status: selected.length ? 'pending' : 'unavailable', routes: selected, unavailableSources, requests: 0, events: 0, skipped: 0, receivedCompleted: 0, newExclusions: 0, excluded: 0, exclusions: [], errors: [], reason: selected.length ? null : unavailableSources[0]?.reason || 'Brak zweryfikowanego darmowego źródła lub wybranej ligi' };
    if (!selected.length) continue;
    // Corrupt local history also aborts before any network/write for this run.
    histories[sport] = await readHistory(root, sport);
    for (const route of selected) for (const day of days) jobs.push({ sport, route, day });
  }
  const incoming = Object.fromEntries(sports.map(sport => [sport, []]));
  await mapConcurrent(jobs, concurrency, async job => {
    const summary = report.sports[job.sport];
    const url = scoreboardURL(job.route, job.day);
    try {
      const data = await fetchJSON(url, { fetchImpl });
      const normalized = normalizeScoreboard(data, { ...job, fetchedAt, url });
      summary.requests++;
      summary.skipped += normalized.skipped;
      summary.receivedCompleted += normalized.events.length + normalized.rejected.length;
      if (normalized.rejected.length) {
        report.hasExclusions = true;
        summary.newExclusions += normalized.rejected.length;
        summary.exclusions.push(...normalized.rejected.map(item => ({
          id: `${job.route}:${item.id}`, sourceEventId: item.id, route: job.route, day: job.day,
          reason: item.reason, url, observedAt: fetchedAt,
        })));
      }
      incoming[job.sport].push(...normalized.events);
      onProgress({ ...job, count: normalized.events.length, rejected: normalized.rejected.length });
    } catch (error) {
      summary.requests++;
      summary.errors.push({ route: job.route, day: job.day, message: error.message });
      onProgress({ ...job, error: error.message });
    }
  });
  for (const sport of sports) {
    const summary = report.sports[sport];
    if (!histories[sport]) continue;
    summary.downloaded = incoming[sport].length;
    if (summary.newExclusions && summary.newExclusions / summary.receivedCompleted > 0.05) {
      summary.errors.push({ message: 'Odrzucono ponad 5% zakończonych rekordów w pobranym zakresie; możliwa zmiana formatu źródła' });
    }
    if (summary.errors.length) {
      summary.status = 'error';
      summary.events = histories[sport].events.length;
      report.hasErrors = true;
      continue;
    }
    try {
      const unique = new Map();
      for (const event of incoming[sport]) {
        const prior = unique.get(event.id);
        if (prior && ['homeId', 'awayId', 'homeScore', 'awayScore', 'startTime'].some(field => prior[field] !== event[field])) throw new Error(`Sprzeczne odpowiedzi źródła dla meczu: ${event.id}`);
        if (!prior || event.source.url < prior.source.url) unique.set(event.id, event);
      }
      const exclusions = new Map((histories[sport].exclusions || []).map(item => [item.id, item]));
      for (const event of unique.values()) exclusions.delete(event.id);
      for (const item of summary.exclusions) exclusions.set(item.id, item);
      summary.exclusions = [...exclusions.values()].sort((a, b) => a.id.localeCompare(b.id));
      summary.excluded = summary.exclusions.length;
      if (summary.excluded) report.hasExclusions = true;
      const events = mergeEvents(histories[sport].events.filter(event => !exclusions.has(event.id)), [...unique.values()].filter(event => !exclusions.has(event.id)));
      summary.events = events.length;
      summary.status = events.length ? summary.excluded ? 'ok-with-exclusions' : 'ok' : 'empty';
      if (!dryRun) await atomicJSON(join(root, `${sport}.json`), {
        schemaVersion: SCHEMA_VERSION, updatedAt: fetchedAt, events, errors: [],
        exclusions: summary.exclusions,
        unavailableSources: summary.unavailableSources,
        coverage: { ...histories[sport].coverage, lastFetch: { from, to, routes: summary.routes } },
      });
    } catch (error) {
      summary.status = 'error';
      summary.errors.push({ message: error.message });
      report.hasErrors = true;
    }
  }
  report.completedAt = new Date().toISOString();
  if (!dryRun) await atomicJSON(join(root, 'ingestion.json'), report);
  return report;
}
