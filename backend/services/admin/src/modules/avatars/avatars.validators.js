'use strict';

const { z } = require('@ibitplay/common');

/** The platform ladder runs 0 (Unranked) to 40. */
const MAX_LEVEL = 40;

/**
 * Multipart sends every field as a string, so `enabled=false` would be TRUE under
 * `z.coerce.boolean()`. Only the words / booleans count.
 */
const flag = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());

const minLevel = z.coerce.number().int().min(0).max(MAX_LEVEL);
const sort = z.coerce.number().int().min(0).max(9999);
const idParam = z.object({ id: z.coerce.number().int().positive() }).strict();

module.exports = {
  MAX_LEVEL,

  /** POST / — the file is checked on its bytes by `imageUpload.inspect`; these ride beside it. */
  create: {
    body: z.object({ minLevel: minLevel.default(0), sort: sort.optional(), enabled: flag.optional() }).strict(),
  },

  update: {
    params: idParam,
    body: z
      .object({ minLevel: minLevel.optional(), sort: sort.optional(), enabled: flag.optional() })
      .strict()
      .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' }),
  },

  replaceImage: { params: idParam, body: z.object({}).strict() },

  byId: { params: idParam },

  image: { params: idParam, query: z.object({ v: z.string().max(64).optional() }).strict() },

  empty: { query: z.object({}).strict() },
};
