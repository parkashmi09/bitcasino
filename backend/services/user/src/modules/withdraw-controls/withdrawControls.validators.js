'use strict';

const { z } = require('@ibitplay/common');

/** A currency code as the ledger spells it (upper-case, 2–12). */
const currency = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,11}$/);

/** An amount above 0, at most 8 places — or null / '' to clear it. */
const amount = z
  .union([z.string(), z.number(), z.null()])
  .transform((v) => (v === null || String(v).trim() === '' ? null : String(v).trim()))
  .refine((v) => v === null || (/^\d{1,13}(\.\d{1,8})?$/.test(v) && Number(v) > 0), {
    message: 'An amount above 0, with at most 8 decimals',
  });

/** A count of 1–1000 — or null / '' to clear it. */
const count = z
  .union([z.string(), z.number(), z.null()])
  .transform((v) => (v === null || String(v).trim() === '' ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 1000), {
    message: 'A whole number from 1 to 1000',
  });

const userId = z.coerce.number().int().positive();

const site = {
  params: z.object({ currency }).strict(),
  body: z
    .object({
      autoLimit: amount.optional(),
      dailyCount: count.optional(),
      dailyAmount: amount.optional(),
      maxSingle: amount.optional(),
    })
    .strict(),
};

const siteParam = { params: z.object({ currency }).strict() };

const players = {
  query: z
    .object({
      userId: userId.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict(),
};

const player = {
  params: z.object({ userId, currency }).strict(),
  body: z
    .object({
      dailyCount: count.optional(),
      dailyAmount: amount.optional(),
      maxSingle: amount.optional(),
      autoAllowed: z.boolean().optional(),
      note: z.string().trim().max(200).nullable().optional(),
    })
    .strict(),
};

const playerParam = { params: z.object({ userId, currency }).strict() };

module.exports = { site, siteParam, players, player, playerParam };
