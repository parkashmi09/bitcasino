'use strict';

const crypto = require('crypto');

/**
 * Authenticated encryption for secrets that must be READ BACK, not verified.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT HASHING
 *
 * Passwords are hashed because nothing ever needs the original — a login
 * compares two hashes. A TOTP shared secret is the opposite: generating the
 * code the phone will show requires the secret itself, so it has to come back
 * out. Hashing it is not an option, and storing it in the clear was what the
 * platform did.
 *
 * `users.two_fa` held the base32 secret as plain text. Anyone with a copy of
 * the database — a dump, a backup under `db_backups/`, a read replica, a
 * misplaced `pg_dump` — could generate valid second-factor codes for every
 * enrolled player, indefinitely, without touching the application. Passwords
 * and refresh tokens in this codebase are both hashed; the 2FA secret was the
 * one credential stored in a form that could be used directly.
 *
 * ── AES-256-GCM, AND WHY THE TAG MATTERS ─────────────────────────────────
 *
 * GCM is authenticated: decryption FAILS on tampered input rather than
 * returning wrong plaintext. Without that, an attacker with write access to
 * the database could flip bits in a stored secret and the application would
 * quietly generate codes against a value it could partly control. CBC or CTR
 * would encrypt just as well and detect nothing.
 *
 * A fresh 96-bit IV per encryption, from the CSPRNG. Reusing an IV under one
 * key in GCM is catastrophic — it leaks the XOR of the plaintexts and can
 * expose the authentication key — so it is generated per call and never
 * derived from the record.
 *
 * ── THE STORED FORM CARRIES ITS OWN VERSION ──────────────────────────────
 *
 *     v1.<iv>.<tag>.<ciphertext>        all base64url
 *
 * The `v1` prefix is what makes rotation possible later without guessing at a
 * blob's format, and it is also how `isEncrypted` tells a new value from a
 * legacy plaintext base32 secret. That matters during the migration window:
 * `open()` accepts a plaintext secret and returns it unchanged, so an account
 * enrolled before this existed keeps working and is re-sealed the next time it
 * is written. Refusing to read them would have locked out every enrolled
 * player the moment this deployed.
 * ═════════════════════════════════════════════════════════════════════════
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits — the size GCM is specified and optimised for
const TAG_BYTES = 16;
const VERSION = 'v1';

/** A base32 secret as `speakeasy` emits it: RFC 4648 alphabet, no padding. */
const BASE32_SECRET = /^[A-Z2-7]{16,128}$/;

/**
 * Turn whatever the operator configured into exactly 32 bytes.
 *
 * Accepts a 64-character hex string or a 32-byte base64 value directly. Any
 * other string is stretched with HKDF rather than being truncated or padded:
 * a passphrase used verbatim as an AES key has far less entropy than its
 * length suggests, and silently accepting one would make the key look stronger
 * than it is.
 */
function normaliseKey(raw) {
  if (Buffer.isBuffer(raw) && raw.length === 32) return raw;

  const value = String(raw || '');
  if (!value) return null;

  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');

  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32) return decoded;

  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(value, 'utf8'), Buffer.alloc(0), 'ibitplay:secretbox:v1', 32)
  );
}

/**
 * Seal and open secrets under one key.
 *
 * Constructed once per service from config, so a missing key fails at boot
 * rather than at the first enrolment.
 */
class SecretBox {
  /**
   * @param {object} options
   * @param {string|Buffer} options.key  TOTP_ENCRYPTION_KEY, or a fallback.
   * @param {object} [options.logger]
   */
  constructor({ key, logger = null } = {}) {
    this.key = normaliseKey(key);
    this.logger = logger;

    if (!this.key) {
      throw new Error(
        'SecretBox requires an encryption key. Generate one with:\n' +
          "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
          'and set it as TOTP_ENCRYPTION_KEY.'
      );
    }
  }

  /** Is this value already in the sealed format? */
  static isSealed(value) {
    return typeof value === 'string' && value.startsWith(`${VERSION}.`);
  }

  /** Does this look like a pre-encryption plaintext base32 secret? */
  static isLegacyPlaintext(value) {
    return typeof value === 'string' && BASE32_SECRET.test(value);
  }

