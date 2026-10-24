'use strict';

const crypto = require('crypto');

const { RESPONSE_ID_NAMESPACE } = require('./gis.constants');

/**
 * The transaction id we hand back to Slotegrator.
 *
 * A version-5 UUID: SHA-1 over the namespace bytes followed by the name, with
 * the version and variant bits set. Deterministic by construction, which is the
 * entire point — the provider stores the id we return and quotes it in
 * reconciliation, so a retried callback must produce the SAME id. A fresh uuid
 * per attempt would look to them like two settlements of one bet.
 *
 * ── WHY THIS IS WRITTEN OUT ──────────────────────────────────────────────
 * Legacy used the `uuid` package's `v5`. That package is present in the tree
 * only as a transitive dependency of something else — nothing declares it — so
 * the ids the provider has on file for every historical transaction would have
 * depended on a package that could vanish in an unrelated upgrade. Twenty lines
 * of SHA-1 is a smaller risk than that.
 *
 * Verified against `uuid.v5` in the tests.
 *
 * ── THE NAMESPACE MUST NEVER CHANGE ──────────────────────────────────────
 * Change it and every id we would return for a historical transaction becomes a
 * different id from the one the provider recorded.
 */

/** `'b58d9c74-80bb-46cb-8e0d-57458f25c23c'` → its 16 raw bytes. */
function namespaceBytes(namespace) {
  const hex = String(namespace).replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`Invalid UUID namespace: ${namespace}`);
  return Buffer.from(hex, 'hex');
}

const NAMESPACE = namespaceBytes(RESPONSE_ID_NAMESPACE);

function uuidV5(name, namespace = NAMESPACE) {
  const digest = crypto
    .createHash('sha1')
    .update(Buffer.concat([namespace, Buffer.from(String(name), 'utf8')]))
    .digest();

  const bytes = Buffer.from(digest.subarray(0, 16));

  // Version 5 in the high nibble of byte 6, RFC 4122 variant in byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The id for one callback.
 *
 * Without a provider id there is nothing to derive from, so a random one is
 * issued — which also means that call is not idempotent, and the caller must
 * not let one through for anything that moves money.
 */
function responseIdFor(externalId) {
  return externalId ? uuidV5(String(externalId)) : crypto.randomUUID();
}

module.exports = { uuidV5, responseIdFor, namespaceBytes };
