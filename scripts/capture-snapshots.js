import { fileURLToPath } from 'node:url';
import { captureSnapshots } from '../src/data/snapshots.js';

function options(argv) {
  const args = {};
  const known = new Set(['--from', '--to', '--sports', '--routes', '--concurrency']);
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!known.has(key) || !argv[index + 1] || argv[index + 1].startsWith('--') || Object.hasOwn(args, key.slice(2))) throw new Error(`Nieznany, powtórzony lub niepełny argument: ${key}`);
    args[key.slice(2)] = argv[++index];
  }
  if (args.sports) args.sports = args.sports.split(',');
  if (args.routes) args.routes = args.routes.split(',');
  if (args.concurrency) args.concurrency = Number(args.concurrency);
  const midnight = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  args.from ??= new Date(midnight - 86_400_000).toISOString().slice(0, 10);
  args.to ??= new Date(midnight + 86_400_000).toISOString().slice(0, 10);
  return args;
}

try {
  const result = await captureSnapshots({ root: fileURLToPath(new URL('../data/', import.meta.url)), ...options(process.argv.slice(2)), onProgress: row => process.stderr.write(JSON.stringify(row) + '\n') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.hasErrors) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Obserwacja przedmeczowa przerwana: ${error.message}\n`);
  process.exitCode = 1;
}
