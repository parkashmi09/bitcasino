'use strict';

const { readCookie } = require('./google');

/**
 * rainbet: the refresh token in an httpOnly cookie instead of the response body, so page script
 * (and anything injected into it) never holds it.
 *
 * Opt-in per request: a client sends `X-Refresh-Cookie: 1` and then
 *   - every response that carries a session (login, register, demo, refresh, Google exchange)
 *     sets the cookie and leaves `refreshToken` out of the body;
 *   - `POST /refresh` and `POST /logout` read the token from the cookie when the body has none;
 *   - logout clears the cookie.
 * A client that does not send the header (the other sites on this backend) keeps the body token
 * exactly as before.
 *
 * shortcut: SameSite=Lax, so the player site and the API must be same-site (same registrable
 * domain, or the dev proxy); a cross-site deployment needs SameSite=None + CORS credentials.
 */

const COOKIE = 'rb_refresh';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

const wants = (req) => req.headers['x-refresh-cookie'] === '1';

function options(req) {
  return {
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    path: '/',
  };
}

/** The session body as this client should see it: the token moved into the cookie when asked. */
function deliver(req, res, result) {
  if (!wants(req) || !result?.refreshToken) return result;
  const { refreshToken, ...rest } = result;
  res.cookie(COOKIE, refreshToken, { ...options(req), maxAge: SESSION_TTL_MS });
  return rest;
}

/** Route middleware: fill `body.refreshToken` from the cookie for an opted-in client that sent none. */
function fromCookie(req, _res, next) {
  if (wants(req) && !req.body?.refreshToken) {
    const token = readCookie(req.headers.cookie, COOKIE);
    if (token) req.body = { ...(req.body || {}), refreshToken: token };
  }
  next();
}

function clear(req, res) {
  if (wants(req)) res.clearCookie(COOKIE, options(req));
}

module.exports = { COOKIE, deliver, fromCookie, clear };
