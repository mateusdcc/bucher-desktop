import { build, context } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await copyFile('index.html', 'dist/index.html');

// Pyodide is self-hosted (no CDN): its loader dynamically imports
// pyodide.asm.mjs and fetches the wasm/stdlib/lockfile from indexURL at
// runtime, so those assets must sit next to the app, same-origin.
const pyodideAssets = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
await mkdir('dist/pyodide', { recursive: true });
for (const asset of pyodideAssets) {
  await copyFile(`node_modules/pyodide/${asset}`, `dist/pyodide/${asset}`);
}
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
// Pyodide refuses classic workers; its sandbox is a same-origin MODULE worker.
// The official loader stays unbundled (dist/pyodide/pyodide.mjs) and is imported
// at runtime, so its Node-only dynamic imports never touch the browser bundle.
const pyodideWorkerOptions = {
  entryPoints: ['src/extensions/polyglot-studio/pyodide-worker.js'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['safari16', 'chrome105'],
  outfile: 'dist/pyodide-worker.js',
};

if (process.argv.includes('--serve')) {
  const dev = await context(options);
  const worker = await context(workerOptions);
  const pyodideWorker = await context(pyodideWorkerOptions);
  await Promise.all([dev.watch(), worker.watch(), pyodideWorker.watch()]);
  await dev.serve({ host: '127.0.0.1', port: 1420, servedir: 'dist' });
} else {
  await build({ ...options, minify: true });
  await build({ ...workerOptions, minify: true });
  await build({ ...pyodideWorkerOptions, minify: true });
}
