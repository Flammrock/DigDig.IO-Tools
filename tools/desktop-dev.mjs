import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadDevConfig } from './dev-config.mjs';

const config = await loadDevConfig();
if (config.port !== 4317) throw new Error('The desktop development bridge currently uses port 4317. Unset DIGDIG_PORT.');
const children = new Set();
let stopping = false;
function launch(args, cwd = config.rootDir) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}
async function bridgeReady() {
  try {
    const response = await fetch(`${config.url}/telemetry`, {
      headers: { 'X-DigDig-Token': config.token }, signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) throw new Error(`Existing bridge returned HTTP ${response.status}. Restart npm run dev to load the current server.`);
    const value = await response.json();
    if (!value.serverId || !Array.isArray(value.clients)) throw new Error('Unexpected service on the development bridge port.');
    return true;
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw error;
  }
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      // Only process trees this launcher started; a reused bridge is never terminated.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
try {
  if (!(await bridgeReady())) {
    console.log('Starting userscript watch and local bridge...');
    const bridge = launch(['tools/dev.mjs']);
    bridge.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
    let ready = false;
    for (let attempt = 0; attempt < 80 && !stopping; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (await bridgeReady()) { ready = true; break; }
    }
    if (!ready) throw new Error('The local bridge did not start.');
  } else console.log('Using the running userscript bridge at http://127.0.0.1:4317');
  const require = createRequire(import.meta.url);
  const nxPackagePath = require.resolve('nx/package.json');
  const nxBin = path.resolve(path.dirname(nxPackagePath), require(nxPackagePath).bin.nx);
  const desktop = launch([nxBin, 'run', 'desktop:dev']);
  desktop.on('exit', (code) => stop(code ?? 0));
} catch (error) {
  console.error(String(error));
  stop(1);
}
