import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import workspacePackage from '../../package.json' with { type: 'json' };

const tokenPath = fileURLToPath(new URL('../../.local/dev-token', import.meta.url));

// Browser preview uses a same-origin server endpoint. The bridge token never
// enters browser source, URLs, or Vite's client environment.
function localTelemetry() {
  return {
    name: 'digdig-local-telemetry',
    configureServer(server) {
      server.middlewares.use('/api', async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        const route = new URL(request.url, 'http://127.0.0.1:4318');
        const allowed = (request.method === 'GET' && ['/telemetry', '/settings'].includes(route.pathname))
          || (request.method === 'POST' && ['/settings', '/telemetry/clear', '/telemetry/merge',
            '/telemetry/delete', '/telemetry/markers', '/telemetry/cleanup'].includes(route.pathname));
        if (!allowed || !['127.0.0.1:4318', 'localhost:4318'].includes(request.headers.host)
          || (request.headers.origin && !['http://127.0.0.1:4318', 'http://localhost:4318'].includes(request.headers.origin))) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'Local viewer requests only.' }));
          return;
        }
        try {
          let body;
          if (request.method === 'POST') {
            if (request.headers['content-type']?.split(';', 1)[0] !== 'application/json') {
              response.statusCode = 415;
              response.end(JSON.stringify({ error: 'Expected a JSON request.' }));
              return;
            }
            const chunks = [];
            let length = 0;
            const limit = route.pathname === '/telemetry/merge' ? 64 * 1024 * 1024
              : route.pathname === '/telemetry/delete' ? 384 * 1024 : 4096;
            for await (const chunk of request) {
              length += chunk.length;
              if (length > limit) {
                response.statusCode = 413;
                response.end(JSON.stringify({ error: 'Request is too large.' }));
                return;
              }
              chunks.push(chunk);
            }
            body = Buffer.concat(chunks).toString('utf8');
          }
          const token = (await readFile(tokenPath, 'utf8')).trim();
          const upstream = await fetch(`http://127.0.0.1:4317${route.pathname}${route.search}`, {
            method: request.method,
            headers: { 'X-DigDig-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body }),
            redirect: 'error',
            signal: AbortSignal.timeout(2500),
          });
          response.statusCode = upstream.status;
          response.end(await upstream.text());
        } catch {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: 'Start the userscript bridge with npm run dev.' }));
        }
      });
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(workspacePackage.version) },
  plugins: [localTelemetry()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 4318,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { outDir: '../../dist/desktop', emptyOutDir: true, target: 'es2022' },
});
