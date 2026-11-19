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
  jsx: 'automatic',
  target: ['safari16', 'chrome105'],
  outdir: 'dist',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file', '.css': 'css' },
};
// The code-lab sandbox runs in a classic same-origin worker (CSP worker-src 'self').
const workerOptions = {
  entryPoints: ['src/extensions/code-lab/worker.js'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['safari16', 'chrome105'],
  outfile: 'dist/code-lab-worker.js',
};

if (process.argv.includes('--serve')) {
  const dev = await context(options);
  const worker = await context(workerOptions);
  await Promise.all([dev.watch(), worker.watch()]);
  await dev.serve({ host: '127.0.0.1', port: 1420, servedir: 'dist' });
} else {
  await build({ ...options, minify: true });
  await build({ ...workerOptions, minify: true });
}
