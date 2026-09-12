'use strict';

const crypto = require('crypto');

/**
 * jsGames v1 — the huidu.bet integration.
 *
 * Payloads travel as AES-256-ECB ciphertext under a shared key. Holding the key
 * is what authenticates a message in both directions: nobody else can produce a
 * ciphertext that decrypts to valid JSON.
 *
 * ── WHAT THAT DOES AND DOES NOT BUY ──────────────────────────────────────
 * ECB has no MAC and no IV, so it is malleable at 16-byte block granularity and
 * identical plaintext blocks encrypt identically. An attacker holding captured
 * ciphertexts can reorder and splice blocks between them. That is the
 * provider's protocol; it cannot be fixed from this side.
 *
 * What CAN be done, and is done in the service:
 *   - `serial_number` is a unique index, so a replayed message settles once
 *   - the payload's `timestamp` must be recent, so a capture expires
 *
 * ── THE KEY WAS IN THE SOURCE ────────────────────────────────────────────
 *     static AGENCY_CONFIG = {
 *       agency_uid: 'b96581ad0785ff9f86c960def63aee4b',
 *       aes_key: '8ce9295ab6786ef6e4bd8d07eda4ce81',
 *       ...
 *     }
 * It is in the repository history and must be rotated with the provider.
 */
class HuiduClient {
  constructor({ baseUrl, agencyUid, aesKey, playerPrefix, timeoutMs = 15_000, logger, fetchImpl }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.agencyUid = agencyUid;
    this.aesKey = aesKey;
    this.playerPrefix = playerPrefix;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  get configured() {
    // A 32-byte key, because aes-256 needs one. Legacy passed whatever was in
    // the constant straight to `createCipheriv`, so a mistyped key would have
    // thrown on the first launch of the day rather than at boot.
    return Boolean(this.baseUrl && this.agencyUid && this.aesKey && Buffer.byteLength(this.aesKey, 'utf8') === 32);
  }

  /** `h24e9e_INR_1234` — the provider's account name for one of our players. */
  memberAccount(userId, currency) {
    return `${this.playerPrefix}_${currency}_${userId}`;
  }

  /**
   * The user id inside a member account.
   *
   * Legacy used `member_account.split('_')[2]`, which silently produces
   * `undefined` for any account that is not exactly three parts — and
   * `undefined` then went into an INSERT as the user id. Anything that is not a
   * positive integer is null here, and the caller refuses.
   */
  parseMemberAccount(account) {
    const parts = String(account ?? '').split('_');
    if (parts.length < 3) return null;
    const id = Number(parts[2]);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  encrypt(payload) {
    const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.from(this.aesKey, 'utf8'), null);
    return Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]).toString('base64');
  }

  /**
   * Decrypt an inbound payload, or return null.
   *
   * Never throws: this runs on a callback path where an exception becomes a 500
   * and a 500 becomes a retry loop.
   */
  decrypt(ciphertext) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-ecb', Buffer.from(this.aesKey, 'utf8'), null);
      const plain = Buffer.concat([
        decipher.update(Buffer.from(String(ciphertext), 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plain);
    } catch (error) {
      this.logger?.warn({ err: error }, 'jsGames v1 payload did not decrypt');
      return null;
    }
  }

  async call(path, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          agency_uid: this.agencyUid,
          timestamp: Date.now().toString(),
          payload: this.encrypt(payload),
        }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error(body?.msg || `jsGames responded ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }

      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { HuiduClient };
