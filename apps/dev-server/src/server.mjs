import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { renderFixture } from './fixture.mjs';
import { TelemetryError, TelemetryStore } from './telemetry.mjs';
import { loadViewerSettings, SettingsError } from './settings.mjs';
import { LayoutService, LayoutError, MAX_LAYOUT_BODY_BYTES } from './layout-service.mjs';

export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_MERGE_BODY_BYTES = 64 * 1024 * 1024;
const MAX_CLIENTS = 128;
const MAX_COMMANDS_PER_CLIENT = 128;
const CLIENT_TTL_MS = 5 * 60 * 1000;
const COMMAND_TYPES = new Set(['report', 'reload', 'ping']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function clientId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new HttpError(400, 'clientId must contain 1–80 letters, digits, underscores, or hyphens.');
  }
  return value;
}

function readJson(request, maximumBytes = MAX_BODY_BYTES) {
  const tooLarge = `Request body exceeds ${maximumBytes / (1024 * 1024)} MiB.`;
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    return Promise.reject(new HttpError(415, 'Content-Type must be application/json.'));
  }
  if (Number(request.headers['content-length']) > maximumBytes) {
    request.resume();
    return Promise.reject(new HttpError(413, tooLarge));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maximumBytes) {
        settled = true;
        chunks.length = 0;
        reject(new HttpError(413, tooLarge));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Expected a JSON object.');
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, 'Request body must be a JSON object.'));
      }
    });
    request.on('error', () => {
      if (settled) return;
      settled = true;
      reject(new HttpError(400, 'Request body could not be read.'));
    });
    request.on('aborted', () => {
      if (settled) return;
      settled = true;
      reject(new HttpError(400, 'Request was aborted.'));
    });
  });
}

/**
 * Start the local userscript development bridge. All commands and reports use a
 * shared token injected into the installed development userscript by the build.
 * No game code is executed by this server.
 */
