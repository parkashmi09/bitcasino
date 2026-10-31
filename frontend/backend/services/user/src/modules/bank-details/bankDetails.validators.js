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

const detailBody = z.object({
  bankName: z.string().trim().max(255).optional(),
  accountNumber: z.string().trim().max(100).optional(),
  ifscCode: z.string().trim().max(50).optional(),
  accountHolderName: z.string().trim().max(255).optional(),
  upiId: z.string().trim().max(255).optional(),
  isActive: z.coerce.boolean().default(true),
});

const create = {
  params: z.object({ coin_type: coinType }),
  // multipart, so the body arrives as strings — coercion is doing real work here.
  body: detailBody.refine(
    (v) => v.accountNumber || v.upiId,
    { message: 'Either an account number or a UPI id is required', path: ['accountNumber'] }
  ),
};

const update = {
  params: z.object({ coin_type: coinType, id: z.coerce.number().int().positive() }),
  body: detailBody.partial(),
};

const remove = {
  params: z.object({ coin_type: coinType, id: z.coerce.number().int().positive() }),
};

module.exports = { coinParam, create, update, remove, coinType };
