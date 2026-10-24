import webpack from 'webpack';
import { loadDevConfig } from './dev-config.mjs';
import { createWebpackConfig } from '../apps/userscript/webpack.config.mjs';
import { startDevServer } from '../apps/dev-server/src/server.mjs';

const config = await loadDevConfig();
const server = await startDevServer(config);
const compiler = webpack(createWebpackConfig(config));
const watcher = compiler.watch({}, (error, stats) => {
  if (error) console.error(error);
  else if (stats?.hasErrors()) console.error(stats.toString({ colors: process.stdout.isTTY }));
  else console.log('Build ready. Runtime edits load automatically; bootstrap/metadata edits require reinstalling the userscript.');
});
console.log(`Install once in Tampermonkey: ${config.url}/install.user.js`);
console.log('Reports: reports/live/ | Request a report: npm run report | Connected tabs: npm run clients');

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => watcher.close(resolve));
  await new Promise((resolve) => compiler.close(resolve));
  await server.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
