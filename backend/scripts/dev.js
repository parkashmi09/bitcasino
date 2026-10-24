#!/usr/bin/env node
'use strict';

/**
 * Run the whole platform in one terminal.
 *
 *   npm run dev              start every service + the gateway
 *   npm run dev user casino  start only the named services
 *
 * Output from each process is prefixed and colour-coded, so five services
 * sharing one terminal stay readable. Ctrl-C stops all of them.
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SERVICES = [
  { name: 'user', dir: 'services/user', color: '\x1b[36m' }, // cyan
  { name: 'admin', dir: 'services/admin', color: '\x1b[35m' }, // magenta
  { name: 'casino', dir: 'services/casino', color: '\x1b[33m' }, // yellow
  { name: 'sports', dir: 'services/sports', color: '\x1b[32m' }, // green
  // Background jobs: feed polling, result polling and settlement. A separate
  // process from the sports HTTP service on purpose — see services/sports/src/worker.js.
  { name: 'sports-worker', dir: 'services/sports', color: '\x1b[90m', script: 'src/worker.js', delay: 2000 }, // grey
  { name: 'user-worker', dir: 'services/user', color: '\x1b[90m', script: 'src/worker.js', delay: 2000 }, // grey
  // The gateway starts last: it probes the others on /health, and starting it
  // first just produces a screenful of connection errors.
  { name: 'gateway', dir: 'gateway', color: '\x1b[34m', delay: 1500 }, // blue
];

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const requested = process.argv.slice(2);
const selected = requested.length ? SERVICES.filter((s) => requested.includes(s.name)) : SERVICES;

if (!selected.length) {
  console.error(`Unknown service(s): ${requested.join(', ')}`);
  console.error(`Available: ${SERVICES.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function start(service) {
  const label = service.name.padEnd(13);

  const child = spawn(process.execPath, [service.script || 'src/index.js'], {
    cwd: path.join(ROOT, service.dir),
    env: { ...process.env, LOG_PRETTY: process.env.LOG_PRETTY ?? 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = (stream) => (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      stream.write(`${service.color}${label}${RESET} ${DIM}|${RESET} ${line}\n`);
    }
  };

  child.stdout.on('data', prefix(process.stdout));
  child.stderr.on('data', prefix(process.stderr));

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // One service dying leaves the platform in a half-working state that is
    // more confusing than a clean stop, so take everything down together.
    console.error(`\n${service.color}${label}${RESET} exited (code ${code}, signal ${signal}) — stopping all services\n`);
    shutdown(1);
  });

  children.push({ service, child });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of children) {
    // SIGTERM triggers each service's graceful shutdown: drain HTTP, then
    // close the database.
    child.kill('SIGTERM');
  }

  setTimeout(() => {
    for (const { child } of children) child.kill('SIGKILL');
    process.exit(exitCode);
  }, 5_000).unref();

  let remaining = children.length;
  for (const { child } of children) {
    child.on('exit', () => {
      remaining -= 1;
      if (remaining === 0) process.exit(exitCode);
    });
  }
}

process.on('SIGINT', () => {
  console.log('\nStopping services…');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));

console.log(`Starting ${selected.length} service(s): ${selected.map((s) => s.name).join(', ')}\n`);

for (const service of selected) {
  if (service.delay) setTimeout(() => start(service), service.delay);
  else start(service);
}
