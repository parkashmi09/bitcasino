import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The dev proxy's backend: API_TARGET in .env (e.g. the shared main-server), else the local gateway
// at GATEWAY_URL (backend/.env GATEWAY_PORT; its .env.example says 4700). Casino-service is gateway + 3.
const { API_TARGET, GATEWAY_URL = 'http://127.0.0.1:4700' } = loadEnv('development', import.meta.dirname, '');
const GATEWAY = API_TARGET || GATEWAY_URL;
const gw = new URL(GATEWAY_URL);
const CASINO_SERVICE = `${gw.protocol}//${gw.hostname}:${Number(gw.port || 80) + 3}`;

/**
 * `/api` goes to the iBitPlay gateway, which is the ONLY public entry
 * point — it strips spoofable headers, verifies the player token once and
 * refuses `/internal/*`. Every path it serves starts `/api/v1`.
 *
 * `/socket.io` goes to the gateway too: it proxies socket.io polling to
 * user-service and pipes the upgrade (`gateway/src/wsProxy.js`). The casino
 * socket cannot: the gateway serves it only at `/ws/casino` and websocket-only,
 * while this client polls first. So:
 *
 *   `/socket.io`     -> gateway -> user-service   wallet, auth rebind, pushes
 *   `/casino-socket` -> casino-service (gateway port + 3) the in-house `PLAY_*` rounds
 *
 * Casino-service listens on Socket.io's DEFAULT path (`/socket.io`), so the
 * second entry rewrites rather than adding a path server-side: the client is
 * told `path: '/casino-socket'`, Vite maps that back to `/socket.io`,
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
    // 5174 = SITE_FRONTEND_URL / PUBLIC_SITE_URL / CORS lists; strict so a busy port fails instead of drifting.
    port: 5174,
    strictPort: true,
    proxy: {
      // Same-origin for the browser; drop its Origin so a shared backend's CORS list need not name every dev port.
      '/api': {
        target: GATEWAY,
        changeOrigin: true,
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
      '/socket.io': {
        target: GATEWAY,
        changeOrigin: true,
        ws: true,
        // The socket server checks Origin too, on the polling requests and the websocket upgrade.
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => req.removeHeader('origin'));
          proxy.on('proxyReqWs', (req) => req.removeHeader('origin'));
        },
      },
      // The sports exchange's socket (odds + balance push) on the gateway: `/ws/sports/socket.io`, websocket only.
      '/ws': {
        target: GATEWAY,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => proxy.on('proxyReqWs', (req) => req.removeHeader('origin')),
      },
      '/casino-socket': {
        target: CASINO_SERVICE,
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
    /**
     * Scoped to `src`, and that scoping is load-bearing rather than tidy.
     *
     * Vitest's default glob matches `*.test.*` AND `*.spec.*` anywhere under
     * the project root, which would sweep up
     * `e2e/*.spec.js` — Playwright specs that import `@playwright/test` and
     * expect a real browser. Under vitest they do not fail usefully: they
     * fail on the import, in jsdom, with an error about a missing module,
     * and the obvious reading is that the e2e suite is broken rather than
     * that it was run by the wrong runner.
     *
     * `npm test` is vitest over `src`; `npm run test:e2e` is Playwright over
     * `e2e`. Neither ever sees the other's files.
     */
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