  /** Encrypt. Returns the versioned, self-describing string to store. */
  seal(plaintext) {
    if (typeof plaintext !== 'string' || !plaintext) {
      throw new Error('SecretBox.seal requires a non-empty string');
    }

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Decrypt, transparently passing through a legacy plaintext secret.
   *
   * @returns {string|null} null when the value is absent or cannot be opened.
   */
  open(stored) {
    if (!stored) return null;

    if (!SecretBox.isSealed(stored)) {
      /**
       * A secret enrolled before this class existed. Returned as-is so the
       * account keeps working; the caller re-seals it on the next write.
       *
       * Anything that is neither sealed nor a valid base32 secret is corrupt,
       * and returning it would hand `speakeasy` garbage to generate codes
       * from — which fails as "wrong code" and reads to the player as a broken
       * authenticator rather than a broken record.
       */
      if (SecretBox.isLegacyPlaintext(stored)) return stored;
      this.logger?.warn('Stored 2FA secret is neither sealed nor valid base32 — treating as unusable');
      return null;
    }

    const [, ivPart, tagPart, ctPart] = String(stored).split('.');
    if (!ivPart || !tagPart || !ctPart) {
      this.logger?.warn('Sealed secret is malformed');
      return null;
    }

    try {
      const iv = Buffer.from(ivPart, 'base64url');
      const tag = Buffer.from(tagPart, 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);

      return Buffer.concat([
        decipher.update(Buffer.from(ctPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      /**
       * The tag did not verify. Two causes, and they are not distinguishable
       * from here: the record was tampered with, or the key changed. Both mean
       * "do not use this secret", and both are worth a loud log — a sudden run
       * of these is the signature of a rotated key with no re-encryption pass.
       */
      this.logger?.error({ err: error.message }, 'Could not open a sealed secret — wrong key or tampered record');
      return null;
    }
  }

  /** True when a stored value should be rewritten in the current format. */
  needsResealing(stored) {
    return Boolean(stored) && !SecretBox.isSealed(stored);
  }
}

/**
 * Build the box a service uses, from its config.
 *
 * ── ON THE FALLBACK ──────────────────────────────────────────────────────
 *
 * `TOTP_ENCRYPTION_KEY` is what should be set. When it is absent the key is
 * derived from `JWT_ADMIN_SECRET` with HKDF and a fixed info string, and the
 * omission is logged at warn on every boot.
 *
 * That is a deliberate trade, not an oversight. Refusing to boot would be the
 * stricter choice, but it would take a running platform down on deploy for a
 * variable nobody had been told to set — and the threat this defends against
 * is a database copy read WITHOUT the application's environment. A key derived
 * from an app secret still defeats that completely.
 *
 * What it does not give is independent rotation: rotating `JWT_ADMIN_SECRET`
 * would silently invalidate every stored 2FA secret. Which is exactly why the
 * warning names the consequence rather than saying "using fallback".
 */
function createSecretBox({ config, logger } = {}) {
  const explicit = config?.TOTP_ENCRYPTION_KEY;
  if (explicit) return new SecretBox({ key: explicit, logger });

  const fallback = config?.JWT_ADMIN_SECRET || config?.JWT_ACCESS_SECRET;
  if (!fallback) {
    throw new Error(
      'Cannot build a SecretBox: set TOTP_ENCRYPTION_KEY (32 bytes hex). Generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  logger?.warn(
    'TOTP_ENCRYPTION_KEY is not set — deriving the 2FA encryption key from JWT_ADMIN_SECRET. ' +
      'Secrets are still encrypted at rest, but the two are now coupled: rotating JWT_ADMIN_SECRET ' +
      'will make every stored 2FA secret unreadable and lock out everyone enrolled. ' +
      'Set a dedicated key.'
  );

  return new SecretBox({
    key: Buffer.from(
      crypto.hkdfSync('sha256', Buffer.from(String(fallback), 'utf8'), Buffer.alloc(0), 'ibitplay:totp:v1', 32)
    ),
    logger,
  });
}

module.exports = { SecretBox, createSecretBox };
