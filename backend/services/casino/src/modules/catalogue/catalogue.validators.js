'use strict';

const { z } = require('@ibitplay/common');

const { MAX_PAGE_SIZE, DEFAULT_PROVIDER } = require('./catalogue.constants');

const paging = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

/**
 * A provider or vendor code.
 *
 * Constrained because it goes into an upstream request body. Legacy passed
 * `req.query.s` through untouched.
 */
const code = z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/);

module.exports = {
  /** @legacy GET /api/games/list, /api/gis/games, /api/gis/games/provider */
  localGames: {
    query: z
      .object({
        type: z.string().trim().max(60).optional(),
        vendor: z.string().trim().max(60).optional(),
        search: z.string().trim().min(1).max(80).optional(),
        ...paging,
      })
      .strict(),
  },

  /** @legacy GET /api/gis/providers */
  localVendors: { query: z.object({}).strict() },

  /** @legacy GET /api/casino/vendors */
  hubVendors: { query: z.object({}).strict() },

  /** @legacy GET /api/casino/games/list */
  hubGames: {
    query: z
      .object({
        type: z.string().trim().max(60).optional(),
        vendor: z.string().trim().max(60).optional(),
      })
      .strict(),
  },

  /** @legacy GET /api/casino/games/lists */
  hubFeatured: { query: z.object({}).strict() },

  /** @legacy GET /api/casino/jackpots */
  jackpots: {
    query: z.object({ currency: z.string().trim().max(20).optional() }).strict(),
  },

  /** @legacy GET /game-list, /game-list-new */
  nexusGames: {
    query: z.object({ provider: code.default(DEFAULT_PROVIDER) }).strict(),
  },

  /**
   * @legacy POST /game_launch, /game_launch_new
   *
   * `user_code` is deliberately absent — the account comes from the token.
   */
  launch: {
    body: z
      .object({
        providerCode: code,
        gameCode: z.string().trim().min(1).max(120),
        language: z.string().trim().max(12).optional(),
      })
      .strict(),
  },

  /**
   * @legacy POST /update-image, /update-gis-images-run-all
   *
   * `previewOnly` has NO DEFAULT of false. It must be sent explicitly, because
   * the preview is the only thing between a mistake and every image in the
   * lobby — and a name-matched bulk update is a mistake waiting for two games
   * from different vendors to share a title.
   */
  syncImages: {
    body: z
      .object({
        previewOnly: z.boolean(),
        limit: z.coerce.number().int().min(1).max(5000).default(1000),
      })
      .strict(),
  },
};
