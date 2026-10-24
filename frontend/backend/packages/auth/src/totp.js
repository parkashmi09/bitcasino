'use strict';

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * Two-factor authentication (TOTP, RFC 6238) — compatible with Google
 * Authenticator, Authy and 1Password.
 *
 * Flow: setup() returns a secret the player scans but which is NOT yet active;
 * it becomes active only after they prove they can generate a valid code. That
 * ordering prevents the classic lockout where a secret is enabled but was never
 * successfully stored in the authenticator app.
 */

/** Generate a new secret. Not enabled until a code is verified against it. */
function generateSecret({ label, issuer = 'iBitPlay' }) {
  const secret = speakeasy.generateSecret({
    name: `${issuer}:${label}`,
    issuer,
    length: 20, // 160 bits, the RFC 4226 recommendation
  });

  return {
    base32: secret.base32,
    otpauthUrl: secret.otpauth_url,
  };
}

/** Render the otpauth URL as a scannable data-URI QR code. */
async function toQrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 2, width: 240 });
}

/**
 * Verify a 6-digit code.
 *
 * `window: 1` accepts the previous and next 30-second step, which covers
 * ordinary clock drift between the phone and the server. Widening it further
 * would multiply the number of codes valid at any moment.
 */
function verifyCode({ secret, code, window = 1 }) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  return speakeasy.totp.verify({ secret, encoding: 'base32', token: String(code), window });
}

/** The 30-second counter a TOTP code is derived from. */
const STEP_SECONDS = 30;

/**
 * Verify a code AND report which time step it belonged to.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THE STEP HAS TO COME BACK OUT
 *
 * `verifyCode` answers "is this code currently valid", and a code stays
 * currently valid for its whole acceptance window — with `window: 1` that is
 * three steps, so up to 90 seconds. Nothing recorded that a code had already
 * been spent, so the same six digits could be presented again and again inside
 * that window and would be accepted every time.
 *
 * That is the difference between a second factor and a second password. Anyone
 * who observes one code — a phishing page that proxies the login, a shoulder,
 * an intercepted support chat — has a minute and a half to replay it. TOTP is
 * specified as a ONE-TIME password; the "one-time" part is the caller's job,
 * and it needs to know which step to burn.
 *
 * `speakeasy.totp.verifyDelta` returns `{delta}` — how many steps away the
 * match was — so the absolute step is `now + delta`. The caller stores it and
 * refuses anything at or below it next time. Storing the step rather than the
 * code means the record is useless to anyone who reads it.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * @returns {{valid: boolean, step: number|null}}
 */
function verifyCodeWithStep({ secret, code, window = 1, now = Date.now() }) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return { valid: false, step: null };

  const result = speakeasy.totp.verifyDelta({
    secret,
    encoding: 'base32',
    token: String(code),
    window,
  });

  if (!result || typeof result.delta !== 'number') return { valid: false, step: null };

  const currentStep = Math.floor(now / 1000 / STEP_SECONDS);
  return { valid: true, step: currentStep + result.delta };
}

/**
 * Verify a code and refuse one that has already been used.
 *
 * @param {number|null} lastUsedStep The step stored from the last success.
 * @returns {{valid: boolean, step: number|null, replayed: boolean}}
 *   `replayed` distinguishes "wrong code" from "correct code, already spent" —
 *   the caller needs that to log a replay attempt, which is a much more
 *   interesting event than a typo. It should NOT be shown to the client: a
 *   distinct message would confirm to an attacker that the code they captured
 *   was genuine and merely late.
 */
function verifyCodeOnce({ secret, code, lastUsedStep = null, window = 1, now = Date.now() }) {
  const { valid, step } = verifyCodeWithStep({ secret, code, window, now });
  if (!valid) return { valid: false, step: null, replayed: false };

  if (lastUsedStep !== null && lastUsedStep !== undefined && step <= Number(lastUsedStep)) {
    return { valid: false, step, replayed: true };
  }

  return { valid: true, step, replayed: false };
}

/** The code valid right now — used only in tests and local tooling. */
function currentCode(secret) {
  return speakeasy.totp({ secret, encoding: 'base32' });
}

/**
 * Recovery codes, for when the phone is lost.
 * Shown once at setup and stored hashed — the plaintext is never recoverable.
 */
function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

module.exports = {
  generateSecret,
  toQrDataUrl,
  verifyCode,
  verifyCodeWithStep,
  verifyCodeOnce,
  currentCode,
  generateRecoveryCodes,
  STEP_SECONDS,
};
