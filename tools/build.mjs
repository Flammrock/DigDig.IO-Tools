import webpack from 'webpack';
import { loadDevConfig } from './dev-config.mjs';
import { createWebpackConfig } from '../apps/userscript/webpack.config.mjs';

const compiler = webpack(createWebpackConfig(await loadDevConfig(), 'production'));
compiler.run((error, stats) => {
  compiler.close((closeError) => {
    if (error || closeError) console.error(error ?? closeError);
    if (stats) console.log(stats.toString({ colors: process.stdout.isTTY }));
    if (error || closeError || stats?.hasErrors()) process.exitCode = 1;
  });
});
