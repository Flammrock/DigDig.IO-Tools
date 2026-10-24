import { createHash, randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { LayoutCache, validCacheEntry, validHash, SCHEMA_VERSION } from './layout-cache.mjs';

export const RESOLVER_VERSION = 'wasm-patterns-1';
export const MAX_WASM_BYTES = 8 * 1024 * 1024;
export const MAX_LAYOUT_BODY_BYTES = 12 * 1024 * 1024;
const TTL = 10 * 60 * 1000, JOB_TIMEOUT = 45_000, MAX_JOBS = 8, MAX_TICKETS = 128;
const id = () => randomBytes(24).toString('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class LayoutError extends Error { constructor(message) { super(message); this.status = 400; } }
function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new LayoutError('Unsupported layout request fields.');
}
function identity(body) {
  if (typeof body.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.clientId)) throw new LayoutError('Invalid layout client.');
  if (!validHash(body.wasmSha256)) throw new LayoutError('Invalid WASM SHA-256.');
  return [body.clientId, body.wasmSha256];
}
function proof(value = {}) {
  if (!object(value) || Buffer.byteLength(JSON.stringify(value)) > 16 * 1024) throw new LayoutError('Resolver evidence must be a bounded object.');
  return value;
}
function decode(encoded, hash) {
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_WASM_BYTES / 3) * 4
    || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new LayoutError('WASM upload is not valid bounded base64.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new LayoutError('WASM upload is not valid base64.');
  if (bytes.length < 8 || bytes.length > MAX_WASM_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([0,97,115,109,1,0,0,0]))) throw new LayoutError('Expected an original WASM module of at most 8 MiB.');
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new LayoutError('WASM upload does not match its SHA-256.');
  return bytes;
}

