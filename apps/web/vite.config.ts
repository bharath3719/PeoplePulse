import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The zod schemas and the permission registry are imported straight from
      // the API's own source of truth. A permission typo in the UI is therefore
      // a COMPILE ERROR, not a button that silently does nothing.
      '@peoplepulse/core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)),
    },
  },
  server: {
    // PORT for when 5173 is taken. Nothing depends on the exact port: the
    // browser only ever talks to this server, which proxies /api.
    port: Number(process.env['PORT']) || 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
});
