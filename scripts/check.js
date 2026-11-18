import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['node_modules', '.git', '.vercel', 'dist', 'data']);
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter(entry => !ignored.has(entry.name)).map(async entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(?:js|cjs|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

for (const file of await files(root)) {
  const result = spawnSync(process.execPath, ['--check', resolve(file)], { stdio: 'inherit' });
  if (result.status !== 0 || result.error) {
    process.exitCode = 1;
    break;
  }
}
if (!process.exitCode) console.log('Składnia JavaScript: OK');
