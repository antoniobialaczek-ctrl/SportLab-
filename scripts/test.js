import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = (await readdir(new URL('../tests/', import.meta.url))).filter(file => file.endsWith('.test.js')).sort().map(file => `tests/${file}`);
// Unit/API fixtures must remain isolated from live data in Vercel builds too.
// Remote storage itself is covered with injected transport and integrity tests.
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, SPORTLAB_REMOTE_DATA: '0' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
