import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../data/', import.meta.url);
const checkpoint = JSON.parse(await readFile(new URL('forward/checkpoint.json', root), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (checkpoint.schemaVersion !== 1 || checkpoint.integrityVerified !== true
  || sha(await readFile(new URL('forward/state.json', root))) !== checkpoint.stateSha256
  || sha(await readFile(new URL('reports/forward.json', root))) !== checkpoint.reportSha256) {
  throw new Error('Brak poprawnie zweryfikowanego punktu kontrolnego. Poprzednich archiwów nie wolno zastąpić ani usunąć.');
}
console.log('Sprawdzono spójny punkt kontrolny po audycie dowodów.');