export class LayoutService {
  #cache;
  #jobs = new Map();
  #tickets = new Map();
  #now;
  #tail = Promise.resolve();
  #worker;
  #closed = false;
  #analyze;
  constructor(rootDir, { now = Date.now, analyze } = {}) {
    this.#cache = new LayoutCache(path.join(rootDir, '.local/layout-cache'));
    this.#now = now;
    // Injection is for isolated service tests. Normal requests always use Worker.
    this.#analyze = analyze;
  }
  #serial(operation) { const result = this.#tail.then(operation); this.#tail = result.catch(() => {}); return result; }
  #prune() {
    const now = this.#now();
    for (const [hash, job] of this.#jobs) {
      if (now - job.touched > TTL) this.#jobs.delete(hash);
      else if (['queued', 'running'].includes(job.status) && now - job.created > JOB_TIMEOUT) {
        job.status = 'unsupported'; job.message = 'WASM analysis timed out. Restart the desktop app to retry.';
        job.evidence = { reason: 'timeout' }; delete job.bytes;
      }
    }
    for (const [key, ticket] of this.#tickets) if (now - ticket.touched > TTL || !this.#jobs.has(ticket.hash)) this.#tickets.delete(key);
  }
  resolve(body) {
    return this.#serial(async () => {
      fields(body, ['clientId', 'wasmSha256', 'wasmBase64']);
      const [client, hash] = identity(body);
      if (body.wasmBase64 !== undefined && (typeof body.wasmBase64 !== 'string' || body.wasmBase64.length > Math.ceil(MAX_WASM_BYTES / 3) * 4)) throw new LayoutError('WASM upload exceeds the 8 MiB limit or is not base64 text.');
      this.#prune();
      let job = this.#jobs.get(hash);
      if (!job) {
        if (this.#jobs.size >= MAX_JOBS) throw new LayoutError('Too many layout builds are being retained. Retry after old requests expire.');
        const entry = await this.#cache.get(hash, RESOLVER_VERSION).catch(() => null);
        if (entry) job = { id: id(), created: this.#now(), touched: this.#now(), status: 'candidate', layout: entry.layout, evidence: { cached: true }, origin: 'cache', cached: true };
        else if (body.wasmBase64 !== undefined) job = { id: id(), created: this.#now(), touched: this.#now(), status: 'queued', bytes: decode(body.wasmBase64, hash) };
        else return { status: 'needs-bytes', resolverVersion: RESOLVER_VERSION };
        this.#jobs.set(hash, job);
      }
      job.touched = this.#now();
      if (['queued', 'running'].includes(job.status)) { this.#pump(); return { status: 'pending', resolverVersion: RESOLVER_VERSION }; }
      if (job.status === 'unsupported') return { status: 'unsupported', resolverVersion: RESOLVER_VERSION, message: job.message, evidence: job.evidence };
      let ticket = [...this.#tickets].find(([, value]) => value.client === client && value.hash === hash)?.[0];
      if (ticket) this.#tickets.get(ticket).touched = this.#now();
      else {
        if (this.#tickets.size >= MAX_TICKETS) throw new LayoutError('Too many pending layout validation sessions.');
        ticket = id(); this.#tickets.set(ticket, { client, hash, touched: this.#now() });
      }
      return { status: 'candidate', resolverVersion: RESOLVER_VERSION, ticket, origin: job.origin, layout: job.layout, evidence: job.evidence };
    });
  }
  #finish(hash, job, result) {
    if (this.#closed || this.#jobs.get(hash) !== job || job.status !== 'running') return;
    try {
      fields(result, ['status', 'layout', 'evidence', 'message']);
      if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) throw new LayoutError('Resolver result is too large.');
      const evidence = proof(result.evidence);
      if (result.status === 'candidate') {
        const entry = { schemaVersion: SCHEMA_VERSION, wasmSha256: hash, resolverVersion: RESOLVER_VERSION, resolvedAtUnixMs: this.#now(), layout: result.layout };
        if (!validCacheEntry(entry)) throw new LayoutError('Resolver returned an invalid layout recipe.');
        Object.assign(job, { status: 'candidate', layout: result.layout, evidence, origin: 'resolved', cached: false });
      } else if (result.status === 'unsupported') {
        Object.assign(job, { status: 'unsupported', evidence, message: typeof result.message === 'string' && result.message.length && Buffer.byteLength(result.message) <= 1024 ? result.message : 'No unique supported layout was resolved for this game build.' });
      } else throw new LayoutError('Unsupported resolver result status.');
    } catch (error) { Object.assign(job, { status: 'unsupported', message: String(error.message).slice(0, 1024), evidence: { reason: 'invalid-result' } }); }
    job.touched = this.#now();
  }
  #pump() {
    if (this.#worker || this.#closed) return;
    const pair = [...this.#jobs].find(([, job]) => job.status === 'queued'); if (!pair) return;
    const [hash, job] = pair, bytes = job.bytes;
    delete job.bytes; job.status = 'running';
    let timer, worker, settled = false;
    const done = result => {
      if (settled) return; settled = true;
      clearTimeout(timer); void worker?.terminate();
      this.#worker = undefined;
      this.#finish(hash, job, result); this.#pump();
    };
    this.#worker = { cancel: () => done({ status: 'unsupported', message: 'Layout analysis was stopped.', evidence: {} }) };
    timer = setTimeout(() => done({ status: 'unsupported', message: 'WASM analysis exceeded the 30-second limit.', evidence: { reason: 'timeout' } }), 30_000);
    if (this.#analyze) {
      Promise.resolve().then(() => this.#analyze(bytes)).then(done, error => done({ status: 'unsupported', message: String(error).slice(0, 1024), evidence: { reason: 'analysis-error' } }));
    } else {
      try {
        const copy = Uint8Array.from(bytes);
        worker = new Worker(new URL('./layout-worker.mjs', import.meta.url), { workerData: copy.buffer, transferList: [copy.buffer], resourceLimits: { maxOldGenerationSizeMb: 256 } });
        worker.once('message', done);
        worker.once('error', error => done({ status: 'unsupported', message: `WASM analysis failed: ${error.message}`.slice(0, 1024), evidence: { reason: 'worker-error' } }));
        worker.once('exit', code => { if (!settled) done({ status: 'unsupported', message: `WASM analysis worker exited (${code}).`, evidence: { reason: 'worker-exit' } }); });
      } catch (error) { done({ status: 'unsupported', message: String(error).slice(0, 1024), evidence: { reason: 'worker-error' } }); }
    }
  }
  validate(body) {
    return this.#serial(async () => {
      fields(body, ['clientId', 'wasmSha256', 'resolverVersion', 'ticket', 'evidence']);
      const [client, hash] = identity(body);
      if (body.resolverVersion !== RESOLVER_VERSION) throw new LayoutError('Layout resolver version changed. Resolve the build again.');
      fields(body.evidence, ['samples', 'tiles']);
      if (!Number.isInteger(body.evidence.samples) || body.evidence.samples < 3 || body.evidence.samples > 1_000_000
        || !Number.isInteger(body.evidence.tiles) || body.evidence.tiles < 2 || body.evidence.tiles > 100_000) throw new LayoutError('A layout needs at least three runtime samples and two distinct terrain placements.');
      this.#prune();
      const ticket = this.#tickets.get(body.ticket), job = this.#jobs.get(hash);
      if (!ticket || ticket.client !== client || ticket.hash !== hash || job?.status !== 'candidate') throw new LayoutError('Layout validation session expired or belongs to another client. Resolve the build again.');
      if (job.cached) return { cached: true };
      const entry = { schemaVersion: SCHEMA_VERSION, wasmSha256: hash, resolverVersion: RESOLVER_VERSION, resolvedAtUnixMs: this.#now(), layout: job.layout };
      try { await this.#cache.putValidated(entry); job.cached = true; return { cached: true }; }
      catch (error) { return { cached: false, message: String(error.message).slice(0, 1024) }; }
    });
  }
  close() { this.#closed = true; this.#worker?.cancel(); this.#jobs.clear(); this.#tickets.clear(); }
}