export async function startDevServer({
  rootDir,
  host = '127.0.0.1',
  port = 4317,
  token,
  distDir = path.join(rootDir, 'dist/userscript'),
  reportsDir = path.join(rootDir, 'reports/live'),
  now = Date.now,
} = {}) {
  if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) {
    throw new TypeError('rootDir must be an absolute path.');
  }
  if (!['127.0.0.1', '::1'].includes(host)) {
    throw new TypeError('The development server must bind to a loopback IP address.');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('port must be an integer between 0 and 65535.');
  }
  if (typeof token !== 'string' || token.length < 16 || token.length > 1024) {
    throw new TypeError('token must be a string containing 16–1024 characters.');
  }

  const expectedToken = digest(token);
  const serverId = randomUUID();
  const clients = new Map();
  const settings = await loadViewerSettings(rootDir);
  const telemetry = new TelemetryStore({ now, autoReconnect: () => settings.snapshot().autoReconnect });
  const layouts = new LayoutService(rootDir);
  let captureEpoch = Date.now();
  let nextCommandId = 0;
  let shutdown;

  function pruneClients() {
    const oldest = Date.now() - CLIENT_TTL_MS;
    for (const [id, client] of clients) {
      if (client.lastSeen < oldest) clients.delete(id);
    }
  }

  function ensureClient(id) {
    let client = clients.get(id);
    if (!client) {
      if (clients.size >= MAX_CLIENTS) throw new HttpError(429, 'Too many development clients.');
      client = { clientId: id, firstSeen: Date.now(), lastSeen: Date.now(), commands: [] };
      clients.set(id, client);
    }
    return client;
  }

  function localOriginAllowed(request) {
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite && !['none', 'same-origin'].includes(fetchSite)) return false;
    if (!request.headers.origin) return true;
    try {
      const origin = new URL(request.headers.origin);
      return origin.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(origin.hostname)
        && Number(origin.port || '80') === server.address().port;
    } catch {
      return false;
    }
  }

  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    try {
      if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress)) {
        throw new HttpError(403, 'Only loopback clients are allowed.');
      }
      let requestHost;
      try {
        requestHost = new URL(`http://${request.headers.host}`);
      } catch {
        throw new HttpError(403, 'Invalid Host header.');
      }
      if (!LOOPBACK_HOSTNAMES.has(requestHost.hostname) || requestHost.username || requestHost.password
        || requestHost.pathname !== '/' || requestHost.search || requestHost.hash
        || Number(requestHost.port || '80') !== server.address().port) {
        throw new HttpError(403, 'Host must name this loopback server.');
      }
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
        throw new HttpError(400, 'Expected a local request path.');
      }
      const url = new URL(request.url, requestHost);
      if (request.method === 'OPTIONS') {
        throw new HttpError(403, 'Use the userscript manager bridge; page-origin CORS is not enabled.');
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, { ok: true, serverId });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/') {
        if (!localOriginAllowed(request)) throw new HttpError(403, 'Open this address directly in your browser.');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>DigDig development bridge</title><h1>DigDig development bridge</h1><p><a href="/install.user.js">Install the development userscript</a></p><p><a href="/fixture">Run the local WASM smoke test</a></p><p>Keep the development process running, then open the game. Reports are saved under reports/live.</p></html>');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/fixture') {
        if (!localOriginAllowed(request)) throw new HttpError(403, 'Open the fixture address directly in your browser.');
        const nonce = randomUUID().replaceAll('-', '');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; frame-ancestors 'none'`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(renderFixture(nonce));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/install.user.js') {
        if (!localOriginAllowed(request)) throw new HttpError(403, 'Open the install address directly in your browser.');
        let script;
        try {
          script = await readFile(path.join(distDir, 'dev.user.js'), 'utf8');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          throw new HttpError(503, 'The development userscript has not been built yet.');
        }
        response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        response.end(script);
        return;
      }

      const receivedToken = request.headers['x-digdig-token'];
      if (typeof receivedToken !== 'string' || !timingSafeEqual(digest(receivedToken), expectedToken)) {
        throw new HttpError(401, 'A valid X-DigDig-Token header is required.');
      }
      pruneClients();

      if (request.method === 'POST' && url.pathname === '/layouts/resolve') {
        json(response, 200, await layouts.resolve(await readJson(request, MAX_LAYOUT_BODY_BYTES)));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/layouts/validate') {
        json(response, 200, await layouts.validate(await readJson(request)));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/bundle') {
        let code;
        try {
          code = await readFile(path.join(distDir, 'runtime.js'), 'utf8');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          throw new HttpError(503, 'The runtime bundle has not been built yet.');
        }
        // A settings change replaces only the local runtime through the already
        // installed loader. It does not change the bootstrap or the game's WASM.
        code = `var __DIGDIG_RUNTIME_SETTINGS__ = ${JSON.stringify({ updateIntervalMs: settings.snapshot().updateIntervalMs, captureEpoch })};\n${code}`;
        json(response, 200, { revision: createHash('sha256').update(code).digest('hex'), code });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/events') {
        const id = clientId(url.searchParams.get('clientId'));
        const rawAfter = url.searchParams.get('after') ?? '0';
        const after = Number(rawAfter);
        if (!/^\d+$/.test(rawAfter) || !Number.isSafeInteger(after)) {
          throw new HttpError(400, 'after must be a nonnegative safe integer.');
        }
        const client = ensureClient(id);
        client.lastSeen = Date.now();
        json(response, 200, {
          serverId,
          latestId: nextCommandId,
          commands: client.commands.filter((command) => command.id > after),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/clients') {
        json(response, 200, {
          serverId,
          clients: [...clients.values()].map(({ clientId, firstSeen, lastSeen }) => ({ clientId, firstSeen, lastSeen })),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/telemetry') {
        const id = url.searchParams.has('clientId') ? clientId(url.searchParams.get('clientId')) : undefined;
        const rawSince = url.searchParams.get('since');
        const since = rawSince !== null && /^\d+$/.test(rawSince) && url.searchParams.get('serverId') === serverId
          ? Number(rawSince) : undefined;
        json(response, 200, { serverId, ...telemetry.read({ clientId: id, since }) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/telemetry/clear') {
        const body = await readJson(request);
        const id = clientId(body.clientId);
        telemetry.clear(id);
        captureEpoch++;
        json(response, 200, { cleared: true, clientId: id });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/telemetry/cleanup') {
        const body = await readJson(request);
        if (Object.keys(body).length !== 0) throw new HttpError(400, 'Session cleanup expects an empty object.');
        const removed = telemetry.cleanupInactiveGames();
        for (const id of removed) clients.delete(id);
        json(response, 200, { removed });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/telemetry/merge') {
        const body = await readJson(request, MAX_MERGE_BODY_BYTES);
        const id = clientId(body.clientId);
        json(response, 200, { merged: true, clientId: id, ...telemetry.merge(id, body.document) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/telemetry/delete') {
        const body = await readJson(request);
        const id = clientId(body.clientId);
        json(response, 200, { deleted: true, clientId: id, ...telemetry.deleteItems(id, body) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/telemetry/markers') {
        const body = await readJson(request);
        const id = clientId(body.clientId);
        json(response, 200, { saved: true, clientId: id, marker: telemetry.saveMarker(id, body.marker) });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/settings') {
        json(response, 200, settings.snapshot());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/settings') {
        const body = await readJson(request);
        json(response, 200, await settings.update(body));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/command') {
        const body = await readJson(request);
        if (!COMMAND_TYPES.has(body.type)) throw new HttpError(400, 'type must be report, reload, or ping.');
        const recipients = body.clientId === undefined
          ? [...clients.values()]
          : [ensureClient(clientId(body.clientId))];
        const command = { id: ++nextCommandId, type: body.type };
        for (const client of recipients) {
          client.commands.push(command);
          if (client.commands.length > MAX_COMMANDS_PER_CLIENT) client.commands.shift();
        }
        json(response, 202, { serverId, command, recipients: recipients.length });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/reports') {
        const body = await readJson(request);
        const id = clientId(body.clientId);
        if (typeof body.kind !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(body.kind)) {
          throw new HttpError(400, 'kind must contain 1–80 letters, digits, underscores, dots, or hyphens.');
        }
        if (typeof body.report !== 'string' && (body.report === null || typeof body.report !== 'object')) {
          throw new HttpError(400, 'report must be an object or a string.');
        }
        if (body.kind === 'map-frame') {
          // Keep high-frequency map updates out of reports/live. Existing installed
          // bootstraps can use report() without gaining a new transport capability.
          if (!clients.has(id) && clients.size >= MAX_CLIENTS) throw new HttpError(429, 'Too many development clients.');
          telemetry.update(id, body.report);
          const client = ensureClient(id);
          client.lastSeen = Date.now();
          json(response, 202, { filename: 'live map telemetry' });
          return;
        }
        const client = ensureClient(id);
        const receivedAt = new Date().toISOString();
        const basename = `${receivedAt.replace(/[:.]/g, '-')}-${randomUUID()}.txt`;
        const filePath = path.join(reportsDir, basename);
        const report = {
          receivedAt,
          serverId,
          clientId: id,
          kind: body.kind,
          report: body.report,
        };
        await mkdir(reportsDir, { recursive: true });
        await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        client.lastSeen = Date.now();
        json(response, 201, { filename: path.relative(rootDir, filePath).split(path.sep).join('/') });
        return;
      }
      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      const expectedError = error instanceof HttpError || error instanceof TelemetryError || error instanceof SettingsError || error instanceof LayoutError;
      json(response, expectedError ? error.status : 500, {
        error: expectedError ? error.message : 'The development server could not complete this request.',
      });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 2_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
  return {
    server,
    address,
    url,
    close() {
      layouts.close();
      shutdown ??= new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return shutdown;
    },
  };
}
