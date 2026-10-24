'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Password hashing.
 *
 * bcrypt with a configurable cost. The legacy platform stored bcrypt hashes
 * too, so existing players keep working; anything that is not a recognised
 * bcrypt hash is treated as unusable rather than compared as plaintext.
 */

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

async function hashPassword(plain, rounds = 12) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('hashPassword requires a non-empty string');
  }
  // bcrypt silently truncates past 72 bytes — reject rather than hash a prefix.
  if (Buffer.byteLength(plain, 'utf8') > 72) {
    throw new Error('Password exceeds bcrypt maximum of 72 bytes');
  }
  return bcrypt.hash(plain, rounds);
}

/**
 * Verify a password.
 *
 * When the stored hash is missing or malformed we still burn a comparison
 * against a dummy hash. Returning early would make "no such user" measurably
 * faster than "wrong password", which is enough to enumerate accounts.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO3Jt7dPrmVUq8Cgv0m2Xj9QsMDxKmvlq';

async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || !plain) {
    await bcrypt.compare('dummy', DUMMY_HASH);
    return false;
  }
  if (typeof hash !== 'string' || !BCRYPT_PATTERN.test(hash)) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/** True when a hash was made with a weaker cost than we now require. */
function needsRehash(hash, rounds = 12) {
  if (typeof hash !== 'string' || !BCRYPT_PATTERN.test(hash)) return true;
  const cost = Number(hash.split('$')[2]);
  return Number.isFinite(cost) && cost < rounds;
}

/** Cryptographically random token, URL-safe. Used for resets and API keys. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Hash a token for storage.
 *
 * Reset tokens and refresh tokens are stored hashed, so a leaked database
 * cannot be replayed against the API. SHA-256 (not bcrypt) is right here: the
 * input is already 256 bits of entropy, so there is nothing to brute-force and
 * lookups need to be fast.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Constant-time compare for tokens/codes. */
function safeCompare(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const bufB = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Numeric OTP for email/SMS verification. */
function generateOtp(digits = 6) {
  const max = 10 ** digits;
  // randomInt is uniform; `Math.random() * max` is not, and biased OTPs are
  // meaningfully easier to guess.
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsRehash,
  randomToken,
  hashToken,
  safeCompare,
  generateOtp,
  BCRYPT_PATTERN,
};
