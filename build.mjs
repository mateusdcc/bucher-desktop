import { build, context } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await copyFile('index.html', 'dist/index.html');
const options = {
  entryPoints: ['src/app.js'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: ['safari16', 'chrome105'],
  outdir: 'dist',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file' },
};

if (process.argv.includes('--serve')) {
  const dev = await context(options);
  await dev.watch();
  await dev.serve({ host: '127.0.0.1', port: 1420, servedir: 'dist' });
} else {
  await build({ ...options, minify: true });
}
