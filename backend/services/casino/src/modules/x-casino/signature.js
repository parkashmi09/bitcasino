'use strict';

const crypto = require('node:crypto');

const { MAX_REQUEST_AGE_MS, CLOCK_SKEW_MS } = require('./xCasino.constants');

/**
 * Authenticating a provider callback.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT LEGACY SIGNED, AND WHAT IT DID NOT
 *
 *     sha1(command + request_timestamp + SECRET)
 *
 * `data` is absent from that. `data` is where `user_id`, `session`, `amount`
 * and `transaction_type` live — everything the request actually asks for. One
 * captured `changebalance` callback is therefore a permanent credential for
 * crediting any account any amount: keep the three signed fields, replace the
 * body, send it.
 *
 * The signature has to cover the payload or it is not authenticating the
 * request, only the fact that somebody once knew the secret.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ── COMPATIBILITY ────────────────────────────────────────────────────────
 *
 * The provider is an external system that signs the way it signs; this port
 * cannot make it start covering the body. So BOTH are computed:
 *
 *   - the payload-covering form is accepted always;
 *   - the legacy form is accepted only when `XCASINO_ALLOW_LEGACY_HASH` is
 *     set, and every acceptance is logged at WARN with the reason.
 *
 * That flag is the migration path, not a default. It is off unless configured,
 * and the log line says what it is costing.
 */

/** SHA-1, because that is what the provider computes. Not our choice. */
const sha1 = (input) => crypto.createHash('sha1').update(input, 'utf8').digest('hex');

/**
 * The signature the provider sends today: command + timestamp + secret.
 *
 * Does NOT cover `data`.
 */
function legacyHash({ command, requestTimestamp, secret }) {
  return sha1(`${command}${requestTimestamp}${secret}`);
}

/**
 * The signature that actually authenticates the request.
 *
 * The raw body is hashed rather than a re-serialisation of the parsed object:
 * `JSON.stringify(req.body)` can differ from what was sent — key order, number
 * formatting, unicode escapes — so a check against it both rejects genuine
 * callbacks and, worse, can be made to accept a forged one where the
 * reserialisation collapses a difference the sender signed over.
 */
function payloadHash({ command, requestTimestamp, rawBody, secret }) {
  return sha1(`${command}${requestTimestamp}${rawBody}${secret}`);
}

/** Constant-time compare of two hex digests. */
function matches(expected, given) {
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(String(given ?? ''), 'utf8');
  // `timingSafeEqual` throws on a length mismatch, so the length is checked
  // first — that leaks only the length, which is fixed for a hex digest.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Is this request fresh?
 *
 * Legacy put `request_timestamp` inside the hash and never compared it to a
 * clock, so a captured request never expired.
 *
 * The provider's format is `YYYY-MM-DD HH:MM:SS`, which carries no zone. It is
 * read as UTC, matching how the provider's own `getCurrentTimestamp` built it
 * (`new Date().toISOString()` with the `T` replaced).
 */
function isFresh(requestTimestamp, now = Date.now()) {
  const stamp = String(requestTimestamp ?? '').trim();
  if (!stamp) return false;

  const parsed = Date.parse(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed)) return false;

  const age = now - parsed;
  if (age > MAX_REQUEST_AGE_MS) return false;
  // A provider clock a little ahead of ours is normal; a long way ahead is a
  // request built to outlive the freshness window.
  if (age < -CLOCK_SKEW_MS) return false;

  return true;
}

/**
 * Verify a callback.
 *
 * @returns {{ok: true, mode: 'payload'|'legacy'} | {ok: false, reason: string}}
 */
function verify({ command, requestTimestamp, rawBody, hash, secret, allowLegacy = false }) {
  if (!secret) return { ok: false, reason: 'no secret configured' };
  if (!isFresh(requestTimestamp)) return { ok: false, reason: 'stale or unparseable timestamp' };

  if (matches(payloadHash({ command, requestTimestamp, rawBody, secret }), hash)) {
    return { ok: true, mode: 'payload' };
  }

  if (allowLegacy && matches(legacyHash({ command, requestTimestamp, secret }), hash)) {
    return { ok: true, mode: 'legacy' };
  }

  return { ok: false, reason: 'signature mismatch' };
}

/**
 * The signature on OUR response.
 *
 * Legacy computed `generateResponseHash(status, getCurrentTimestamp())` and, in
 * several branches, called `getCurrentTimestamp()` a SECOND time for the
 * `response_timestamp` field it sent alongside. Those two calls can land on
 * different seconds, and when they do the provider's verification of our
 * response fails — intermittently, roughly once per thousand requests, with
 * nothing in the logs to explain it. One timestamp, computed once.
 */
function signResponse({ status, responseTimestamp, secret }) {
  return sha1(`${status}${responseTimestamp}${secret}`);
}

module.exports = { verify, signResponse, legacyHash, payloadHash, isFresh, matches, sha1 };
