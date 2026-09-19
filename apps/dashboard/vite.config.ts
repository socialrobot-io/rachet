import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function resolvePkg(name: string): string {
  return path.dirname(require.resolve(`${name}/package.json`));
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
      react: resolvePkg('react'),
      'react-dom': resolvePkg('react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/v1': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
