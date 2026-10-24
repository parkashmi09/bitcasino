'use strict';

/**
 * The owner document's `paymentMethods` block: per gateway, per currency, the deposit methods the
 * owner lists and whether each is active —
 *
 *   { f2pay: { INR: [{ code: 'UpiMixed', active: true }], IDR: [{ code: 'QRIS', active: false }] } }
 *
 * admin-service writes it into the `payment_methods` table (`owner_enabled`, migration 153), where
 * the Super Admin's own methods and switches live too. Absent = {}. Reading drops anything
 * malformed. Mirrors owner-panel/src/lib/entitlements/paymentMethods.ts.
 */

const GATEWAY_RE = /^[a-z0-9_]{2,30}$/;
const CURRENCY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const CODE_RE = /^[A-Za-z0-9_]{1,40}$/;
const MAX_PER_CURRENCY = 50;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** `{ gateway: { CURRENCY: [{ code, active }] } }` — only well-formed entries, first of a duplicate code. */
function cleanPaymentMethods(value) {
  const out = {};
  if (!isObject(value)) return out;
  for (const [gateway, currencies] of Object.entries(value)) {
    if (!GATEWAY_RE.test(gateway) || !isObject(currencies)) continue;
    for (const [currency, list] of Object.entries(currencies)) {
      if (!CURRENCY_RE.test(currency) || !Array.isArray(list)) continue;
      const seen = new Set();
      const methods = [];
      for (const m of list) {
        if (methods.length === MAX_PER_CURRENCY) break;
        if (!isObject(m) || typeof m.code !== 'string' || !CODE_RE.test(m.code) || seen.has(m.code)) continue;
        seen.add(m.code);
        methods.push({ code: m.code, active: m.active !== false });
      }
      (out[gateway] ??= {})[currency] = methods;
    }
  }
  return out;
}

module.exports = { cleanPaymentMethods, PAYMENT_METHOD_CODE: CODE_RE };
