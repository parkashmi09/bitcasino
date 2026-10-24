'use strict';

const { z } = require('@ibitplay/common');

/**
 * Indian formats, because the only live fiat rail is INR.
 *
 * IFSC: four letters (the bank), a literal 0, six letters or digits (the
 * branch) — RBI's format, upper-cased before the check so a lower-case paste
 * is accepted. UPI: `handle@psp`, the same pattern the withdraw form checks.
 */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI = /^[\w.-]{2,256}@[A-Za-z][\w.-]{1,63}$/;
const ACCOUNT_NUMBER = /^\d{6,20}$/;

const holder = z.string().trim().min(1, 'the account holder name is required').max(255);

const bank = z
  .object({
    method: z.literal('bank'),
    accountHolderName: holder,
    bankName: z.string().trim().max(255).optional(),
    // Spaces are how people copy account numbers off a passbook; they are not part of it.
    accountNumber: z
      .string()
      .transform((v) => v.replace(/\s/g, ''))
      .pipe(z.string().regex(ACCOUNT_NUMBER, 'the account number must be 6 to 20 digits')),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.string().regex(IFSC, 'the IFSC must be 11 characters, like SBIN0001234')),
    makeDefault: z.boolean().optional(),
  })
  .strict();

const upi = z
  .object({
    method: z.literal('upi'),
    accountHolderName: holder,
    upiId: z.string().trim().pipe(z.string().regex(UPI, 'the UPI id must look like name@bank')),
    makeDefault: z.boolean().optional(),
  })
  .strict();

const create = { body: z.discriminatedUnion('method', [bank, upi]) };

const idParam = {
  params: z.object({ id: z.string().trim().regex(/^\d+$/, 'id must be numeric') }),
};

module.exports = { create, idParam, IFSC, UPI, ACCOUNT_NUMBER };
