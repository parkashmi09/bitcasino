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
 * server on their own port; the gateway proxies HTTP only — `proxy.js` strips
 * `upgrade` with the other hop-by-hop headers, so a websocket handshake sent
 * at :4000 never reaches a service. Everything the web app listens for is on
 * TWO of them, and they cannot share one proxy entry:
 *
 *   `/socket.io`     -> user-service :4001   wallet, auth rebind, chat
 *   `/casino-socket` -> casino-service :4003 the in-house `PLAY_*` rounds
 *
 * Both servers listen on Socket.io's DEFAULT path (`/socket.io`), so the
 * second entry rewrites rather than adding a path server-side: the client is
 * told `path: '/casino-socket'`, Vite maps that back to `/socket.io` on :4003,
 * and both connections stay same-origin — which is what keeps the browser from
 * needing a CORS preflight per poll. A deployment that puts casino-service on
 * its own host sets `VITE_CASINO_SOCKET_URL` instead and the rewrite is moot.
 *
 * `ws: true` on both: without it the polling handshake succeeds and the
 * upgrade 400s, which presents as a socket that works and then stalls.
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
      '/casino-socket': {
        target: 'http://127.0.0.1:4003',
        changeOrigin: true,
        ws: true,
        rewrite: (url) => url.replace(/^\/casino-socket/, '/socket.io'),
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  /**
   * Most of what is tested here is a pure function over a JSON shape and needs
   * no DOM. The exception is the query layer's React wiring — that a hook
   * really does carry a platform response through `api.js` and an adapter and
   * out as a renderable object — which needs a renderer, so the environment is
   * `jsdom` for everything rather than split per file.
   */
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
