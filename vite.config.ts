import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const version = process.env.npm_package_version ?? '0.1.0';
const buildStamp = new Date().toISOString().slice(0, 10);

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(`${version} · ${buildStamp}`),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
