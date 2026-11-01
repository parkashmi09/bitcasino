'use strict';

const { z } = require('@ibitplay/common');
const { currency } = require('../exchange-rate/exchangeRate.validators');
const { moneyAmount } = require('../wallet/wallet.validators');
const { WITHDRAW_STATUSES, STAFF_STATUSES } = require('./fiatWithdraw.constants');

/** Where-the-money-goes fields that a `bankAccountId` replaces. */
const DESTINATION_FIELDS = ['accountHolderName', 'bankName', 'accountNumber', 'ifscCode', 'upiId'];

/**
 * The `currency` field is the one legacy interpolated straight into
 * `SELECT ${currencyLower} FROM credits` and
 * `UPDATE credits SET ${currencyLower} = ...`. It is checked against the
 * supported-currency allow-list here, and turned into a column name only via
 * `wallet.constants.resolveColumn`.
 */
const create = {
  body: z
    .object({
      amount: moneyAmount,
      currency,
      // A saved payout account (`/bank-accounts`), resolved server-side against the
      // caller. With it, none of the destination fields below may be sent: one
      // request, one source of truth for where the money goes.
      bankAccountId: z.string().trim().regex(/^\d+$/, 'bankAccountId must be numeric').optional(),
      accountHolderName: z.string().trim().min(1, 'the account holder name is required').max(255).optional(),
      bankName: z.string().trim().max(255).optional(),
      accountNumber: z.string().trim().max(100).optional(),
      ifscCode: z.string().trim().max(50).optional(),
      upiId: z.string().trim().max(255).optional(),
      // The player confirmed that an active (unwagered) bonus is forfeited by this withdrawal.
      // Without it, a player holding one gets 409 BONUS_FORFEIT_REQUIRED (player-bonuses).
      forfeitBonus: z.boolean().optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.bankAccountId) {
        for (const key of DESTINATION_FIELDS) {
          if (v[key] !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: 'Send either a saved account or the account details, not both',
            });
          }
        }
        // The saved row was format-checked when it was saved; the service
        // applies the per-currency rule to what it resolves.
        return;
      }
      if (!v.accountHolderName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accountHolderName'],
          message: 'the account holder name is required',
        });
      }
      if (v.currency === 'INR') {
        if (!v.ifscCode && !v.upiId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['upiId'],
            message: 'For INR, either an IFSC code or a UPI id is required',
          });
        }
        return;
      }
      // Non-INR needs full bank details, matching the legacy rule.
      if (!v.bankName || !v.accountNumber || !v.ifscCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bankName'],
          message: 'Bank name, account number and IFSC code are required for this currency',
        });
      }
    }),
};

const listMine = {
  query: z.object({
    status: z.enum(WITHDRAW_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const listAll = {
  query: z.object({
    status: z.enum(WITHDRAW_STATUSES).optional(),
    userId: z.coerce.number().int().positive().optional(),
    // The site admin's currency filter (Finance → Withdrawals → Fiat).
    currency: currency.optional(),
    // Direct Users | Agent Users — na ho to sab (purana jawab).
    channel: z.enum(['direct', 'agent']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const updateStatus = {
  body: z
    .object({
      withdrawalId: z.coerce.number().int().positive(),
      status: z.enum(STAFF_STATUSES),
      comment: z.string().trim().max(500).optional(),
      // Checked by admin-service (required): paying out or refunding moves money.
      transactionPassword: z.string().max(200).optional(),
    })
    .strict(),
};

const withdrawalParam = { params: z.object({ withdrawalId: z.coerce.number().int().positive() }) };

module.exports = { create, listMine, listAll, updateStatus, withdrawalParam };
