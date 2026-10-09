import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.ttf': 'font/ttf' };

export function createServer(root, { prefix = '' } = {}) {
  const absoluteRoot = path.resolve(root);
  return http.createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (prefix) {
        if (!pathname.startsWith(`${prefix}/`) && pathname !== prefix) { response.writeHead(404).end('Not found'); return; }
        pathname = pathname.slice(prefix.length);
      }
      if (pathname.endsWith('/') || !pathname) pathname += 'index.html';
      const filename = path.resolve(absoluteRoot, `.${pathname}`);
      const relative = path.relative(absoluteRoot, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end('Forbidden'); return; }
      const info = await stat(filename);
      if (!info.isFile()) { response.writeHead(404).end('Not found'); return; }
      const headers = { 'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end(); return; }
        response.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${info.size}` });
        if (request.method === 'HEAD') response.end(); else createReadStream(filename, { start, end }).pipe(response);
      } else {
        response.writeHead(200, { ...headers, 'Content-Length': info.size });
        if (request.method === 'HEAD') response.end(); else createReadStream(filename).pipe(response);
      }
    } catch { response.writeHead(404).end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const port = Number(process.env.PORT || 4173);
  createServer(root).listen(port, '127.0.0.1', () => console.log(`Presentation library: http://127.0.0.1:${port}\nAfter adding PDFs locally, run npm run build and refresh.`));
}
