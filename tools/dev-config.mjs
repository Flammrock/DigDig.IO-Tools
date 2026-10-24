import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const rootDir = fileURLToPath(new URL('../', import.meta.url));

export async function loadDevConfig() {
  const stateDir = path.join(rootDir, '.local');
  await mkdir(stateDir, { recursive: true });
  const tokenPath = path.join(stateDir, 'dev-token');
  try {
    await writeFile(tokenPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid .local/dev-token. Restore it or delete it and reinstall the development userscript.');
  const port = Number(process.env.DIGDIG_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DIGDIG_PORT must be between 1024 and 65535.');
  return { rootDir, host: '127.0.0.1', port, token, url: `http://127.0.0.1:${port}` };
}
