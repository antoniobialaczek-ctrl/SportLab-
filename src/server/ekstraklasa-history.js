import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EKSTRAKLASA_SOURCE, isEkstraklasaId } from './ekstraklasa-source.js';

const localURL = new URL('../../data/supplemental/ekstraklasa.json', import.meta.url);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const REPOSITORY = 'antoniobialaczek-ctrl/SportLab-';
const BRANCH = 'sportlab-ekstraklasa-data';
let remoteCache = null;

export function validateEkstraklasaHistory(data) {
  if (!data || data.schemaVersion !== 1 || data.kind !== 'supplemental-descriptive-history' || data.route !== 'soccer/pol.1' || data.modelExperimentEligible !== false || !Array.isArray(data.events) || !date(data.fetchedAt)) throw new Error('Nieprawidłowa oddzielna historia Ekstraklasy');
  const ids = new Set();
  for (const row of data.events) {
    let url;
    try { url = new URL(row.source?.url); } catch { throw new Error('Brak źródła wyniku Ekstraklasy'); }
    if (!isEkstraklasaId(row.sourceEventId) || row.id !== `soccer/pol.1:${row.sourceEventId}` || ids.has(row.id)
      || !isEkstraklasaId(row.homeId) || !isEkstraklasaId(row.awayId) || row.homeId === row.awayId || row.route !== 'soccer/pol.1'
      || row.sport !== 'football' || row.league !== 'pol.1' || row.status !== 'completed' || row.state !== 'post'
      || ![row.home, row.away].every(value => typeof value === 'string' && value.trim() && value.length <= 200)
      || ![row.homeScore, row.awayScore].every(value => Number.isInteger(value) && value >= 0 && value <= 30)
      || ![row.startTime, row.firstObservedAt, row.resultAvailableAt, row.source?.fetchedAt].every(date)
      || row.availabilityBasis !== 'observed-result' || Date.parse(row.source.fetchedAt) < Date.parse(row.firstObservedAt)
      || Date.parse(row.source.fetchedAt) <= Date.parse(row.startTime)
      || Date.parse(row.source.fetchedAt) > Date.parse(data.fetchedAt)
      || Date.parse(row.resultAvailableAt) < Math.max(Date.parse(row.startTime) + 86400000, Date.parse(row.firstObservedAt))
      || row.source.provider !== 'TheSportsDB' || url.origin !== 'https://www.thesportsdb.com'
      || !['eventsday.php', 'lookupevent.php', 'eventslast.php'].some(path => url.pathname === `/api/v1/json/123/${path}`)
      || url.pathname.endsWith('/eventsday.php') && (url.searchParams.get('d') !== row.startTime.slice(0, 10) || url.searchParams.get('l') !== '4422')
      || url.pathname.endsWith('/lookupevent.php') && url.searchParams.get('id') !== row.sourceEventId.slice(5)
      || url.pathname.endsWith('/eventslast.php') && ![row.homeId, row.awayId].includes(`tsdb-${url.searchParams.get('id')}`)) throw new Error('Nieprawidłowy wynik lub pochodzenie Ekstraklasy');
    ids.add(row.id);
  }
  return data;
}

export function mergeEkstraklasaHistory(previous, incoming) {
  const events = new Map(previous.map(row => [row.id, row]));
  for (let row of incoming) {
    const old = events.get(row.id);
    if (old && ['homeId', 'awayId', 'route'].some(field => row[field] !== old[field])) throw new Error('Sprzeczna tożsamość obserwowanego meczu Ekstraklasy');
    if (old) {
      const changed = ['homeScore', 'awayScore', 'startTime'].some(field => row[field] !== old[field]);
      row = { ...row, firstObservedAt: old.firstObservedAt,
        resultAvailableAt: changed ? row.resultAvailableAt : old.resultAvailableAt,
        ...(old.revisions ? { revisions: old.revisions } : {}) };
      if (changed) row.revisions = [...(old.revisions || []), { observedAt: row.source.fetchedAt, previous: { homeScore: old.homeScore, awayScore: old.awayScore, startTime: old.startTime, resultAvailableAt: old.resultAvailableAt } }];
    }
    events.set(row.id, row);
  }
  return [...events.values()].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
}

export function validateEkstraklasaManifest(manifest, { now = Date.now(), allowStale = false } = {}) {
  const info = manifest?.files?.['ekstraklasa.json'];
  if (!manifest || manifest.schemaVersion !== 1 || manifest.repository !== REPOSITORY || manifest.branch !== BRANCH || manifest.source !== 'TheSportsDB'
    || !/^[a-f0-9]{40}$/.test(manifest.dataCommit || '') || !date(manifest.generatedAt)
    || Date.parse(manifest.generatedAt) > now + 300000 || !allowStale && Date.parse(manifest.generatedAt) < now - 2 * 86400000
    || !manifest.files || Object.keys(manifest.files).length !== 1 || !info || !/^[a-f0-9]{64}$/.test(info.sha256 || '')
    || !Number.isSafeInteger(info.bytes) || info.bytes < 2 || info.bytes > 4 * 1024 * 1024) throw new Error('Nieprawidłowy lub nieaktualny manifest Ekstraklasy');
  return manifest;
}

