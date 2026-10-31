'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

/**
 * Google sign-in (OAuth 2.0 authorization code + PKCE, OpenID Connect ID token).
 *
 *   start      a random `state` and PKCE verifier; both ride back to the callback in a signed,
 *              HttpOnly, ten-minute cookie (never in the URL Google sees), the browser goes to
 *              Google with `state` and the S256 challenge.
 *   callback   the cookie's `state` must equal the query's; the code is exchanged with the
 *              verifier; the ID token is verified against Google's keys — signature (RS256),
 *              issuer, audience = our client id, expiry — and `email_verified` must be true.
 *
 * Off unless GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are all set.
 */
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const STATE_AUDIENCE = 'google-oauth-state';
const COOKIE = 'g_signin';
const COOKIE_PATH = '/api/v1/user/auth/google';

const configured = (config) => Boolean(config?.GOOGLE_CLIENT_ID && config?.GOOGLE_CLIENT_SECRET && config?.GOOGLE_REDIRECT_URI);

/* The player tab's sessionStorage nonce (login-CSRF binding): the one-time code the callback mints
   is only redeemable together with it, so a code lifted from someone else's flow is useless. */
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;

/** The Google URL to send the browser to, and the signed cookie that must come back with it. */
function startRequest(config, nonce) {
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })}`;
  const cookie = jwt.sign({ state, verifier, nonce }, config.JWT_ACCESS_SECRET, { expiresIn: '10m', audience: STATE_AUDIENCE });
  return { url, cookie };
}

/** `{ verifier, nonce }` when the cookie is ours, unexpired and names this `state`; else null. */
function verifierFor(cookieValue, state, config) {
  if (!cookieValue || !state) return null;
  try {
    const claims = jwt.verify(cookieValue, config.JWT_ACCESS_SECRET, { audience: STATE_AUDIENCE });
    const a = Buffer.from(String(claims.state));
    const b = Buffer.from(String(state));
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? { verifier: claims.verifier, nonce: claims.nonce } : null;
  } catch {
    return null;
  }
}

/** Value of one cookie from a raw `Cookie` header. */
function readCookie(header, name = COOKIE) {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Trade the code for the ID token. */
async function exchangeCode({ code, verifier, config, fetchImpl = fetch }) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id_token) throw new Error(`token exchange failed (${res.status} ${body?.error ?? ''})`);
  return body.id_token;
}

let keyCache = { at: 0, keys: [] };
async function googleKeys(fetchImpl, force = false) {
  if (!force && keyCache.keys.length && Date.now() - keyCache.at < 3600_000) return keyCache.keys;
  const res = await fetchImpl(JWKS_URL);
  const body = await res.json();
  keyCache = { at: Date.now(), keys: Array.isArray(body?.keys) ? body.keys : [] };
  return keyCache.keys;
}

/** `{ sub, email, name }` from a verified Google ID token; throws on anything else. */
async function verifyIdToken(idToken, { clientId, fetchImpl = fetch }) {
  const header = jwt.decode(idToken, { complete: true })?.header;
  if (!header?.kid) throw new Error('ID token has no key id');
  let jwk = (await googleKeys(fetchImpl)).find((k) => k.kid === header.kid);
  // Google rotates its keys: one unknown kid is worth one refresh.
  if (!jwk) jwk = (await googleKeys(fetchImpl, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('ID token signed with an unknown key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const claims = jwt.verify(idToken, key, { algorithms: ['RS256'], audience: clientId, issuer: ISSUERS });
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('Google email is not verified');
  if (!claims.sub || !claims.email) throw new Error('ID token lacks sub or email');
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: claims.name ?? null };
}

/** A free-form name → a username the signup rules accept (3–30 of A-Z a-z 0-9 _ . -). */
const usernameBase = (email) => (String(email).split('@')[0].replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 20) || 'player').padEnd(3, '0');

module.exports = {
  COOKIE,
  COOKIE_PATH,
  NONCE,
  configured,
  startRequest,
  verifierFor,
  readCookie,
  exchangeCode,
  verifyIdToken,
  usernameBase,
  _resetKeyCache: () => (keyCache = { at: 0, keys: [] }),
};
