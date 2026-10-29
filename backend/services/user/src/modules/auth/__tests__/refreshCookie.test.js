'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const refreshCookie = require('../refreshCookie');

const req = (headers = {}, body) => ({ headers, body, secure: false });
function res() {
  const out = { cookies: {}, cleared: [] };
  out.cookie = (name, value, opts) => (out.cookies[name] = { value, opts });
  out.clearCookie = (name) => out.cleared.push(name);
  return out;
}

test('an opted-in client gets the token as an httpOnly cookie, not in the body', () => {
  const r = res();
  const body = refreshCookie.deliver(req({ 'x-refresh-cookie': '1' }), r, { accessToken: 'a', refreshToken: 'r'.repeat(40) });
  assert.equal(body.refreshToken, undefined);
  assert.equal(body.accessToken, 'a');
  assert.equal(r.cookies.rb_refresh.value, 'r'.repeat(40));
  assert.equal(r.cookies.rb_refresh.opts.httpOnly, true);
});

test('any other client keeps the body token and gets no cookie', () => {
  const r = res();
  const body = refreshCookie.deliver(req(), r, { accessToken: 'a', refreshToken: 'r' });
  assert.equal(body.refreshToken, 'r');
  assert.deepEqual(r.cookies, {});
});

test('refresh reads the cookie only when the body has no token', () => {
  const opted = req({ 'x-refresh-cookie': '1', cookie: 'x=1; rb_refresh=fromcookie' }, {});
  refreshCookie.fromCookie(opted, null, () => {});
  assert.equal(opted.body.refreshToken, 'fromcookie');

  const sent = req({ 'x-refresh-cookie': '1', cookie: 'rb_refresh=fromcookie' }, { refreshToken: 'frombody' });
  refreshCookie.fromCookie(sent, null, () => {});
  assert.equal(sent.body.refreshToken, 'frombody');

  const other = req({ cookie: 'rb_refresh=fromcookie' }, {});
  refreshCookie.fromCookie(other, null, () => {});
  assert.equal(other.body.refreshToken, undefined);
});
