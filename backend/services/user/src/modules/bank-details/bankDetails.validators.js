'use strict';

const { z } = require('@ibitplay/common');
const { SUPPORTED_CURRENCIES } = require('../wallet/wallet.constants');

const coinType = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => SUPPORTED_CURRENCIES.includes(v), {
    message: `coin_type must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  });

const coinParam = { params: z.object({ coin_type: coinType }) };

// The player's deposit amount: only the destinations whose range holds it are listed.
const activeList = { params: z.object({ coin_type: coinType }), query: z.object({ amount: z.coerce.number().positive().max(1e15).optional() }).strict() };

const bound = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().nonnegative().max(1e15).nullable()).optional();

const detailBody = z.object({
  bankName: z.string().trim().max(255).optional(),
  accountNumber: z.string().trim().max(100).optional(),
  ifscCode: z.string().trim().max(50).optional(),
  accountHolderName: z.string().trim().max(255).optional(),
  upiId: z.string().trim().max(255).optional(),
  // A crypto coin's house address (migration 118); the network is the registry's key (TRC20, BTC, …).
  network: z.string().trim().toUpperCase().max(32).optional(),
  walletAddress: z.string().trim().max(128).optional(),
  // multipart sends 'false' as a string, which z.coerce.boolean() would read as true.
  isActive: z.preprocess((v) => (v === 'false' ? false : v === 'true' ? true : v), z.boolean()).default(true),
  // The deposit amounts this destination is shown for; '' clears the bound.
  minAmount: bound,
  maxAmount: bound,
}).strict();

const inRange = (v) => v.minAmount == null || v.maxAmount == null || v.minAmount <= v.maxAmount;
const RANGE_MESSAGE = { message: 'The minimum amount cannot be above the maximum', path: ['maxAmount'] };

const create = {
  params: z.object({ coin_type: coinType }),
  // multipart, so the body arrives as strings — coercion is doing real work here.
  body: detailBody.refine(
    (v) => v.accountNumber || v.upiId || v.walletAddress,
    { message: 'An account number, a UPI id or a wallet address is required', path: ['accountNumber'] }
  ).refine(inRange, RANGE_MESSAGE),
};

const update = {
  params: z.object({ coin_type: coinType, id: z.coerce.number().int().positive() }),
  body: detailBody.partial().refine(inRange, RANGE_MESSAGE),
};

const remove = {
  params: z.object({ coin_type: coinType, id: z.coerce.number().int().positive() }),
};

module.exports = { coinParam, activeList, create, update, remove, coinType };
