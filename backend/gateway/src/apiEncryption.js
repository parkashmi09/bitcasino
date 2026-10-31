'use strict';

const crypto = require('crypto');

const { isCallback } = require('./encryptionRule');

/**
 * API encryption — the owner's `api_encryption` policy (featureCatalogue.js).
 *
 * On, a JSON answer to a request that asks for it (`Accept: application/vnd.enc+json`, sent by the
 * player site's client.js) leaves as `{ "enc": base64(iv ‖ ciphertext ‖ tag) }`, AES-256-GCM under
 * API_ENCRYPTION_KEY. The site holds the same key, so this keeps the data out of plain sight in
 * the network tab; it is not a secret from someone who reads the site's code — TLS is the protection.
 * Game / payment callbacks (encryptionRule.js) and callers that do not ask are never touched.
 */
const ACCEPT = 'application/vnd.enc+json';
const POLL_MS = 15_000;

function createApiEncryption({ config, logger }) {
  const key = config.API_ENCRYPTION_KEY ? Buffer.from(config.API_ENCRYPTION_KEY, 'base64') : null;
  if (key && key.length !== 32) throw new Error('API_ENCRYPTION_KEY must be 32 bytes, base64');
  let on = false;

  async function poll() {
    try {
      const res = await fetch(`${config.ADMIN_SERVICE_URL}/api/v1/admin/features/public`);
      const list = (await res.json())?.data ?? [];
      const next = list.some((f) => f.feature === 'api_encryption' && f.variant === 'on');
      if (next !== on) logger?.info({ on: next }, 'API encryption switched');
      if (next && !key) logger?.warn('API encryption is on but API_ENCRYPTION_KEY is unset — answers stay plain');
      on = next;
    } catch (error) {
      // Keep the last known state: a hiccup in admin-service must not flip the site's wire format.
      logger?.warn({ err: error?.message }, 'API encryption: could not read the owner policy');
    }
  }

  return {
    start() {
      void poll();
      setInterval(poll, POLL_MS).unref();
    },
    /** Whether this request's JSON answer is to be encrypted. */
    wants(req) {
      if (!on || !key || req.method === 'HEAD') return false;
      if (!String(req.headers.accept ?? '').includes(ACCEPT)) return false;
      const path = String(req.originalUrl ?? '').split('?')[0];
      // Machine callers stay plain even if one ever sends the Accept — see encryptionRule.js.
      return !isCallback(path);
    },
    encrypt(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const sealed = Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
      return JSON.stringify({ enc: sealed.toString('base64') });
    },
    /** Test hook. */
    set(state) {
      on = state;
    },
  };
}

module.exports = { createApiEncryption, ACCEPT };
