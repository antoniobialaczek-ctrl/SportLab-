import { readFile, mkdir, rename, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { evaluateSport } from '../src/models/index.js';
import { validateHistory } from '../src/data/schema.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const generatedAt = new Date().toISOString();
const sports = {};
for (const sport of ['nba', 'football', 'nhl', 'tennis', 'cs2']) {
  let data = { schemaVersion: 1, events: [] };
  try { data = JSON.parse(await readFile(join(root, 'data', 'history', `${sport}.json`), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  validateHistory(data, sport);
  if (data.exclusions !== undefined && !Array.isArray(data.exclusions)) throw new Error(`Nieprawidłowa lista wykluczeń: ${sport}`);
  sports[sport] = await evaluateSport(sport, data.events, { now: generatedAt });
  sports[sport].dataQuality = {
    excludedRecords: data.exclusions?.length || 0,
    coverage: data.coverage ?? null,
    historyUpdatedAt: data.updatedAt ?? null,
  };
  if (data.exclusions?.length) {
    const warning = `Pominięto ${data.exclusions.length} nieprawidłowych rekordów źródła; próba jest niepełna.`;
    sports[sport].publication = { eligible: false, reasons: [...(sports[sport].publication?.reasons || []), warning] };
    if (sports[sport].status === 'validated') sports[sport].status = 'research';
    for (const league of sports[sport].leagues || []) {
      const count = data.exclusions.filter(row => row.route?.split('/').at(-1) === league.league).length;
      league.dataQuality = { excludedRecords: count, coverage: data.coverage ?? null, historyUpdatedAt: data.updatedAt ?? null };
      if (!count) continue;
      league.publication = { eligible: false, reasons: [...(league.publication?.reasons || []), `Pominięto ${count} nieprawidłowych rekordów źródła; próba jest niepełna.`] };
      if (league.status === 'validated') league.status = 'research';
    }
  }
  console.log(`${sport}: ${sports[sport].status} — ${sports[sport].reason || ''}`);
}
const directory = join(root, 'data', 'reports');
await mkdir(directory, { recursive: true });
const target = join(directory, 'models.json');
const temporary = `${target}.${process.pid}.tmp`;
try {
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, generatedAt, sports }, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, target);
} finally { await rm(temporary, { force: true }); }
console.log('Raport zapisany: data/reports/models.json');
