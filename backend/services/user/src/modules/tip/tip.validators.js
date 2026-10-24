'use strict';

const { z } = require('@ibitplay/common');
const { currency, moneyAmount } = require('../wallet/wallet.validators');
const { TIP_BLOCKED_CURRENCIES } = require('../wallet/social.constants');

const username = z.string().trim().min(1).max(50);

const send = {
  body: z
    .object({
      toUsername: username,
      // The same coins the chat tip refuses (the NC test coin).
      currency: currency.refine((c) => !TIP_BLOCKED_CURRENCIES.includes(c), { message: 'this currency cannot be tipped' }),
      amount: moneyAmount,
      note: z
        .string()
        .trim()
        .max(140)
        .optional()
        .nullable()
        .transform((v) => (v ? v : null)),
      // One per tip the client means to send; a retry with the same id returns the first tip.
      requestId: z.string().uuid().optional(),
    })
    .strict(),
};

const users = {
  query: z.object({ q: username }).strict(),
};

const updateSettings = {
  body: z.object({ enabled: z.boolean() }).strict(),
};

const history = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const isoDay = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'not a real date');

const adminList = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().trim().max(50).optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'not a currency code')
      .optional(),
    from: isoDay.optional(),
    to: isoDay.optional(),
    // Direct Users | Agent Users (tip PAANE wale ke hisaab se) — na ho to sab (purana jawab).
    channel: z.enum(['direct', 'agent']).optional(),
  }).strict(),
};

module.exports = { send, users, updateSettings, history, adminList };
