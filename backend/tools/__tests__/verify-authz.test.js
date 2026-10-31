'use strict';

/**
 * tools/verify-authz.js builds every admin router with stub dependencies and
 * checks each write route for a guard. A module it cannot build is NOT checked,
 * and it used to skip race and payment-orders that way (their services prime a
 * cache through `clients.<svc>.get(...).then`, which the old stubs could not
 * chain). This pins full coverage: every admin router builds.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BACKEND = path.resolve(__dirname, '..', '..');

test('verify-authz builds and checks every admin module (none skipped as unbuildable)', () => {
  const run = spawnSync(process.execPath, ['tools/verify-authz.js'], { cwd: BACKEND, encoding: 'utf8' });
  const out = `${run.stdout}\n${run.stderr}`;

  assert.equal(run.status, 0, 'verify-authz should pass');
  assert.doesNotMatch(out, /could not build with stubs/);
  assert.doesNotMatch(out, /unbuildable/);
  assert.match(out, /Every admin write route carries an authorization guard/);
});
