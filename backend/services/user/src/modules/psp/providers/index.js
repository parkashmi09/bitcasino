'use strict';

const crypto = require('crypto');

const { PSP_STATUS } = require('../psp.constants');

/**
 * Payment-provider adapters.
 *
 * One object per provider, each answering the same two questions:
 *
 *   verify(body, config)  — is this callback genuinely from the provider?
 *   parse(body)           — what does it say happened?
 *
 * Everything else — finding the transaction, checking the amount, crediting the
 * wallet idempotently — is shared, in `psp.service.js`. That split is the point:
 * the legacy code had four separate callback handlers with four different ideas
 * of how careful to be, and the least careful of them (`upi`) had no
 * verification at all.
 *
 * `verify` returning false is the ONLY thing standing between a stranger's HTTP
 * request and a balance going up. Every adapter must implement it, and the
 * registry below refuses to load one that does not.
 */

/**
 * Constant-time string compare.
 *
 * The legacy handlers used `!==` on signatures. For a network-facing hash
 * comparison the timing signal is small but real, and there is no reason to
 * leave it — comparing digests of the values makes it constant-time regardless
 * of length.
 */
function safeEqual(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const bufB = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/** `key=value&key=value` over sorted, non-empty keys — the shape most providers sign. */
function canonicalQuery(params, { exclude = ['sign', 'signature'] } = {}) {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k))
    .filter((k) => params[k] !== '' && params[k] !== null && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

// ══════════════════════════════════════════════════════════════════════
//  WayPay — MD5 over the canonical query plus the shared key
// ══════════════════════════════════════════════════════════════════════
const waypay = {
  name: 'waypay',
  requiredConfig: ['WAYPAY_MERCHANT_KEY'],
  // The signed material contains `out_trade_no`, so a signature is valid for
  // exactly one transaction — see `selfIdentifying` in the registry note below.
  selfIdentifying: true,

  verify(body, config) {
    const expected = crypto
      .createHash('md5')
      .update(`${canonicalQuery(body)}&key=${config.WAYPAY_MERCHANT_KEY}`)
      .digest('hex');

    return safeEqual(body.sign, expected);
  },

  /** The bytes the provider signed — what the replay guard fingerprints. */
  signedPayload(body) {
    return canonicalQuery(body);
  },

  parse(body) {
    return {
      reference: body.out_trade_no,
      providerReference: body.transaction_Id ?? body.transaction_id ?? null,
      // WayPay uses a numeric status; 1 is success. Anything else is not
      // treated as success — an unknown code must never credit.
      status: String(body.status) === '1' ? PSP_STATUS.SUCCESS : PSP_STATUS.FAILED,
      amount: String(body.money ?? body.amount ?? '0'),
      utr: body.utr ?? null,
    };
  },
};

// ══════════════════════════════════════════════════════════════════════
//  A-Pay — SHA1 over access key + private key + MD5 of the transactions blob
// ══════════════════════════════════════════════════════════════════════
const apay = {
  name: 'apay',
  requiredConfig: ['APAY_WEBHOOK_ACCESS_KEY', 'APAY_WEBHOOK_PRIVATE_KEY'],
  // The signature covers the transactions array, which carries
  // `custom_transaction_id`.
  selfIdentifying: true,

  verify(body, config) {
    const { access_key: accessKey, signature, transactions } = body;

    // The access key identifies which merchant the callback claims to be for.
    // A mismatch is a rejection before any hashing happens.
    if (!safeEqual(accessKey, config.APAY_WEBHOOK_ACCESS_KEY)) return false;

    const md5Transactions = crypto
      .createHash('md5')
      .update(typeof transactions === 'string' ? transactions : JSON.stringify(transactions))
      .digest('hex');

    const expected = crypto
      .createHash('sha1')
      .update(`${config.APAY_WEBHOOK_ACCESS_KEY}${config.APAY_WEBHOOK_PRIVATE_KEY}${md5Transactions}`)
      .digest('hex');

    return safeEqual(signature, expected);
  },

  /** The bytes the provider signed — what the replay guard fingerprints. */
  signedPayload(body) {
    return typeof body.transactions === 'string' ? body.transactions : JSON.stringify(body.transactions);
  },

  parse(body) {
    const list = typeof body.transactions === 'string' ? JSON.parse(body.transactions) : body.transactions;
    const tx = Array.isArray(list) ? list[0] : list;

    return {
      reference: tx?.custom_transaction_id ?? tx?.id,
      providerReference: tx?.id ?? null,
      status: tx?.status === 'success' ? PSP_STATUS.SUCCESS : PSP_STATUS.FAILED,
      amount: String(tx?.amount ?? '0'),
      utr: tx?.utr ?? null,
    };
  },
};

// ══════════════════════════════════════════════════════════════════════
//  CricPay — AES-256-CBC encrypted payload; decrypting IS the proof
// ══════════════════════════════════════════════════════════════════════
const cricpay = {
  name: 'cricpay',
  requiredConfig: ['CRICPAY_SECRET_KEY', 'CRICPAY_SECRET_IV', 'CRICPAY_MERCHANT_CODE', 'CRICPAY_BASE_URL'],

  /**
   * FALSE — and this is the whole reason `confirm()` below exists.
   *
   * CricPay's encrypted blob contains status, amount, fee and remark. It does
   * not contain the transaction code; that sits in plaintext beside it. Two
   * consequences, and they pull in opposite directions:
   *
   *   - A captured blob can be repointed at another transaction. The signature
   *     still verifies, because it never covered the target.
   *
   *   - The encryption is deterministic (fixed key, fixed IV), so two genuine
   *     ₹100 deposits produce BYTE-IDENTICAL blobs. A "have I seen this payload
   *     before" guard therefore rejects honest traffic — it cannot distinguish
   *     a replay from a second player paying the same amount.
   *
   * So no amount of inspecting the callback settles it. The callback is treated
   * as a NOTIFICATION only, and the truth is fetched from CricPay over a
   * merchant-authenticated channel that does name the transaction.
   */
  selfIdentifying: false,

  /**
   * Ask CricPay directly what happened to this transaction.
   *
   * `POST /api/appuser/checkStatusByTrn` with our merchant code — the same call
   * `legacy/cricpay/controller.js` already makes from its status endpoint. The
   * request names the transaction, the response is authenticated by TLS to
   * CricPay plus our merchant code, and neither is under the caller's control.
   *
   * Returns null when CricPay cannot be reached or answers something we do not
   * understand. The service treats that as "do not settle yet" and lets the
   * provider retry — the alternative, settling on an unverified notification,
   * is the bug this exists to prevent.
   */
  async confirm(reference, config, { http }) {
    const response = await http.post(
      `${config.CRICPAY_BASE_URL}/api/appuser/checkStatusByTrn`,
      { merchantCode: config.CRICPAY_MERCHANT_CODE, transaction_code: reference }
    );

    if (response?.statusCode !== 'Success') return null;

    const status = String(response.trn_status ?? '').toLowerCase();
    return {
      status: status === 'successful' || status === 'success' ? PSP_STATUS.SUCCESS : PSP_STATUS.FAILED,
      // CricPay names the field differently here than in the callback blob.
      amount: response.trn_amount ?? response.transaction_amount ?? null,
    };
  },

  /**
   * CricPay sends an encrypted blob rather than a signature. Only someone
   * holding the shared key can produce something that decrypts to well-formed
   * data, so a successful decrypt is the authentication.
   *
   * The decrypted payload is cached on the body so `parse` does not repeat the
   * work — and so a body that decrypted once cannot be swapped for another.
   *
   * ── The blob is HEX, not base64 ──────────────────────────────────────
   * `legacy/cricpay/controller.js` decrypts with
   * `decipher.update(encrypted, 'hex', 'utf8')`. Getting this wrong does not
   * fail loudly — it just makes every genuine callback look like a forgery.
   *
   * ── The blob does not say WHICH transaction it is for ────────────────
   * The decrypted payload carries only `transaction_status`,
   * `transaction_amount`, `transaction_fee` and `remark`. The transaction is
   * named by the PLAINTEXT `transaction_code` field beside it, which anyone can
   * change. That is CricPay's design, not ours, and it means a captured blob can
   * be pointed at a different transaction of the same amount.
   *
   * `psp.service.js` closes this by refusing a payload digest it has already
   * accepted (see migration 012). Do not remove that guard while this provider
   * is enabled.
   */
  verify(body, config) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(config.CRICPAY_SECRET_KEY, 'hex'),
        Buffer.from(config.CRICPAY_SECRET_IV, 'hex')
      );

      let decrypted = decipher.update(String(body.data), 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      const parsed = Object.fromEntries(new URLSearchParams(decrypted));
      if (!parsed.transaction_status) return false;

      Object.defineProperty(body, '__decrypted', { value: parsed, enumerable: false });
      return true;
    } catch {
      // A bad key, a tampered blob and malformed hex all land here, and all
      // mean the same thing: this did not come from CricPay.
      return false;
    }
  },

  /** The bytes the provider authenticated — what the replay guard fingerprints. */
  signedPayload(body) {
    return String(body.data ?? '');
  },

  parse(body) {
    const d = body.__decrypted ?? {};
    return {
      // Plaintext, from the body — see the warning above.
      reference: body.transaction_code,
      providerReference: d.transaction_id ?? null,
      // `parseInt(transaction_status) === 1` is the legacy test. A numeric
      // status means a string compare against 'success' never matches, so
      // every real payment would have been recorded as failed.
      status: Number.parseInt(d.transaction_status, 10) === 1 ? PSP_STATUS.SUCCESS : PSP_STATUS.FAILED,
      amount: String(d.transaction_amount ?? '0'),
      fee: String(d.transaction_fee ?? '0'),
      utr: d.remark ?? null,
    };
  },
};

