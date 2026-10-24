'use strict';

/**
 * Strict validators: unknown body/query keys are a 422, not silently dropped.
 *
 * The security QA pass found `POST /user/affiliate/rewards/claim-all` doing a
 * real claim on `{"x":1}`, and `?userId=` answered 200 on spin-wheel claims,
 * profile stats/turnover and the vault lists. These pin each one, the
 * strictness detector itself, and the repo-wide verifier.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { z, isStrictSchema, VALIDATE_SCHEMAS, noBody, noQuery } = require('@ibitplay/common');
const { deps } = require('../lib/router-stubs');

const BACKEND = path.resolve(__dirname, '..', '..');
const USER_MODULES = path.join(BACKEND, 'services', 'user', 'src', 'modules');

/** Run every validate() on the route against a fake request; return the error, if any. */
function runValidators(router, method, routePath, req) {
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} exists`);
  const validators = layer.route.stack.map((l) => l.handle).filter((h) => h[VALIDATE_SCHEMAS]);
  assert.ok(validators.length, `${method.toUpperCase()} ${routePath} has a validator`);
  const fake = { params: {}, query: {}, body: {}, headers: {}, ...req };
  for (const mw of validators) {
    let err;
    mw(fake, {}, (e) => { err = e; });
    if (err) return err;
  }
  return null;
}

const userRouter = (mod) => require(path.join(USER_MODULES, mod, 'routes', 'user.routes.js'))(deps);

test('isStrictSchema sees strictness through refine, extend, optional, unions; not through merge with a lenient one', () => {
  const strict = z.object({ a: z.string() }).strict();
  const lenient = z.object({ a: z.string() });
  assert.equal(isStrictSchema(strict), true);
  assert.equal(isStrictSchema(lenient), false);
  assert.equal(isStrictSchema(strict.refine(() => true)), true);
  assert.equal(isStrictSchema(strict.extend({ b: z.number() })), true);
  assert.equal(isStrictSchema(strict.partial().optional()), true);
  assert.equal(isStrictSchema(strict.transform((v) => v)), true);
  assert.equal(isStrictSchema(z.union([strict, lenient])), false);
  assert.equal(isStrictSchema(strict.merge(lenient)), false);
  assert.equal(isStrictSchema(z.any()), false);
  assert.equal(isStrictSchema(z.record(z.string())), false);
});

test('noBody()/noQuery() refuse any key and accept nothing at all', () => {
  const call = (mw, req) => { let err; mw({ params: {}, query: {}, ...req }, {}, (e) => { err = e; }); return err; };
  assert.equal(call(noBody(), { body: undefined }), undefined);
  assert.equal(call(noBody(), { body: {} }), undefined);
  assert.equal(call(noBody(), { body: { x: 1 } })?.status, 422);
  assert.equal(call(noQuery(), { query: {} }), undefined);
  assert.equal(call(noQuery(), { query: { userId: '2' } })?.status, 422);
});

test('POST /user/affiliate/rewards/claim-all refuses a junk body with 422 VALIDATION_ERROR', () => {
  const err = runValidators(userRouter('affiliate'), 'post', '/rewards/claim-all', { body: { x: 1 } });
  assert.equal(err?.status, 422);
  assert.equal(err?.code, 'VALIDATION_ERROR');
  assert.equal(runValidators(userRouter('affiliate'), 'post', '/rewards/claim-all', { body: {} }), null);
});

test('?userId= is refused on the player reads the QA pass found answering 200', () => {
  const cases = [
    ['spin-wheel', '/claims'],
    ['profile', '/stats'],
    ['profile', '/turnover'],
    ['vault', '/'],
    ['vault', '/transactions'],
    ['vault', '/interest'],
  ];
  for (const [mod, routePath] of cases) {
    const err = runValidators(userRouter(mod), 'get', routePath, { query: { userId: '2' } });
    assert.equal(err?.status, 422, `${mod} ${routePath}`);
    assert.equal(err?.code, 'VALIDATION_ERROR', `${mod} ${routePath}`);
  }
  // The keys the front end really sends still pass.
  assert.equal(runValidators(userRouter('spin-wheel'), 'get', '/claims', { query: { limit: '12' } }), null);
  assert.equal(runValidators(userRouter('vault'), 'get', '/transactions', { query: { limit: '10', offset: '0' } }), null);
  assert.equal(runValidators(userRouter('profile'), 'get', '/turnover', { query: { currency: 'INR' } }), null);
});

test('verify-strict-validators passes: every public/user/admin route is strict or a listed callback', () => {
  const run = spawnSync(process.execPath, ['tools/verify-strict-validators.js'], { cwd: BACKEND, encoding: 'utf8' });
  const out = `${run.stdout}\n${run.stderr}`;
  assert.equal(run.status, 0, out.slice(-2000));
  assert.doesNotMatch(out, /could not build with stubs/);
  assert.match(out, /Every public\/user\/admin route validates its query/);
});
