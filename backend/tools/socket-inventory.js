#!/usr/bin/env node
'use strict';

/**
 * The legacy Socket.io surface, counted the way `route-inventory.js` counts
 * HTTP routes.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * `verify:routes` reports 523 / 577 and that number is HTTP-ONLY. It says
 * nothing about Socket.io, and Socket.io is where most of the player-facing
 * platform actually lives: login, registration, chat, tipping, rain, the
 * wallet, swaps, withdrawals and every in-house game are socket events, not
 * routes.
 *
 * Reporting 90% without saying that would misrepresent the port. This tool
 * makes the socket surface countable, so "what is left" means the same thing
 * for both transports.
 *
 * A socket event is claimed the same way a route is — with a JSDoc tag:
 *
 *     @legacy SOCKET <event-name>
 *
 * so an event cannot be marked done by editing a document.
 * ═════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs');
const path = require('node:path');
const { writeKeepingEol } = require('./lib/eol');

const ROOT = path.resolve(__dirname, '..');
/**
 * `legacy/` is a SIBLING of `backend/`, not a child.
 *
 * The platform moved into `backend/` so the port and the monolith it replaces
 * sit side by side at the repository root. `ROOT` is the backend; the reference
 * source is one level above it.
 */
const LEGACY = path.join(ROOT, '..', 'legacy');
const SERVICES = path.join(ROOT, 'services');

/** `client.on('name', …)` and `socket.on('name', …)`, plus constant refs. */
const ON_PATTERN = /(?:client|socket)\.on\(\s*(?:(['"`])([^'"`]+)\1|C\.([A-Z0-9_]+))/g;

/** `@legacy SOCKET <event>` in the ported services. */
const CLAIM_PATTERN = /@legacy\s+SOCKET\s+(\S+)/g;

/**
 * The `C.*` constants, resolved to their wire names.
 *
 * Legacy names most events through `General/Constant`, so `client.on(C.CREDIT)`
 * is really `client.on('credit')` — counting the constant name would make the
 * inventory disagree with what a client actually sends.
 */
function loadConstants() {
  const file = path.join(LEGACY, 'General', 'Constant', 'index.js');
  if (!fs.existsSync(file)) return new Map();

  const source = fs.readFileSync(file, 'utf8');
  const map = new Map();

  for (const match of source.matchAll(/^\s*(?:exports\.|C\.)?([A-Z0-9_]+)\s*[:=]\s*(['"`])([^'"`]*)\2/gm)) {
    map.set(match[1], match[3]);
  }
  return map;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** A commented-out handler is not a handler. Mirrors route-inventory.js. */
function isCommentedOut(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const line = source.slice(lineStart, index);
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

function collectLegacy(constants) {
  const events = [];

  for (const file of walk(LEGACY)) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file);

    for (const match of source.matchAll(ON_PATTERN)) {
      if (isCommentedOut(source, match.index)) continue;

      const literal = match[2];
      const constant = match[3];
      const name = literal ?? constants.get(constant) ?? `C.${constant}`;

      // `disconnecting` and friends are Socket.io's own lifecycle, not surface.
      if (['disconnect', 'disconnecting', 'error', 'connect'].includes(name)) continue;

      events.push({
        event: name,
        via: constant ? `C.${constant}` : null,
        source: `${relative}:${source.slice(0, match.index).split('\n').length}`,
      });
    }
  }

  return events;
}

function collectClaims() {
  const claimed = new Map();

  for (const file of walk(SERVICES)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(CLAIM_PATTERN)) {
      claimed.set(match[1], path.relative(ROOT, file));
    }
  }

  return claimed;
}

function main() {
  /**
   * ═════════════════════════════════════════════════════════════════════
   * NO `legacy/`, NO ANSWER — AND CERTAINLY NO MANIFEST
   *
   * Everything below counts the legacy surface. Without it every collector
   * returns empty, and the arithmetic still "works": 0 events, 0 ported,
   * `0/0` rendered as 0.0%. The tool then wrote that over
   * `docs/socket-manifest.json` — replacing a real 79-event inventory with
   * an empty one — and exited 0.
   *
   * So the check destroyed the record it exists to produce, and reported
   * success while doing it. `route-inventory.js` reads the same missing
   * directory and dies; that is the correct shape, and this is now the same
   * shape with a better message.
   *
   * The guard is here rather than in `loadConstants()` because the absence
   * only matters once, at the top, and a caller who has read this far should
   * not have to know which of the three collectors noticed first.
   * ═════════════════════════════════════════════════════════════════════
   */
  if (!fs.existsSync(LEGACY)) {
    process.stderr.write(
      `\nCannot take a socket inventory: no legacy source at ${LEGACY}\n` +
        '\n`legacy/` is a SIBLING of `backend/`, not a child — the monolith this port\n' +
        'replaces sits beside it at the repository root. Without it there is nothing\n' +
        'to count, and writing docs/socket-manifest.json anyway would replace a real\n' +
        'inventory with an empty one.\n\n' +
        'Restore legacy/, or skip this check — do not treat a 0/0 result as a pass.\n\n'
    );
    process.exitCode = 1;
    return;
  }

  const constants = loadConstants();
  const events = collectLegacy(constants);
  const claimed = collectClaims();

  // One row per distinct event name; the same event handled in two files is
  // one thing a client can send.
  const byEvent = new Map();
  for (const entry of events) {
    if (!byEvent.has(entry.event)) byEvent.set(entry.event, { ...entry, handlers: 0 });
    byEvent.get(entry.event).handlers += 1;
  }

  const rows = [...byEvent.values()]
    .map((row) => ({ ...row, ported: claimed.has(row.event) }))
    .sort((a, b) => a.event.localeCompare(b.event));

  const ported = rows.filter((r) => r.ported).length;

  process.stdout.write(`\nLegacy socket events: ${rows.length}   ported: ${ported} `);
  process.stdout.write(`(${rows.length ? ((ported / rows.length) * 100).toFixed(1) : '0.0'}%)\n\n`);

  if (process.argv.includes('--list')) {
    for (const row of rows) {
      const mark = row.ported ? '✅' : '⬜';
      process.stdout.write(`${mark} ${row.event.padEnd(28)} ${row.via ?? ''.padEnd(24)}  ${row.source}\n`);
    }
    process.stdout.write('\n');
  }

  const manifest = { generatedFrom: 'legacy/', total: rows.length, ported, events: rows };
  writeKeepingEol(path.join(ROOT, 'docs', 'socket-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write('Wrote docs/socket-manifest.json\n');
}

main();
