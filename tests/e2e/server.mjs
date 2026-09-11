import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

/**
 * Static server for the test pages.
 *
 * Extensions cannot be injected into `file://` URLs without permissions
 * Fillwright deliberately does not request, so the end-to-end run serves the
 * fixtures over http://localhost — the same way a real application form is
 * served.
 */
export function startServer(root, port = 0) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      // Normalise before resolving so "../" cannot escape the fixture folder.
      const target = resolve(root, `.${normalize(path)}`);
      if (!target.startsWith(resolve(root))) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(target);
      response.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'text/plain' });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });

  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      done({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closed) => server.close(closed)),
      });
    });
  });
}
