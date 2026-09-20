import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
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
export function startServer(root, port = 0, host = '127.0.0.1', tls = null) {
  const handler = async (request, response) => {
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
  };
  // With `tls` ({ key, cert }), the same fixtures are served over HTTPS so a
  // real ATS hostname can be mapped onto them (see ats/workday passive test).
  const server = tls ? createTlsServer(tls, handler) : createServer(handler);

  return new Promise((done) => {
    server.listen(port, host, () => {
      const address = server.address();
      done({
        origin: `${tls ? 'https' : 'http'}://${host}:${address.port}`,
        port: address.port,
        close: () => new Promise((closed) => server.close(closed)),
      });
    });
  });
}