// ══════════════════════════════════════════════════════════════════════
//  UPI Gateway — HMAC-SHA256 over the canonical query
// ══════════════════════════════════════════════════════════════════════
const upi = {
  name: 'upi',
  requiredConfig: ['UPI_WEBHOOK_SECRET'],
  // The HMAC covers `client_txn_id`.
  selfIdentifying: true,

  /**
   * THE LEGACY HANDLER HAD NO VERIFICATION AT ALL.
   *
   * `POST /webhook/paymentstatuspui` in `legacy/index.js` read `status` and
   * `amount` straight from the request body and ran
   * `UPDATE credits SET inr = inr + $1`. No signature, no shared secret, no
   * authentication of any kind — so anyone who knew or could obtain a
   * `client_txn_id` could POST `{status:"success", amount:"1000000"}` and mint
   * money into that account. The amount was not even compared against the
   * deposit record.
   *
   * This is an HMAC over the canonical query, which is what UPI Gateway
   * documents. It requires `UPI_WEBHOOK_SECRET` to be configured — and unlike
   * the others, there is no legacy behaviour to fall back to, so if the shared
   * secret is not known the callback must stay closed rather than open.
   */
  verify(body, config) {
    const expected = crypto
      .createHmac('sha256', config.UPI_WEBHOOK_SECRET)
      .update(canonicalQuery(body, { exclude: ['sign', 'signature', 'hash'] }))
      .digest('hex');

    return safeEqual(body.sign ?? body.signature ?? body.hash, expected);
  },

  /** The bytes the provider signed — what the replay guard fingerprints. */
  signedPayload(body) {
    return canonicalQuery(body, { exclude: ['sign', 'signature', 'hash'] });
  },

  parse(body) {
    return {
      reference: body.client_txn_id,
      providerReference: body.id ?? null,
      status: body.status === 'success' ? PSP_STATUS.SUCCESS : PSP_STATUS.FAILED,
      amount: String(body.amount ?? '0'),
      utr: body.upi_txn_id ?? null,
    };
  },
};

