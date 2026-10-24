import path from 'node:path';
import { readFileSync } from 'node:fs';
import webpack from 'webpack';
import { UserscriptPlugin } from '@digdig/userscript-webpack-plugin';
import { TROUBLESHOOTING_GUIDE } from './src/troubleshooting.ts';

const workspaceVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

function troubleshootingBanner() {
  return new webpack.BannerPlugin({
    banner: `/*\n${TROUBLESHOOTING_GUIDE}\n*/\n`,
    raw: true,
    include: /\.user\.js$/,
    // Keep readable help after minification. Metadata is prepended just after it.
    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING - 2,
  });
}

export function createWebpackConfig(config, mode = 'development') {
  return {
    name: 'userscript',
    mode,
    context: config.rootDir,
    target: ['web', 'es2022'],
    entry: {
      'dev.user': path.join(config.rootDir, 'apps/userscript/src/bootstrap.ts'),
      runtime: {
        import: path.join(config.rootDir, 'apps/userscript/src/runtime.ts'),
        library: { type: 'var', name: 'DigDigRuntime' }
      }
    },
    output: {
      path: path.join(config.rootDir, 'dist/userscript'),
      filename: '[name].js',
      // No eval-based source maps: the only dynamic evaluation is the explicit development loader.
      clean: true
    },
    devtool: 'inline-source-map',
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [{
        test: /\.ts$/,
        exclude: /node_modules/,
        use: { loader: 'ts-loader', options: {
          configFile: path.join(config.rootDir, 'apps/userscript/tsconfig.json'),
          transpileOnly: true,
          compilerOptions: { noEmit: false, allowImportingTsExtensions: false }
        } }
      }]
    },
    optimization: { splitChunks: false, runtimeChunk: false },
    plugins: [
      troubleshootingBanner(),
      new webpack.DefinePlugin({
        __DEV_URL__: JSON.stringify(config.url),
        __DEV_TOKEN__: JSON.stringify(config.token),
        __APP_VERSION__: JSON.stringify(workspaceVersion),
      }),
      new UserscriptPlugin({ metadata: {
        name: 'DigDig Tools — local development',
        namespace: 'digdig-tools.local',
        author: 'Flammrock',
        version: workspaceVersion,
        description: 'Early WASM diagnostics with a local development runtime',
        match: ['https://digdig.io/*', 'http://digdig.io/*', `${config.url}/fixture*`],
        grant: ['unsafeWindow', 'GM_xmlhttpRequest', 'GM_registerMenuCommand'],
        connect: ['127.0.0.1'],
        'run-at': 'document-start',
        sandbox: 'JavaScript',
        noframes: true
      } })
    ],
    stats: 'errors-warnings',
    watchOptions: { ignored: ['**/.old/**', '**/node_modules/**', '**/reports/**', '**/.local/**'] }
  };
}

/** Standalone capture: all executable logic is bundled; no development loader. */
export function createReleaseWebpackConfig({ rootDir, version }) {
  const config = createWebpackConfig({ rootDir, url: 'http://127.0.0.1:4319', token: '' }, 'production');
  return {
    ...config,
    name: 'release-userscript',
    entry: { 'digdig.user': path.join(rootDir, 'apps/userscript/src/production.ts') },
    output: { ...config.output, path: path.join(rootDir, 'dist/release-userscript') },
    devtool: false,
    plugins: [
      troubleshootingBanner(),
      new webpack.DefinePlugin({
        __DESKTOP_URL__: JSON.stringify('http://127.0.0.1:4319'),
        __RELEASE_VERSION__: JSON.stringify(version),
      }),
      new UserscriptPlugin({ metadata: {
        name: 'DigDig Tools — desktop',
        namespace: 'digdig-tools.desktop',
        author: 'Flammrock',
        version,
        description: 'Observe terrain with the desktop app. Brave/Chrome: enable Allow User Scripts in Tampermonkey extension settings.',
        match: ['https://digdig.io/*', 'http://digdig.io/*'],
        grant: ['unsafeWindow', 'GM_xmlhttpRequest', 'GM_registerMenuCommand', 'GM_openInTab'],
        connect: ['127.0.0.1'],
        'run-at': 'document-start',
        sandbox: 'JavaScript',
        noframes: true,
      } }),
    ],
  };
}
