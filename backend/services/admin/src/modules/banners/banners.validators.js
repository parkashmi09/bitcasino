'use strict';

const { z } = require('@ibitplay/common');
const { TYPE_PATTERN } = require('./banners.constants');

/**
 * A placement name.
 *
 * Lowercased first so `Home` and `home` are the same placement — legacy
 * compared `type` with `=` and stored whatever case arrived, so those were two
 * different banners and the admin screen showed both.
 */
const placement = z
  .string()
  .trim()
  .toLowerCase()
  .regex(TYPE_PATTERN, 'A placement name may contain only lowercase letters, digits, dash and underscore');

/**
 * The upload body.
 *
 * The FILE is not described here — it arrives as multipart and is checked by
 * `upload.inspect`, on its bytes rather than its name. This covers the fields
 * that ride alongside it.
 */
const uploadBody = z
  .object({
    type: placement,
    /** Optional operator-facing label. Not shown to players. */
    label: z.string().trim().max(120).optional(),

    /**
     * The slide copy — migration 037. All optional: an image-only banner is a
     * banner, and every row written before that migration is one.
     *
     * Lengths match the columns exactly so an over-long headline is a 422 here
     * rather than a truncation nobody notices, or a 500 from the database.
     */
    title: z.string().trim().max(160).optional(),
    subtitle: z.string().trim().max(300).optional(),
    ctaLabel: z.string().trim().max(60).optional(),
    /**
     * Restricted to a site-relative path or an http(s) url, so a slide's button
     * cannot be made to carry `javascript:` — this value is rendered straight
     * into an anchor's href on the home page.
     */
    ctaHref: z
      .string()
      .trim()
      .max(500)
      .regex(/^(\/[^\s]*|https?:\/\/[^\s]+)$/i, 'must be a site path or an http(s) url')
      .optional(),
    /** Position among the slides. Multipart sends numbers as strings. */
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .strict()
  /*
   * A label with nowhere to go is a button that does nothing, and an href with
   * no label is invisible. They are only meaningful as a pair, so the schema
   * refuses half of one rather than letting the front end guess.
   */
  .refine((v) => Boolean(v.ctaLabel) === Boolean(v.ctaHref), {
    message: 'ctaLabel and ctaHref must be given together',
    path: ['ctaLabel'],
  });

module.exports = {
  createBanner: { body: uploadBody },

  updateBanner: { body: uploadBody },

  byType: {
    params: z.object({ type: placement }).strict(),
  },

  list: {
    query: z
      .object({
        /**
         * Whether to include placements that have been taken down. Defaults to
         * active only, because that is what the site renders.
         */
        includeInactive: z.coerce.boolean().default(false),
      })
      .strict(),
  },

  /**
   * @legacy GET /api/banners/image/:filename
   *
   * The filename is now an id or a placement name — the bytes are in the row.
   * Legacy took a path here and defended it with `path.basename`, which is
   * correct as far as it goes; there is simply no path to traverse any more.
   */
  image: {
    params: z
      .object({
        filename: z.string().trim().min(1).max(120),
      })
      .strict(),
  },

  setActive: {
    params: z.object({ type: placement }).strict(),
    body: z.object({ active: z.boolean() }).strict(),
  },
};