const PROVIDERS = { waypay, apay, cricpay, upi };

/**
 * Boot-time checks on the adapter set.
 *
 * `selfIdentifying` records whether the material the provider authenticated
 * names WHICH transaction it is about. When it does, one signature settles one
 * transaction and a repeated payload digest is a replay. When it does not, the
 * callback proves only that *something* happened, and the transaction has to be
 * confirmed out of band — so an adapter that admits it is not self-identifying
 * must supply `confirm()`.
 *
 * These are hard failures rather than warnings. An adapter that silently
 * accepts anything is exactly the shape of the bug this module was written to
 * remove, and a warning at boot is a warning nobody reads.
 */
for (const [name, provider] of Object.entries(PROVIDERS)) {
  for (const method of ['verify', 'parse', 'signedPayload']) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`PSP adapter "${name}" must implement ${method}()`);
    }
  }
  if (typeof provider.selfIdentifying !== 'boolean') {
    throw new Error(
      `PSP adapter "${name}" must declare selfIdentifying — whether the signed material names the transaction`
    );
  }
  if (!provider.selfIdentifying && typeof provider.confirm !== 'function') {
    throw new Error(
      `PSP adapter "${name}" is not self-identifying, so its callback cannot be trusted to name a ` +
        'transaction. It must implement confirm() to fetch the outcome from the provider.'
    );
  }
}

function getProvider(name) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, String(name)) ? PROVIDERS[String(name)] : null;
}

module.exports = { PROVIDERS, getProvider, safeEqual, canonicalQuery };
