'use strict';

const { z } = require('@ibitplay/common');
const { currency } = require('../exchange-rate/exchangeRate.validators');
const { moneyAmount } = require('../wallet/wallet.validators');
const { WITHDRAW_STATUSES } = require('./fiatWithdraw.constants');

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
      accountHolderName: z.string().trim().min(1, 'the account holder name is required').max(255),
      bankName: z.string().trim().max(255).optional(),
      accountNumber: z.string().trim().max(100).optional(),
      ifscCode: z.string().trim().max(50).optional(),
      upiId: z.string().trim().max(255).optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
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
  }),
};

const listAll = {
  query: z.object({
    status: z.enum(WITHDRAW_STATUSES).optional(),
    userId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const updateStatus = {
  body: z
    .object({
      withdrawalId: z.coerce.number().int().positive(),
      status: z.enum(WITHDRAW_STATUSES),
      comment: z.string().trim().max(500).optional(),
    })
    .strict(),
};

module.exports = { create, listMine, listAll, updateStatus };
