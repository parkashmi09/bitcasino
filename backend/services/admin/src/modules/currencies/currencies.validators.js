'use strict';

const { z } = require('@ibitplay/common');

/** A currency code as stored: ^[A-Z][A-Z0-9]{1,9}$ (lowercase input is upper-cased). */
const code = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'a currency code is a letter then 1–9 letters or digits'));

const codeParam = z.object({ code }).strict();

/** Display text: printable, no angle brackets (it is shown in three apps). */
const text = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[<>\u0000-\u001f\u007f]/.test(v), { message: 'no control characters or angle brackets' });

/**
 * What the site admin may change on a coin. A strict allow-list: `code`,
 * `kind`, `decimals`, `builtin`, `retired` and the owner's switch are not
 * here, so naming one is a 400, not a silent ignore.
 */
const update = {
  params: codeParam,
  body: z
    .object({
      name: text(60).optional(),
      symbol: text(12).optional(),
      sortOrder: z.number().int().min(0).max(1_000_000).optional(),
      // A real boolean: `"false"` would otherwise switch a coin ON.
      enabled: z.boolean().optional(),
      networks: z
        .array(
          z
            .object({
              key: z.string().trim().min(1).max(20),
              name: text(40).optional(),
              enabled: z.boolean().optional(),
            })
            .strict()
        )
        .max(20)
        .optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'give at least one thing to change' }),
};

module.exports = { codeParam: { params: codeParam }, update };
