'use strict';

const { z } = require('@ibitplay/common');

/**
 * Where a payout is actually sent.
 *
 * These schemas are the ones A-Pay documents per payment system, lifted from
 * the hand-rolled `validateWithdrawalData` in `legacy/apay/paymentservices.js`
 * — that function was correct, and it is one of the few places the legacy code
 * validated anything before touching money. Two changes:
 *
 *   - Expressed as zod, so a bad field comes back as a named field error rather
 *     than a thrown string the caller has to read.
 *
 *   - Strict. The legacy version checked the fields it knew and passed the rest
 *     through untouched, which meant an unexpected key travelled to the
 *     provider unexamined.
 *
 * Rejecting here matters for a reason beyond tidiness: validation happens
 * BEFORE the balance is held. A malformed IFSC caught late means a player's
 * money is locked while a doomed request round-trips to the gateway.
 */

/** IFSC: four letters, a zero, then six alphanumerics. e.g. BKID0000001 */
const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'must be a valid IFSC code, e.g. BKID0000001');

const digits = (min, max, label) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^[0-9]{${min},${max}}$`), label);

const SCHEMAS = {
  /** INR — bank transfer over IMPS. */
  imps: z
    .object({
      account_name: z
        .string()
        .trim()
        .min(1)
        .max(30)
        .regex(/^[a-zA-Z\s]+$/, 'may contain letters and spaces only'),
      account_number: digits(1, 30, 'must be digits only'),
      bank_code: ifsc,
    })
    .strict(),

  /** BDT — bKash wallet. 11 digits starting 01. */
  bkash_api_v: z
    .object({
      account_number: z
        .string()
        .trim()
        .regex(/^01[0-9]{9}$/, 'must be 11 digits starting with 01'),
    })
    .strict(),

  /** BDT — Nagad wallet. */
  nagad_api_v: z.object({ account_number: digits(11, 11, 'must be exactly 11 digits') }).strict(),

  /** PKR — bank, EasyPaisa or JazzCash. The account number may be a CNIC. */
  pkr_w: z
    .object({
      account_number: digits(9, 17, 'must be 9-17 digits (CNIC for EasyPaisa/JazzCash)'),
      bank_name: z
        .string()
        .trim()
        .min(2)
        .max(67)
        .regex(/^[A-Za-z0-9\s)(–-]+$/, 'contains characters the provider will reject'),
      phone_number: z
        .string()
        .trim()
        .regex(/^03[0-9]{9}$/, 'must be 11 digits starting with 03'),
    })
    .strict(),

  /**
   * NPR — eSewa, which takes either a phone or a bank destination.
   *
   * A discriminated union rather than one loose object: the legacy version
   * branched on `payment_method` and then validated only the fields for that
   * branch, so a request naming "phone" could carry bank fields that were never
   * looked at but were still forwarded.
   */
  esewa_p2p: z.discriminatedUnion('payment_method', [
    z
      .object({
        payment_method: z.literal('phone'),
        phone_number: digits(10, 10, 'must be exactly 10 digits'),
      })
      .strict(),
    z
      .object({
        payment_method: z.literal('bank'),
        bank_name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[a-zA-Z.& -]+$/, 'may contain letters, spaces and . & - only'),
        phone_number: digits(10, 10, 'must be exactly 10 digits'),
      })
      .strict(),
  ]),
};

/**
 * Validate payout details for a payment system.
 *
 * An UNKNOWN payment system is a rejection, not a pass-through. The legacy
 * default branch let unrecognised systems through on the reasoning that the
 * provider would validate them — which is true, but only after we have already
 * held the player's balance, and only if the provider is reachable.
 */
function validatePayoutDetails(paymentSystem, data) {
  const schema = Object.prototype.hasOwnProperty.call(SCHEMAS, paymentSystem)
    ? SCHEMAS[paymentSystem]
    : null;

  if (!schema) return { ok: false, fields: { payment_system: `unsupported payment system "${paymentSystem}"` } };

  const result = schema.safeParse(data ?? {});
  if (result.success) return { ok: true, value: result.data };

  const fields = {};
  for (const issue of result.error.issues) {
    fields[issue.path.join('.') || 'data'] = issue.message;
  }
  return { ok: false, fields };
}

module.exports = { validatePayoutDetails, SCHEMAS };
