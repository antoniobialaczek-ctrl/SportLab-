import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Keep the exact computation, model definitions and scoring rules together.
// The hash is calculated once from deployed source, not from mutable flags.
const SOURCES = ['fingerprint.js', 'index.js', 'nba.js', 'football.js', 'nhl.js', 'tennis.js', 'utils.js', 'metrics.js'];
const hash = createHash('sha256');
for (const name of SOURCES) {
  hash.update(name + '\0');
  hash.update(readFileSync(new URL(name, import.meta.url)));
  hash.update('\0');
}
export const MODEL_CODE_FINGERPRINT = hash.digest('hex');
