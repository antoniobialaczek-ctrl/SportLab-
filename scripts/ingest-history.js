import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ingestHistory } from '../src/data/history.js';

function parseArgs(argv) {
  const options = {};
  const known = new Set(['--from', '--to', '--sports', '--routes', '--concurrency']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--dry-run') { options.dryRun = true; continue; }
    if (!known.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Nieznany lub niepełny argument: ${key}`);
    if (Object.hasOwn(options, key.slice(2))) throw new Error(`Powtórzony argument: ${key}`);
    options[key.slice(2)] = argv[++i];
  }
  if (options.sports) options.sports = options.sports.split(',');
  if (options.routes) options.routes = options.routes.split(',');
  if (options.concurrency) options.concurrency = Number(options.concurrency);
  const today = new Date();
  const midnight = Date.parse(today.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  options.from ??= new Date(midnight - 7 * 86_400_000).toISOString().slice(0, 10);
  options.to ??= new Date(midnight - 86_400_000).toISOString().slice(0, 10);
  return options;
}

try {
  const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'data/history');
  const options = parseArgs(process.argv.slice(2));
  let requests = 0;
  const report = await ingestHistory({ root, ...options, onProgress: event => {
    requests++;
    if (event.error || event.rejected || requests % 50 === 0) process.stderr.write(JSON.stringify({ requests, ...event }) + '\n');
  } });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.hasErrors) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Pobieranie historii przerwane: ${error.message}\n`);
  process.exitCode = 1;
}
