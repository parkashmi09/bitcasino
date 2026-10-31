#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
process.env.VERIFY_SERVICES = 'user,admin,casino';

const out = execFileSync('node', [path.join(BACKEND, 'tools/verify-modules.js')], {
  cwd: BACKEND,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

const routes = new Set();
for (const line of out.split('\n')) {
  const m = line.match(/^\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)\s*$/);
  if (m) routes.add(m[2].replace(/\/$/, '') || '/');
}

const regFile = path.resolve(BACKEND, '../adminpanel/src/services/endpoints.ts');
const text = fs.readFileSync(regFile, 'utf8');
const entries = [...text.matchAll(/:\s*`(\/api\/v1\/[^`]+)`/g)].map((m) => m[1]);

const norm = (p) => p.replace(/\/$/, '').replace(/:(\w+)/g, ':param');

const missing = [];
for (const raw of entries) {
  const key = norm(raw);
  const ok = routes.has(key) || [...routes].some((r) => {
    const re = new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+') + '$');
    return re.test(key);
  });
  if (!ok) missing.push(raw);
}

console.log(`Registry entries: ${entries.length}, mounted: ${routes.size}`);
if (missing.length) {
  console.log('\nMissing (user+admin+casino only):');
  missing.forEach((p) => console.log('  ', p));
} else {
  console.log('All registry paths resolve on user+admin+casino.');
}
