'use strict';

const { z, featureCatalogue } = require('@ibitplay/common');

const { FEATURE_KEYS } = featureCatalogue;

const featureParam = z.object({ feature: z.enum(FEATURE_KEYS) }).strict();

/** Short strings only — this is configuration, not content. */
const fieldMap = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.string().trim().max(512));

const update = {
  params: featureParam,
  body: z
    .object({
      // A real boolean. `"false"` would otherwise switch a feature ON.
      enabled: z.boolean().optional(),
      variant: z.string().trim().min(1).max(64).optional(),
      config: fieldMap.optional(),
      // An empty string CLEARS a secret; an absent key leaves it as stored.
      secrets: fieldMap.optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'give at least one thing to change' }),
};

const test = {
  params: featureParam,
  body: z
    .object({
      // Send to one player. Omit to send to the provider's broadcast segment.
      userId: z.coerce.number().int().positive().optional(),
      title: z.string().trim().min(1).max(120).default('Test notification'),
      body: z.string().trim().max(500).default('If you can read this, push is connected.'),
    })
    .strict(),
};

module.exports = { featureParam: { params: featureParam }, update, test };
