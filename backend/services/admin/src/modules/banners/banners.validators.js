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
  })
  .strict();

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
