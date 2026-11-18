import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const html = await readFile(join(root, 'index.html'), 'utf8');
if (!html.includes('SportLab') || !html.includes('id="cards"')) throw new Error('Brak istniejącego interfejsu SportLab.');
for (const [, target] of html.matchAll(/(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
  const asset = resolve(root, 'public', target.slice(1));
  if (!asset.startsWith(resolve(root, 'public') + sep) || !(await stat(asset)).isFile()) {
    throw new Error(`Brak zasobu: ${target}`);
  }
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'public'), output, { recursive: true });
await writeFile(join(output, 'index.html'), html);
console.log('Zbudowano dist/; funkcje api/ wdraża natywnie Vercel.');
