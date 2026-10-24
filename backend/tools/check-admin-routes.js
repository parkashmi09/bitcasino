#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(REPO, 'adminpanel/src/App.tsx'), 'utf8');
const perm = fs.readFileSync(path.join(REPO, 'adminpanel/src/constants/permissions.ts'), 'utf8');
const sidebar = fs.readFileSync(path.join(REPO, 'adminpanel/src/components/Sidebar.tsx'), 'utf8');

const appPaths = new Set(
  [...app.matchAll(/path=(?:"|')([^"']+)(?:"|')/g)].map((m) => m[1])
);

function hasRoute(p) {
  const rel = p.replace(/^\//, '');
  return appPaths.has(p) || appPaths.has(rel) || appPaths.has(`/${rel}`);
}

const fromPerm = [...perm.matchAll(/path: "(\/[^"]+)"/g)].map((m) => m[1]);
const fromSide = [...sidebar.matchAll(/path: "(\/[^"]+)"/g)].map((m) => m[1]);
const all = [...new Set([...fromPerm, ...fromSide, '/activity-log'])];

const missing = all.filter((p) => !hasRoute(p));
console.log('Paths without App route:', missing.length ? missing.join('\n') : '(none)');

const adminMgmtTabs = [
  'dashboard', 'setting', 'security', 'myaccount', 'staff-portal', 'betlist', 'betlistlive',
  'casino', 'riskmanagement', 'import', 'message', 'gamecenter', 'agents', 'transfer', 'access', 'marketing-users',
];
const missingTabs = adminMgmtTabs.filter((t) => !hasRoute(t));
console.log('Admin-management child routes missing:', missingTabs.length ? missingTabs.join(', ') : '(none)');
