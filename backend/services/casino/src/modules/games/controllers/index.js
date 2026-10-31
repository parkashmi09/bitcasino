'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * Answer an `<img src>` with a provider logo's bytes — the banner image
 * route's headers, for the same reasons: the bytes came from an upload.
 * `immutable` because the public URL is versioned by upload time.
 */
function sendLogo(res, image, { immutable, cacheControl }) {
  res.set({
    'Content-Type': image.contentType,
    'Content-Length': String(image.byteSize),
    'Cache-Control': cacheControl || (immutable ? 'public, max-age=31536000, immutable' : 'private, no-cache'),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  if (image.updatedAt) res.set('Last-Modified', new Date(image.updatedAt).toUTCString());
  return res.status(200).end(image.data);
}

function createControllers({ service }) {
  const paged = (req, result, extra = {}) =>
    response.paginated(req.res, result.rows, {
      page: req.query.page,
      limit: req.query.limit,
      total: result.total,
      ...extra,
    });

  return {
    // ── Lobby ─────────────────────────────────────────────────────────

    /** @legacy GET /api/gis/gamesgis */
    browse: asyncHandler(async (req, res) => {
      const result = await service.browse(req.query);
      return response.paginated(res, result.rows, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
        prioritizedApplied: result.prioritizedApplied,
      });
    }),

    /** @legacy GET /api/gis/gamesgis/provider/:provider — 500 on every request */
    byProvider: asyncHandler(async (req, res) => {
      const result = await service.browseByProvider({ ...req.query, provider: req.params.provider });
      return response.paginated(res, result.rows, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
        prioritizedApplied: result.prioritizedApplied,
      });
    }),

    /** The game screen's read — one catalogue row by uuid. */
    byUuid: asyncHandler(async (req, res) => response.ok(res, await service.byUuid(req.params.uuid))),

    bySlug: asyncHandler(async (req, res) => response.ok(res, await service.bySlug(req.params.slug))),

    /** @legacy GET /api/gis/gamesgis/stats */
    stats: asyncHandler(async (_req, res) => response.ok(res, await service.stats())),

    /** @legacy GET /api/gis/providersgis */
    providers: asyncHandler(async (req, res) => response.ok(res, await service.listProviders(req.query))),

    /**
     * @legacy GET /api/gis/hotgames, /livecasino, /popularslots, /crashgames
     */
    collection: asyncHandler(async (req, res) =>
      paged(req, await service.collection({ ...req.query, collection: req.params.collection }))
    ),

    /** Lobby categories: the site reads active ones, the admin reads all (`req.staff`). */
    categories: asyncHandler(async (req, res) => response.ok(res, await service.categories({ includeInactive: Boolean(req.staff) }))),
    categoryGames: asyncHandler(async (req, res) =>
      paged(req, await service.categoryGames({ ...req.query, slug: req.params.slug, includeInactive: Boolean(req.staff), automatic: Boolean(req.staff) }))
    ),
    createCategory: asyncHandler(async (req, res) => response.created(res, await service.createCategory({ ...req.body, actor: req.staff }))),
    updateCategory: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateCategory({ ...req.body, slug: req.params.slug, actor: req.staff }))
    ),
    reorderCategories: asyncHandler(async (req, res) => response.ok(res, await service.reorderCategories(req.body))),
    deleteCategory: asyncHandler(async (req, res) => response.ok(res, await service.deleteCategory({ slug: req.params.slug, actor: req.staff }))),

    putGameImage: asyncHandler(async (req, res) =>
      response.ok(res, await service.putGameImage({ uuid: req.params.uuid, file: req.file, actor: req.staff }))
    ),
    pickList: asyncHandler(async (req, res) => response.ok(res, await service.pickList(req.query))),

    /** @legacy GET /api/gis/admin/gis/games/search */
    search: asyncHandler(async (req, res) => response.ok(res, await service.search(req.query))),

    /** A provider's logo, for the lobby. A switched-off provider's is not served. */
    artwork: asyncHandler(async (req, res) =>
      sendLogo(res, await service.artwork({ name: req.params.name }), { cacheControl: 'public, max-age=86400' })
    ),
    providerLogo: asyncHandler(async (req, res) =>
      sendLogo(res, await service.providerLogo({ name: req.params.name }), { immutable: Boolean(req.query.v) })
    ),

    // ── Player ────────────────────────────────────────────────────────

    /** @legacy GET /api/gis/games/recently-played?user_id= — took any id */
    recentlyPlayed: asyncHandler(async (req, res) =>
      response.ok(res, await service.recentlyPlayed({ ...req.query, userId: req.user.id }))
    ),

    /** New here — nothing on this platform stored a favourite. See migration 038. */
    favourites: asyncHandler(async (req, res) =>
      response.ok(res, await service.favourites({ ...req.query, userId: req.user.id }))
    ),

    addFavourite: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.addFavourite({
          userId: req.user.id,
          gameRef: req.params.gameRef,
          source: req.body?.source,
        })
      )
    ),

    removeFavourite: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.removeFavourite({ userId: req.user.id, gameRef: req.params.gameRef })
      )
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy POST /api/gis/admin/gis/hotgames and its four siblings */
    setCollection: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setCollection({
          collection: req.params.collection,
          uuids: req.body.uuids,
          actor: req.staff,
        })
      )
    ),

    /** @legacy GET /api/gis/admin/gis/vendors */
    vendors: asyncHandler(async (_req, res) => response.ok(res, await service.vendorList())),

    /** @legacy GET /api/gis/admin/gis/types */
    types: asyncHandler(async (_req, res) => response.ok(res, await service.typeList())),

    /** @legacy GET /api/gis/admin/gis/priority/:vendor */
    vendorPriority: asyncHandler(async (req, res) => response.ok(res, await service.vendorPriority(req.params))),

    /** @legacy POST /api/gis/admin/gis/priority/:vendor */
    setVendorPriority: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setVendorPriority({
          vendor: req.params.vendor,
          uuids: req.body.uuids,
          actor: req.staff,
        })
      )
    ),

    /** @legacy GET /api/gis/admin/gis/type-priority/:type */
    typePriority: asyncHandler(async (req, res) => response.ok(res, await service.typePriority(req.params))),

    /** @legacy POST /api/gis/admin/gis/type-priority/:type */
    setTypePriority: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setTypePriority({
          type: req.params.type,
          uuids: req.body.uuids,
          actor: req.staff,
        })
      )
    ),

    /** @legacy GET /api/gis/admin/gis/vendor-search */
    searchWithinVendor: asyncHandler(async (req, res) =>
      response.ok(res, await service.searchWithinVendor(req.query))
    ),

    /** @legacy GET /api/gis/admin/gis/type-search */
    searchWithinType: asyncHandler(async (req, res) => response.ok(res, await service.searchWithinType(req.query))),

    /** @legacy PUT /api/gis/admin/gis/games/:uuid/image */
    updateImage: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateImage({ ...req.params, ...req.body, actor: req.staff }))
    ),

    /** @legacy GET /api/gis/admin/providers */
    upstreamProviders: asyncHandler(async (_req, res) => response.ok(res, await service.upstreamProviders())),

    /** The admin's search: switched-off providers' games included. */
    adminSearch: asyncHandler(async (req, res) =>
      response.ok(res, await service.search({ ...req.query, includeDisabled: true }))
    ),

    // ── Lobby provider settings (migration 067) ───────────────────────

    providerSettings: asyncHandler(async (_req, res) => response.ok(res, await service.providerSettingsList())),

    updateProviderSetting: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateProviderSetting({ ...req.body, name: req.params.name, actor: req.staff }))
    ),

    putProviderLogo: asyncHandler(async (req, res) =>
      response.ok(res, await service.putProviderLogo({ name: req.params.name, file: req.file, actor: req.staff }))
    ),

    putProviderLogoUrl: asyncHandler(async (req, res) =>
      response.ok(res, await service.putProviderLogoFromUrl({ name: req.params.name, url: req.body.url, actor: req.staff }))
    ),

    removeProviderLogo: asyncHandler(async (req, res) =>
      response.ok(res, await service.removeProviderLogo({ name: req.params.name, actor: req.staff }))
    ),

    /** The admin preview: served whether or not the provider is switched on. */
    adminProviderLogo: asyncHandler(async (req, res) =>
      sendLogo(res, await service.providerLogo({ name: req.params.name, includeDisabled: true }), { immutable: false })
    ),

    /** @legacy PUT /api/gis/admin/providers */
    setUpstreamProviders: asyncHandler(async (req, res) =>
      response.ok(res, await service.setUpstreamProviders({ ...req.body, actor: req.staff }))
    ),
  };
}

module.exports = { createControllers };