async function download(url, limit, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Aktualizacja Ekstraklasy: HTTP ${response.status}`);
    if (Number(response.headers?.get('content-length')) > limit) throw new Error('Przekroczony rozmiar aktualizacji Ekstraklasy');
    let bytes;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) { await reader.cancel(); throw new Error('Przekroczony rozmiar aktualizacji Ekstraklasy'); }
        chunks.push(Buffer.from(next.value));
      }
      bytes = Buffer.concat(chunks, size);
    } else {
      bytes = Buffer.from(await response.text());
      if (bytes.length > limit) throw new Error('Przekroczony rozmiar aktualizacji Ekstraklasy');
    }
    return bytes;
  } finally { clearTimeout(timer); }
}

export async function readPublishedEkstraklasa({ fetchImpl = globalThis.fetch, now = Date.now(), allowStale = false } = {}) {
  const manifestBytes = await download(`https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}/manifest.json`, 32768, fetchImpl);
  const manifest = validateEkstraklasaManifest(JSON.parse(manifestBytes.toString('utf8')), { now, allowStale });
  const info = manifest.files['ekstraklasa.json'];
  const bytes = await download(`https://raw.githubusercontent.com/${REPOSITORY}/${manifest.dataCommit}/ekstraklasa.json`, info.bytes, fetchImpl);
  if (bytes.length !== info.bytes || createHash('sha256').update(bytes).digest('hex') !== info.sha256) throw new Error('Niezgodny skrót lub rozmiar aktualizacji Ekstraklasy');
  const data = validateEkstraklasaHistory(JSON.parse(bytes.toString('utf8')));
  if (!date(data.fetchedAt) || Date.parse(data.fetchedAt) > now + 300000 || Date.parse(data.fetchedAt) > Date.parse(manifest.generatedAt)
    || data.events.some(row => Date.parse(row.source.fetchedAt) > Date.parse(data.fetchedAt))) throw new Error('Niezgodny czas aktualizacji Ekstraklasy');
  return { ...data, runtimeData: { origin: 'github', fallback: false, publishedAt: manifest.generatedAt, dataCommit: manifest.dataCommit } };
}

export async function loadEkstraklasaHistory({ teamIds = [], now = Date.now(), fetchImpl = globalThis.fetch, historyData, historyURL = localURL,
  remote = process.env.SPORTLAB_REMOTE_DATA !== '0' && (Boolean(process.env.VERCEL) || process.env.SPORTLAB_REMOTE_DATA === '1') } = {}) {
  if (!Number.isFinite(now) || !Array.isArray(teamIds) || teamIds.length > 2 || !teamIds.every(isEkstraklasaId)) throw new Error('Nieprawidłowe parametry historii Ekstraklasy');
  let local, localError = null, remoteError = null;
  if (remote) {
    try {
      if (!remoteCache || remoteCache.fetchImpl !== fetchImpl || now < remoteCache.at || now - remoteCache.at >= 300000) {
        const promise = readPublishedEkstraklasa({ fetchImpl, now }).then(data => ({ data }), () => ({ error: 'Automatyczna aktualizacja Ekstraklasy jest niedostępna lub nie przeszła weryfikacji.' }));
        remoteCache = { at: now, fetchImpl, promise };
      }
      const result = await remoteCache.promise;
      if (result.data) local = result.data;
      else remoteError = result.error;
    } catch { remoteError = 'Automatyczna aktualizacja Ekstraklasy jest chwilowo niedostępna.'; }
  }
  if (!local) {
  try { local = validateEkstraklasaHistory(historyData || JSON.parse(await readFile(historyURL, 'utf8'))); }
  catch (error) { localError = error.message; local = { events: [], fetchedAt: null, coverage: { complete: false } }; }
  }
  return {
    events: local.events, fetchedAt: local.fetchedAt, source: EKSTRAKLASA_SOURCE, status: local.events.length ? 'available' : 'unavailable',
    coverage: { ...local.coverage, complete: false }, localError, remoteError, usingLocalFallback: Boolean(remoteError),
    runtimeData: local.runtimeData || { origin: 'local', fallback: Boolean(remoteError), ...(remoteError ? { reason: remoteError } : {}) },
    modelExperimentEligible: false,
  };
}
