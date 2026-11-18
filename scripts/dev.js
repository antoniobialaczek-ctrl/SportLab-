import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = resolve(root, 'public');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Nieprawidłowy PORT.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    const api = /^\/api\/([a-z-]+)$/.exec(url.pathname);
    if (api) {
      const file = resolve(root, 'api', `${api[1]}.js`);
      try { if (!(await stat(file)).isFile()) throw new Error('Missing handler'); }
      catch { response.writeHead(404).end('Nie znaleziono API'); return; }
      request.query = Object.fromEntries([...new Set(url.searchParams.keys())].map(key => {
        const values = url.searchParams.getAll(key);
        return [key, values.length > 1 ? values : values[0]];
      }));
      response.status = function status(code) { this.statusCode = code; return this; };
      response.json = function json(value) { this.setHeader('Content-Type', 'application/json; charset=utf-8'); this.end(JSON.stringify(value)); return this; };
      const { default: handler } = await import(file);
      await handler(request, response);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const path = decodeURIComponent(url.pathname);
    const file = path === '/' || path === '/index.html' ? resolve(root, 'index.html') : resolve(publicRoot, path.slice(1));
    if (file !== resolve(root, 'index.html') && !file.startsWith(publicRoot + sep)) { response.writeHead(404).end(); return; }
    let content;
    try { content = await readFile(file); }
    catch { response.writeHead(404).end('Nie znaleziono'); return; }
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error('Żądanie zakończone błędem:', error.message);
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    if (!response.writableEnded) response.end(JSON.stringify({ error: 'Błąd serwera lokalnego' }));
  }
});
server.listen(port, '0.0.0.0', () => console.log(`SportLab: http://localhost:${port}`));
