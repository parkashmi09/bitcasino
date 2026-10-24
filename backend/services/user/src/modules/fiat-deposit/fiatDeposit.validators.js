'use strict';

const { z } = require('@ibitplay/common');
const { DEPOSIT_STATUSES } = require('./fiatDeposit.constants');
const { currency } = require('../exchange-rate/exchangeRate.validators');
const { moneyAmount } = require('../wallet/wallet.validators');

/** Multipart, so numbers arrive as strings — `moneyAmount` keeps them that way. */
const create = {
  body: z.object({
    amount: moneyAmount,
    currency,
    transactionId: z.string().trim().min(1, 'the bank reference is required').max(128),
    bankName: z.string().trim().max(255).optional(),
    accountNumber: z.string().trim().max(100).optional(),
    ifscCode: z.string().trim().max(50).optional(),
    accountHolderName: z.string().trim().max(255).optional(),
    upiId: z.string().trim().max(255).optional(),
    // Manual crypto deposit (migration 118): the network sent on and the house address paid to;
    // the transaction hash travels as `transactionId`.
    network: z.string().trim().toUpperCase().max(32).optional(),
    walletAddress: z.string().trim().max(128).optional(),
  }).strict(),
};

const depositParam = { params: z.object({ depositId: z.coerce.number().int().positive() }) };

const listMine = {
  query: z.object({
    status: z.enum(DEPOSIT_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const listAll = {
  query: z.object({
    status: z.enum(DEPOSIT_STATUSES).optional(),
    userId: z.coerce.number().int().positive().optional(),
    currency: currency.optional(),
    search: z.string().trim().max(100).optional(),
    // Direct Users | Agent Users — na ho to sab (purana jawab).
    channel: z.enum(['direct', 'agent']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const approve = {
  params: z.object({ depositId: z.coerce.number().int().positive() }),
  body: z
    .object({
      // Lets an operator credit less than claimed, when the bank statement shows less than the
      // player entered (with a comment). Never more — the service refuses that.
      creditAmount: moneyAmount.optional(),
      comment: z.string().trim().max(500).optional(),
      // Checked by admin-service (required) before anything is credited.
      transactionPassword: z.string().max(200).optional(),
    })
    .strict(),
};

const reject = {
  params: z.object({ depositId: z.coerce.number().int().positive() }),
  body: z.object({ comment: z.string().trim().min(1, 'a reason is required').max(500) }).strict(),
};

module.exports = { create, depositParam, listMine, listAll, approve, reject };
