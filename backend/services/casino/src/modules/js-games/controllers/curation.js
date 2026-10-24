'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * The curation half of the js-games module.
 *
 * Its own controller file rather than more entries in `controllers/index.js`:
 * that one is built around `service` being `JsGamesService`, and curation is a
 * different service with a different dependency set. Two factories keep the
 * wiring honest about which routes need the provider clients and which do not.
 */
function createCurationControllers({ service }) {
  return {
    // ── admin: what there is to curate ────────────────────────────────
    vendors: asyncHandler(async (_req, res) => response.ok(res, await service.vendorList())),
    types: asyncHandler(async (_req, res) => response.ok(res, await service.typeList())),
    collections: asyncHandler(async (_req, res) => response.ok(res, await service.collectionList())),

    // ── admin: one curated list ───────────────────────────────────────
    readCuration: asyncHandler(async (req, res) => response.ok(res, await service.read(req.params))),
    writeCuration: asyncHandler(async (req, res) =>
      response.ok(res, await service.write({ ...req.params, gameUids: req.body.gameUids, actor: req.staff }))
    ),

    // ── admin: the picker, and the tile image ─────────────────────────
    searchCatalogue: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.search({
          q: req.query.q,
          vendor: req.query.vendor,
          type: req.query.type,
          limit: req.query.limit,
          activeOnly: !req.query.include_inactive,
        })
      )
    ),
    updateIcon: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateIcon({ gameUid: req.params.gameUid, icon: req.body.icon, actor: req.staff }))
    ),

    // ── public: what the lobby renders ────────────────────────────────
    collection: asyncHandler(async (req, res) => {
      const result = await service.collection({
        collection: req.params.collection,
        page: req.query.page,
        perPage: req.query.per_page,
      });
      return response.paginated(res, result.rows, {
        page: req.query.page,
        limit: req.query.per_page,
        total: result.total,
      });
    }),
  };
}

module.exports = { createCurationControllers };
