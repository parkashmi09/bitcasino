'use strict';

const { z } = require('@ibitplay/common');

const id = z.coerce.number().int().positive();

const paging = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

/** Paisa string me aata hai, jaise baaki money routes me. */
const amount = z
  .string({ invalid_type_error: 'send the amount as a string, not a number' })
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a positive amount with at most 2 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero');

/** POST /exchange/owner/add-balance aur /exchange/owner/add-direct-balance */
const ownerAddBalance = {
  body: z
    .object({
      amount,
      note: z.string().trim().max(200).optional(),
      transactionPassword: z.string().min(1).max(200),
    })
    .strict(),
};

/** POST /exchange/owner/add-direct-balance — `currency` = jis coin me amount hai (default INR). */
const ownerAddDirectBalance = {
  body: ownerAddBalance.body.extend({ currency: z.string().trim().regex(/^[A-Za-z]{2,10}$/).optional() }),
};

/** GET /exchange/accounts — direct children; parentId = drill-down. */
const accounts = {
  query: z
    .object({
      ...paging,
      parentId: id.optional(),
      search: z.string().trim().max(100).optional(),
      // Direct Users | Agent Users tab; na ho = dono
      channel: z.enum(['direct', 'agent']).optional(),
      // Staff | User filter; na ho = dono
      accountType: z.enum(['staff', 'user']).optional(),
    })
    .strict(),
};

/** POST /exchange/points/settle — points: + = parent deta hai (D), − = parent leta hai (W). */
const settle = {
  body: z
    .object({
      accountType: z.enum(['user', 'staff']),
      accountId: id,
      points: z.coerce
        .number()
        .refine((v) => Number.isFinite(v) && v !== 0, 'points cannot be 0')
        .refine((v) => Math.abs(v) <= 100_000_000, 'points too large'),
      remark: z.string().trim().max(200).optional(),
      transactionPassword: z.string().max(200).optional(),
    })
    .strict(),
};

/** GET /exchange/credit-history — ek account ki credit history (zip Credit History tab). */
const creditHistory = {
  query: z.object({ ...paging, accountType: z.enum(['user', 'staff']), accountId: id }).strict(),
};

/** GET /exchange/owner/direct-ledger — owner ke Direct User wallet ka ledger (from / to optional). */
const directLedger = {
  query: z
    .object({ ...paging, from: z.coerce.date().optional(), to: z.coerce.date().optional() })
    .strict()
    .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must be before to', path: ['from'] }),
};

/** POST /exchange/owner/move-to-agent-system — whitelabel company, Direct → Agent System. */
const ownerMoveToAgentSystem = ownerAddBalance;

module.exports = { ownerAddBalance, ownerAddDirectBalance, ownerMoveToAgentSystem, accounts, settle, creditHistory, directLedger };
