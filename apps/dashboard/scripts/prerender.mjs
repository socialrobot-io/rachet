import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Reuse the actual landing component so crawlers and visitors see the same copy.
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('..', import.meta.url)),
  cacheDir: 'node_modules/.vite-prerender',
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { renderLanding } = await server.ssrLoadModule('/src/landing-render.tsx');
  const assets = await readdir(new URL('../dist/assets/', import.meta.url));
  const font = assets.find((name) => /^inter-tight-latin-wght-normal-.*\.woff2$/.test(name));
  let shell = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  if (font) shell = shell.replace('</head>', `<link rel="preload" as="font" href="/assets/${font}" type="font/woff2" crossorigin />\n</head>`);
  await writeFile(new URL('../dist/index.html', import.meta.url), shell);
  await writeFile(new URL('../dist/landing.html', import.meta.url), shell.replace('<div id="root"></div>', () => `<div id="root">${renderLanding()}</div>`));
} finally {
  await server.close();
}
