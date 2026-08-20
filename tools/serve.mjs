/**
 * Zero-dependency static file server for local development.
 *
 * ES modules require an HTTP origin — opening index.html from the file system
 * fails the module CORS check — so this exists purely to serve the folder.
 * It is a development convenience, not part of the application.
 *
 *   node tools/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.argv[2]) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requested = decodeURIComponent(url.pathname);

  // Reject anything that tries to escape the served directory.
  const target = resolve(join(root, normalize(requested)));
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    await stat(filePath);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, () => {
  console.log(`Nota is running at http://localhost:${port}`);
});
