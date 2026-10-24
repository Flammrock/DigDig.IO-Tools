import { loadDevConfig } from './dev-config.mjs';

const [command, clientId] = process.argv.slice(2);
if (!['clients', 'report', 'reload', 'ping'].includes(command)) {
  console.error('Usage: node tools/control.mjs clients|report|reload|ping [clientId]');
  process.exitCode = 1;
} else {
  try {
    const { url, token } = await loadDevConfig();
    const response = await fetch(`${url}/${command === 'clients' ? 'clients' : 'command'}`, {
      method: command === 'clients' ? 'GET' : 'POST',
      headers: { 'X-DigDig-Token': token, 'Content-Type': 'application/json' },
      ...(command === 'clients' ? {} : { body: JSON.stringify({ type: command, ...(clientId ? { clientId } : {}) }) }),
      signal: AbortSignal.timeout(5000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Could not contact the development server. Start npm run dev first. ${error.message}`);
    process.exitCode = 1;
  }
}
