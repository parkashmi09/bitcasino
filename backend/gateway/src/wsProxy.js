'use strict';

const http = require('node:http');
const https = require('node:https');

/**
 * WebSocket (socket.io) through the gateway.
 *
 * `createProxy` is an Express middleware, and an HTTP Upgrade never reaches
 * Express — Node raises it on the server as an `upgrade` event. Without this
 * the public edge answered every socket connection with a dropped TCP stream,
 * so login / register / wallet pushes over the socket only worked when a
 * client dialled a service port directly.
 *
 *   /socket.io/…              → user service (auth, wallet, presence, social)
 *   /ws/<service>/socket.io/… → that service (user | casino | sports | admin),
 *                               with the `/ws/<service>` prefix removed
 *
 * The client's address is appended to `x-forwarded-for`, exactly as the HTTP
 * proxy does, so the services see — and the login history records — the real IP.
 */

const PREFIXED = /^\/ws\/(user|casino|sports|admin)(\/socket\.io(?:\/|\?|$).*)$/;

function route(url) {
  if (/^\/socket\.io(\/|\?|$)/.test(url)) return { service: 'user', path: url };
  const m = PREFIXED.exec(url);
  return m ? { service: m[1], path: m[2] } : null;
}

function attachWsProxy(server, { targets, logger }) {
  server.on('upgrade', (req, socket, head) => {
    const r = route(req.url || '');
    const target = r && targets[r.service];
    if (!target) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }

    const base = new URL(target);
    const transport = base.protocol === 'https:' ? https : http;
    const remote = (socket.remoteAddress || '').replace(/^::ffff:/, '');
    /* The client's address, resolved HERE as the HTTP side resolves it (TRUST_PROXY=1: one proxy
       in front, so the last address it appended). Sent alone: the socket server reads the first
       entry, and appending kept the client's own forged value first — a fake IP per attempt then
       walked past the per-IP login limit and the region block. */
    const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const client = chain.length ? chain[chain.length - 1] : remote;
    const headers = {
      ...req.headers,
      host: base.host,
      'x-forwarded-for': client,
      'x-forwarded-proto': socket.encrypted ? 'https' : 'http',
      'x-forwarded-host': req.headers.host || '',
    };

    const upstream = transport.request({
      protocol: base.protocol, hostname: base.hostname, port: base.port,
      path: r.path, method: req.method, headers,
    });

    upstream.on('upgrade', (res, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage || 'Switching Protocols'}`];
      for (let i = 0; i < res.rawHeaders.length; i += 2) lines.push(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upstreamHead?.length) socket.write(upstreamHead);
      if (head?.length) upstreamSocket.write(head);

      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });

    // The service refused the upgrade (bad handshake, 400…): pass its answer on.
    upstream.on('response', (res) => {
      socket.end(`HTTP/1.1 ${res.statusCode} ${res.statusMessage || ''}\r\nConnection: close\r\n\r\n`);
      res.resume();
    });

    upstream.on('error', (err) => {
      logger?.warn({ err: err.message, service: r.service, path: r.path }, 'WebSocket proxy failed');
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });

    socket.on('error', () => upstream.destroy());
    upstream.end();
  });
}

module.exports = { attachWsProxy, routeWs: route };
