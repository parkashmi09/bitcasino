import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/**
 * `/api` goes to the iBitPlay gateway on :4000, which is the ONLY public entry
 * point — it strips spoofable headers, verifies the player token once and
 * refuses `/internal/*`. Every path it serves starts `/api/v1`.
 *
 * `/socket.io` does NOT. The four services each attach their own Socket.io
 * server on their own port; the gateway proxies HTTP only. Everything the web
 * app listens for — wallet, auth rebind, chat, the in-house game rounds — is on
 * user-service and casino-service, so the socket proxy points straight at
 * user-service and casino events connect on their own namespace later.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:4001', changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
