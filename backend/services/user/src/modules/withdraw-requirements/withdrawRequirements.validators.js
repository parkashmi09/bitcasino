'use strict';

const { z, BUILTIN_CURRENCIES } = require('@ibitplay/common');

/**
 * `GET /user/withdrawals/requirements` — strict: only `currency` (optional, a built-in wallet
 * coin, any case). With it the answer's `cap` is that currency's block; without it, one block
 * per currency the player has used. Any other key is a 422.
 */
const read = {
  query: z
    .object({
      currency: z
        .string()
        .trim()
        .toUpperCase()
        .refine((c) => BUILTIN_CURRENCIES.includes(c), 'currency must be a wallet currency code')
        .optional(),
    })
    .strict(),
};

module.exports = { read };
