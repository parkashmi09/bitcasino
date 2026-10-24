'use strict';

// `where` is aliased because the name collides with the plain `where` objects
// this file builds everywhere; `whereExpr` says it is the function form.
const { Op, fn, col, literal, QueryTypes, where: whereExpr } = require('sequelize');

const E = require('./games.errors');
const { fetchPublicImage } = require('./publicImage');
const {
  COLLECTIONS,
  NAME_CATEGORIES,
  LIVE_PROVIDERS,
  LIVE_TYPES,
  TYPE_CATEGORIES,
  GAME_FIELDS,
  GAME_SUMMARY_FIELDS,
  MAX_COLLECTION_SIZE,
  RECENTLY_PLAYED_LIMIT,
  FAVOURITES_LIMIT,
  POPULAR_WINDOW_DAYS,
  POPULAR_LIMIT,
  LIST_CACHE_MS,
} = require('./games.constants');
const {
  providerKey,
  disabledProviders,
  withoutDisabled,
  withoutDisabledGames,
  isProviderDisabled,
} = require('./providerSwitch');
const { imageUpload, money, wagerCategory } = require('@ibitplay/common');

/** A provider logo is a small mark, not a hero image. */
const LOGO_MAX_BYTES = 1024 * 1024;

/**
 * A game's page slug in SQL: `<name>-by-<provider>`, each part lowercased with every run
 * of non-alphanumerics one dash. `slugPart` below and the frontend's `gameSlug` are the
 * same rule; the three must not drift, or a tile links to a page that cannot find it.
 */
const SLUG_PART_SQL = (column) => `trim(both '-' from regexp_replace(lower("${column}"), '[^a-z0-9]+', '-', 'g'))`;
const SLUG_SQL = `${SLUG_PART_SQL('name')} || '-by-' || ${SLUG_PART_SQL('provider')}`;
/** The suffix a colliding slug carries: the uuid's first eight letters and digits. */
const SLUG_SUFFIX_SQL = `left(regexp_replace(lower("uuid"), '[^a-z0-9]', '', 'g'), 8)`;

/** LOWER(BTRIM(column)) — how a provider's own `type` / `provider` word is compared. */
const folded = (column) => fn('LOWER', fn('BTRIM', col(column)));

/**
 * Rows in a lobby category: the import's normalised tag (`tags @> '["slots"]'`), or — for a
 * catalogue without those tags, Slotegrator's — the row's own type and provider
 * (TYPE_CATEGORIES, LIVE_PROVIDERS in games.constants.js).
 */
function categoryMatch(key) {
  const tagged = { tags: { [Op.contains]: [key] } };
  const isLive = { [Op.or]: [whereExpr(folded('provider'), { [Op.in]: LIVE_PROVIDERS }), whereExpr(folded('type'), { [Op.in]: LIVE_TYPES })] };
  if (key === 'live') return { [Op.or]: [tagged, isLive] };
  const types = TYPE_CATEGORIES[key];
  if (!types) return tagged;
  const byType = whereExpr(folded('type'), { [Op.in]: types });
  // A live provider's table game is `live`, not `table`.
  const typed = key === 'table' ? { [Op.and]: [byType, whereExpr(folded('provider'), { [Op.notIn]: LIVE_PROVIDERS })] } : byType;
  return { [Op.or]: [tagged, typed] };
}

/** True for a row with no artwork: the lobby lists those after the rest (`#order`). */
const NO_ART_SQL = `(coalesce("image", '') = '')`;
/* Slotegrator's own art (gis-static.com) is 287x193 landscape: it crops badly in the 3:4 tile,
   so those games rank after the ones with portrait art (fix-game-artwork.js replaces it). */
const LANDSCAPE_ART_SQL = `(coalesce("image", '') ILIKE '%gis-static.com%')`;
const noArt = (row) => (!row.image ? 2 : /gis-static\.com/i.test(row.image) ? 1 : 0);

/**
 * Two catalogue rows that would draw the same tile — same name, provider, type and art —
 * are one game listed twice by the provider (2j lists five such pairs). The lobby lists
 * show the earlier uuid only; the other is still readable by its uuid, so a favourite or a
 * history row that names it keeps working.
 */
const NOT_A_LATER_TWIN = literal(
  'NOT EXISTS (SELECT 1 FROM gisgamesnew twin WHERE twin.name = "Gisgamesnew".name' +
    ' AND twin.provider = "Gisgamesnew".provider' +
    ' AND twin.type IS NOT DISTINCT FROM "Gisgamesnew".type' +
    ' AND twin.image IS NOT DISTINCT FROM "Gisgamesnew".image' +
    ' AND twin.uuid < "Gisgamesnew".uuid)'
);

/**
 * Slotegrator lists most games twice: "Le Bandit" (desktop) and "Le Bandit Mobile"
 * (`is_mobile`), same provider. The lobby shows ONE tile — the desktop row — and the launch
 * opens the right one for the player's device (`gameLauncher.js` `deviceVariant`). A
 * "… Mobile" row with no desktop partner is the only copy and stays listed.
 */
const MOBILE_SUFFIX = '\\s+mobile$';
const NOT_A_MOBILE_TWIN = literal(
  `NOT ("Gisgamesnew".name ~* '${MOBILE_SUFFIX}' AND EXISTS (SELECT 1 FROM gisgamesnew desk` +
    ' WHERE desk.provider = "Gisgamesnew".provider' +
    ` AND LOWER(desk.name) = LOWER(REGEXP_REPLACE("Gisgamesnew".name, '${MOBILE_SUFFIX}', '', 'i'))` +
    ' AND desk.uuid <> "Gisgamesnew".uuid))'
);

/** Merge the twin rules into a `where` without disturbing the filters already in it. */
const withoutTwins = (where) => ({ ...where, [Op.and]: [...(where[Op.and] ?? []), NOT_A_LATER_TWIN, NOT_A_MOBILE_TWIN] });

/**
 * The local game catalogue and the curation on top of it.
 *
 * Everything here reads `gisgamesnew`, which the Slotegrator sync fills. No
 * money moves through this module; the wallet callback lives in `gis`.
 *
 * ── WHAT CHANGED ─────────────────────────────────────────────────────────
 *
 * EVERY CURATION ENDPOINT WAS UNAUTHENTICATED. `POST /api/gis/admin/gis/hotgames`
 * and its four siblings, both priority setters, and `PUT /admin/gis/games/:uuid/image`
 * were mounted with no guard at all — the routes file even carries the comment
 * `// Admin (protect this)`. Anyone who could reach the server could rewrite the
 * front page of the casino and point every game tile at an image of their
 * choosing. They are admin-audience routes here, so the module loader attaches
 * staff auth and a module physically cannot forget it.
 *
 * TWO ENDPOINTS RETURNED 500 UNCONDITIONALLY.
 *   `GET /api/gis/gamesgis/provider/:provider` called a bare `getGamesgis(...)`,
 *   which is a property of the exported object and not a binding in scope —
 *   a ReferenceError on every request.
 *   `GET /api/gis/game-tags` and `GET /api/gis/games/provider` both called
 *   `pag(r.headers)`, and `pag` is not defined anywhere in the file.
 *
 * PRIORITIZED GAMES APPEARED TWICE. The priority overlay was applied only on
 * page 1, and later pages were a plain `ORDER BY name` with no exclusion — so a
 * prioritized game showed at the top of page 1 and again in its alphabetical
 * position further in. Priority is a stable ordering over the whole result set
 * here, so each game appears once.
 *
 * STATS READ A DIFFERENT CATALOGUE. `getGameStats` counted `gis_games` while
 * every other endpoint read `gisgamesnew`, and the `syncGames` that fills
 * `gis_games` truncates it first. The numbers described a table nothing served
 * from, and were zero for the length of a sync.
 */
class GamesService {
  /** `{ at, ids }` — the popularity ranking, reused for `LIST_CACHE_MS`. */
  #popular = null;
  /** `{ at, uuids }` — the rows whose slug collides with an earlier row's. */
  #suffixed = null;

  constructor({ models, db, config, logger, clients }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.clients = clients;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Browsing
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/gis/gamesgis
   *
   * The lobby listing: filters, then the curated ordering for the vendor or
   * type in play, then everything else alphabetically. `sort=popular` puts
   * the games players open most between the two (see `#popularIds`).
   */
  async browse(query) {
    const { page, limit, ...filters } = query;
    // A provider the site admin switched off is not in the lobby (migration 067).
    const where = withoutTwins(
      withoutDisabled(this.#filterClause(filters), await disabledProviders(this.models))
    );
    const order = this.#order(filters.is_mobile, filters.sort);

    const total = await this.models.Gisgamesnew.count({ where });
    // A chosen A–Z / Z–A order replaces the curated one.
    const curated = filters.sort && filters.sort !== 'popular' ? [] : await this.#priorityFor(filters);
    const priorityIds =
      filters.sort === 'popular' ? [...new Set([...curated, ...(await this.#popularIds())])] : curated;

    if (!priorityIds.length) {
      const rows = await this.models.Gisgamesnew.findAll({
        where,
        attributes: [...GAME_FIELDS],
        order,
        limit,
        offset: (page - 1) * limit,
        raw: true,
      });
      return { rows: await this.#withSlugs(rows), total, prioritizedApplied: false };
    }

    return {
      rows: await this.#withSlugs(await this.#pageWithPriority({ where, order, priorityIds, page, limit })),
      total,
      prioritizedApplied: true,
    };
  }

  /**
   * One game, by its catalogue uuid.
   *
   * The game screen's own read. Nothing else could answer it: `browse` pages a
   * filtered list and `search` matches a NAME, so a page opened from a link —
   * or reloaded, or shared — had no way to turn the uuid in its URL back into
   * a game, and the only alternative was to carry the row through client-side
   * navigation state and show nothing to anyone who arrived directly.
   *
   * `GAME_FIELDS` and not a narrower projection: this is the same row the
   * lobby tile was built from, so the screen behind the tile can render the
   * artwork and the provider without a second read.
   */
  async byUuid(uuid) {
    const row = await this.models.Gisgamesnew.findOne({
      where: { uuid },
      attributes: [...GAME_FIELDS],
      raw: true,
    });
    if (!row) throw E.NOT_FOUND({ uuid });
    await this.#assertProviderOn(row.provider);
    const [withSlug] = await this.#withSlugs([row]);
    return withSlug;
  }

  /**
   * One game by its page slug: `<name>-by-<provider>`, each part lowercased with every run
   * of non-alphanumerics turned into one dash (the frontend's `gameSlug` does the same).
   *
   * Two rows can share that slug — 2j's "DRAGON & TIGER" and "DRAGON TIGER" do. The lowest
   * uuid keeps the plain slug, so every link made before collisions were told apart opens
   * the row it always opened; each later row is `<slug>-<first 8 of its uuid>` (`#withSlugs`
   * hands that out). A suffixed slug is matched by the uuid itself, so it keeps opening its
   * row whatever else joins or leaves the catalogue.
   */
  async bySlug(slug) {
    const find = (where) =>
      this.models.Gisgamesnew.findOne({ where, attributes: [...GAME_FIELDS], order: [['uuid', 'ASC']], raw: true });

    let row = await find(whereExpr(literal(SLUG_SQL), slug));
    const suffixed = !row && /^(.+)-([a-z0-9]{1,8})$/.exec(slug);
    if (suffixed) {
      row = await find({
        [Op.and]: [whereExpr(literal(SLUG_SQL), suffixed[1]), whereExpr(literal(SLUG_SUFFIX_SQL), suffixed[2])],
      });
    }
    if (!row) throw E.NOT_FOUND({ slug });
    await this.#assertProviderOn(row.provider);
    const [withSlug] = await this.#withSlugs([row]);
    return withSlug;
  }

  /**
   * Each row with its page `slug`, the one `bySlug` resolves: the plain slug, or the
   * suffixed one when an earlier uuid already holds it. The frontend links by this field.
   */
  async #withSlugs(rows) {
    if (!rows.length) return rows;
    const suffixed = await this.#suffixedSlugs();
    return rows.map((row) => ({ ...row, slug: gameSlug(row, suffixed.has(row.uuid)) }));
  }

  /** The uuids whose plain slug an earlier uuid already holds. One window query, reused for a minute. */
  async #suffixedSlugs() {
    if (this.#suffixed && Date.now() - this.#suffixed.at < LIST_CACHE_MS) return this.#suffixed.uuids;
    const rows = await this.models.Gisgamesnew.sequelize.query(
      `SELECT uuid FROM (SELECT uuid, row_number() OVER (PARTITION BY ${SLUG_SQL} ORDER BY uuid) AS n FROM gisgamesnew) s WHERE n > 1`,
      { type: QueryTypes.SELECT }
    );
    this.#suffixed = { at: Date.now(), uuids: new Set(rows.map((r) => r.uuid)) };
    return this.#suffixed.uuids;
  }

  /**
   * The popularity ranking behind `sort=popular`: the games the most distinct players
   * launched in the last `POPULAR_WINDOW_DAYS`, then the most launches, best first.
   *
   * `game_sessions` (one row per launch) is the only per-game play signal this catalogue
   * has: the GIS and js-games bet tables name a game too, but nothing settles through
   * them on this platform yet. The result is reused for a minute, not read per page.
   */
  async #popularIds() {
    if (this.#popular && Date.now() - this.#popular.at < LIST_CACHE_MS) return this.#popular.ids;
    let ids = [];
    if (this.models.GameSession) {
      const rows = await this.models.GameSession.findAll({
        attributes: ['game_uid'],
        where: { created_at: { [Op.gte]: new Date(Date.now() - POPULAR_WINDOW_DAYS * 86_400_000) } },
        group: ['game_uid'],
        order: [
          [fn('COUNT', fn('DISTINCT', col('user_id'))), 'DESC'],
          [fn('COUNT', col('id')), 'DESC'],
          ['game_uid', 'ASC'],
        ],
        limit: POPULAR_LIMIT,
        raw: true,
      });
      ids = rows.map((r) => r.game_uid);
    }
    this.#popular = { at: Date.now(), ids };
    return ids;
  }

  /**
   * The game screen of a switched-off provider says so, rather than 404: the
   * tile may still be in a player's favourites, and "not available" is the
   * truth where "not found" is not.
   */
  async #assertProviderOn(provider) {
    if (provider && (await isProviderDisabled(this.models, provider))) {
      throw E.PROVIDER_DISABLED({ provider });
    }
  }

  /**
   * @legacy GET /api/gis/gamesgis/provider/:provider — 500 on every request.
   */
  async browseByProvider({ provider, ...query }) {
    await this.#assertProviderOn(provider);
    const result = await this.browse({ ...query, provider });
    if (!result.total) throw E.PROVIDER_NOT_FOUND({ provider });
    return result;
  }

  /**
   * A page of the result set with the curated games ordered first.
   *
   * Two disjoint sets — prioritized-and-matching, and everything else — walked
   * as if they were one list. That keeps the ordering stable across pages,
   * which the SQL version only managed for page 1.
   */
  async #pageWithPriority({ where, order, priorityIds, page, limit }) {
    const offset = (page - 1) * limit;

    // Only the curated games that survive the current filters count towards
    // the priority block; a game hidden by `?technology=` must not hold a slot.
    const promoted = await this.models.Gisgamesnew.findAll({
      where: { ...where, uuid: { [Op.in]: priorityIds } },
      attributes: [...GAME_FIELDS],
      raw: true,
    });

    const rank = new Map(priorityIds.map((uuid, index) => [uuid, index]));
    promoted.sort((a, b) => noArt(a) - noArt(b) || rank.get(a.uuid) - rank.get(b.uuid));

    const rows = promoted.slice(offset, offset + limit);
    if (rows.length === limit) return rows;

    const rest = await this.models.Gisgamesnew.findAll({
      where: { ...where, uuid: { [Op.notIn]: priorityIds } },
      attributes: [...GAME_FIELDS],
      order,
      limit: limit - rows.length,
      offset: Math.max(0, offset - promoted.length),
      raw: true,
    });

    return [...rows, ...rest];
  }

  /**
   * Which curated ordering applies, if any.
   *
   * A type filter wins over a provider filter — legacy's precedence, kept
   * because the type lists were added later and deliberately override.
   */
  async #priorityFor({ type, provider }) {
    if (type) {
      const row = await this.#findPriority(this.models.GisPrioritizedTypes, 'type', type);
      const ids = this.#splitIds(row?.game_ids);
      if (ids.length) return ids;
    }

    if (provider) {
      const row = await this.#findPriority(this.models.GisPrioritizedGames, 'vendor', provider);
      return this.#splitIds(row?.game_ids);
    }

    return [];
  }

  #filterClause({ provider, type, category, search, technology, has_lobby: hasLobby, has_freespins: hasFreespins }) {
    const where = {};

    // Case-insensitive equality, as legacy's `LOWER(x) = LOWER(?)` was — a
    // vendor saved as "Evolution" must match a filter of "evolution".
    if (provider) {
      const list = provider.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30);
      where.provider = list.length > 1 ? { [Op.iLike]: { [Op.any]: list } } : { [Op.iLike]: list[0] ?? provider };
    }
    if (type) where.type = { [Op.iLike]: type };

    /**
     * `category` is the NORMALISED type, and `type` is the provider's own.
     *
     * ── WHY BOTH EXIST ───────────────────────────────────────────────────
     *
     * `type` is an exact match against whatever the provider wrote, and this
     * catalogue's providers wrote five different words for one thing:
     * `Slot Game`, `Slots`, `Slot`, `slot`, `Video Slot`. So `?type=slots`
     * matches 310 rows out of 1,362 that are slots, and no single value
     * matches them all — which is why the browse pages could not be filtered
     * by a category at all and fell back to captured lists.
     *
     * The import writes one normalised word per row into `tags` (see seeder
     * 004): `slots`, `live`, `table`, `crash`, `arcade`, `fishing`, `lottery`,
     * `lobby`, `other`. `category` matches THAT, so `?category=slots` is all
     * 1,362 of them.
     *
     * `type` is left exactly as it was: an operator filtering on a provider's
     * own word is a different question, and the admin pickers ask it.
     */
    const key = category ? String(category).toLowerCase() : '';
    const named = Object.hasOwn(NAME_CATEGORIES, key) ? NAME_CATEGORIES[key] : undefined;
    if (named) {
      // Not a tag the import wrote: match the name (see NAME_CATEGORIES).
      if (named.tag) where[Op.and] = [...(where[Op.and] ?? []), categoryMatch(named.tag)];
      where.name = { [Op.iRegexp]: named.pattern };
    } else if (category) {
      where[Op.and] = [...(where[Op.and] ?? []), categoryMatch(key)];
    }
    if (technology) where.technology = { [Op.iLike]: technology };
    // Merged, so a search inside a name category keeps both conditions.
    if (search) where.name = { ...where.name, [Op.iLike]: `%${search}%` };
    if (hasLobby !== undefined) where.has_lobby = hasLobby;
    if (hasFreespins !== undefined) where.has_freespins = hasFreespins;

    return where;
  }

  /**
   * `is_mobile` sorts, it does not filter.
   *
   * The lobby's own order (no `sort`, or `popular`) puts the games with artwork first:
   * 512 catalogue rows have no art a browser can draw, and a page of placeholder tiles
   * above a page of pictures is the wrong way round. An art-less game is still listed, after the rest.
   * A chosen A–Z / Z–A is the player's order and stays strictly alphabetical. `uuid`
   * breaks ties between equal names so a page boundary never moves.
   */
  #order(isMobile, sort) {
    const byName = ['name', sort === 'za' ? 'DESC' : 'ASC'];
    const order = [];
    if (isMobile !== undefined) order.push(['is_mobile', isMobile ? 'DESC' : 'ASC']);
    if (sort !== 'az' && sort !== 'za') order.push([literal(NO_ART_SQL), 'ASC'], [literal(LANDSCAPE_ART_SQL), 'ASC']);
    order.push(byName, ['uuid', 'ASC']);
    return order;
  }

  /**
   * @legacy GET /api/gis/gamesgis/stats
   *
   * Read from `gisgamesnew`, which is what the lobby serves. Legacy counted
   * `gis_games`, a second catalogue filled by a different sync that truncates
   * before it repopulates.
   */
  async stats() {
    const visible = withoutTwins(withoutDisabled({}, await disabledProviders(this.models)));

    const [totals] = await this.models.Gisgamesnew.findAll({
      where: visible,
      attributes: [
        [fn('COUNT', col('id')), 'total_games'],
        [fn('COUNT', fn('DISTINCT', col('provider'))), 'total_providers'],
        [fn('COUNT', fn('DISTINCT', col('type'))), 'total_types'],
        // Aggregate filters have no `fn()` form, so they are written out. The
        // text is fixed — no request value reaches it.
        [literal('COUNT(*) FILTER (WHERE has_lobby)'), 'games_with_lobby'],
        [literal('COUNT(*) FILTER (WHERE is_mobile)'), 'mobile_games'],
        [literal('COUNT(*) FILTER (WHERE has_freespins)'), 'games_with_freespins'],
      ],
      raw: true,
    });

    const grouped = async (column, limit) =>
      this.models.Gisgamesnew.findAll({
        attributes: [[col(column), column], [fn('COUNT', col('id')), 'game_count']],
        where: { ...visible, [column]: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        group: [column],
        order: [[fn('COUNT', col('id')), 'DESC']],
        ...(limit ? { limit } : {}),
        raw: true,
      });

    return {
      stats: this.#numeric(totals),
      topProviders: await grouped('provider', 10),
      gameTypes: await grouped('type'),
    };
  }

  /** Postgres returns COUNT as a string; the shape says these are numbers. */
  #numeric(row) {
    return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)]));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Curated collections
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/gis/hotgames, /livecasino, /popularslots, /crashgames
   */
  async collection({ collection, page, limit }) {
    const { model, key } = this.#collection(collection);

    const row = await this.models[model].findOne({ where: { key }, raw: true });
    const ids = this.#splitIds(row?.game_uuids);
    if (!ids.length) return { rows: [], total: 0 };

    const games = await this.models.Gisgamesnew.findAll({
      // A curated "… Mobile" twin is shown as its desktop tile's game, not a second tile.
      where: withoutTwins(withoutDisabled({ uuid: { [Op.in]: ids } }, await disabledProviders(this.models))),
      attributes: [...GAME_FIELDS],
      raw: true,
    });

    // Curated ORDER is the point of a collection, so it is restored here rather
    // than left to whatever the database returns.
    // Artwork first, curated order within each half (see `#order`).
    const rank = new Map(ids.map((uuid, index) => [uuid, index]));
    games.sort((a, b) => noArt(a) - noArt(b) || rank.get(a.uuid) - rank.get(b.uuid));

    const offset = (page - 1) * limit;
    return { rows: await this.#withSlugs(games.slice(offset, offset + limit)), total: games.length };
  }

  /**
   * @legacy POST /api/gis/admin/gis/hotgames and its four siblings —
   *         all unauthenticated.
   */
  async setCollection({ collection, uuids, actor }) {
    const { model, key, label } = this.#collection(collection);
    const clean = await this.#verifiedIds(uuids);

    await this.models[model].upsert({ key, game_uuids: clean.join(',') || null });

    this.logger?.info(
      { collection, count: clean.length, staffId: actor?.id },
      'Lobby collection replaced'
    );

    return { collection, label, count: clean.length, uuids: clean };
  }

  #collection(slug) {
    const found = COLLECTIONS[slug];
    if (!found) throw E.UNKNOWN_COLLECTION({ collection: slug });
    return found;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Per-vendor and per-type priority
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /api/gis/admin/gis/vendors */
  async vendorList() {
    const [counts, configured] = await Promise.all([
      this.models.Gisgamesnew.findAll({
        attributes: [['provider', 'vendor'], [fn('COUNT', col('id')), 'total']],
        where: { provider: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        group: ['provider'],
        order: [['provider', 'ASC']],
        raw: true,
      }),
      this.models.GisPrioritizedGames.findAll({ attributes: ['vendor', 'updated_at'], raw: true }),
    ]);

    const byVendor = new Map(configured.map((r) => [String(r.vendor).toLowerCase(), r]));

    return counts.map((row) => {
      const match = byVendor.get(String(row.vendor).toLowerCase());
      return {
        vendor: row.vendor,
        total: Number(row.total),
        has_priority: Boolean(match),
        priority_updated_at: match?.updated_at ?? null,
      };
    });
  }

  /** @legacy GET /api/gis/admin/gis/types */
  async typeList() {
    const [counts, configured] = await Promise.all([
      this.models.Gisgamesnew.findAll({
        attributes: ['type', [fn('COUNT', col('id')), 'total']],
        where: { type: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        group: ['type'],
        order: [['type', 'ASC']],
        raw: true,
      }),
      this.models.GisPrioritizedTypes.findAll({ attributes: ['type', 'updated_at'], raw: true }),
    ]);

    const byType = new Map(configured.map((r) => [String(r.type).trim().toLowerCase(), r]));

    return counts.map((row) => {
      const match = byType.get(String(row.type).trim().toLowerCase());
      return {
        type: String(row.type).trim(),
        total: Number(row.total),
        has_priority: Boolean(match),
        priority_updated_at: match?.updated_at ?? null,
      };
    });
  }

  /** @legacy GET /api/gis/admin/gis/priority/:vendor */
  async vendorPriority({ vendor }) {
    return this.#readPriority(this.models.GisPrioritizedGames, 'vendor', vendor);
  }

  /** @legacy GET /api/gis/admin/gis/type-priority/:type */
  async typePriority({ type }) {
    return this.#readPriority(this.models.GisPrioritizedTypes, 'type', type);
  }

  /** @legacy POST /api/gis/admin/gis/priority/:vendor — unauthenticated. */
  async setVendorPriority({ vendor, uuids, actor }) {
    return this.#writePriority(this.models.GisPrioritizedGames, 'vendor', vendor, uuids, actor);
  }

  /** @legacy POST /api/gis/admin/gis/type-priority/:type — unauthenticated. */
  async setTypePriority({ type, uuids, actor }) {
    return this.#writePriority(this.models.GisPrioritizedTypes, 'type', type, uuids, actor);
  }

  async #readPriority(model, column, value) {
    const row = await this.#findPriority(model, column, value);
    const ids = this.#splitIds(row?.game_ids);

    if (!ids.length) return { [column]: value, updated_at: null, games: [] };

    const games = await this.models.Gisgamesnew.findAll({
      where: { uuid: { [Op.in]: ids } },
      attributes: [...GAME_SUMMARY_FIELDS],
      raw: true,
    });

    const rank = new Map(ids.map((uuid, index) => [uuid, index]));
    games.sort((a, b) => rank.get(a.uuid) - rank.get(b.uuid));

    return { [column]: row[column], updated_at: row.updated_at, games };
  }

  /**
   * Replace a priority list.
   *
   * A single upsert against the unique key added by migration 016. Legacy ran
   * `UPDATE ... WHERE LOWER(vendor) = LOWER($1)` and inserted when it touched
   * zero rows — so two admins saving the same vendor together both updated
   * nothing and both inserted, and from then on which list applied depended on
   * an `ORDER BY updated_at DESC LIMIT 1` between two rows.
   */
  async #writePriority(model, column, value, uuids, actor) {
    const clean = await this.#verifiedIds(uuids);
    const key = String(value).trim();

    await this.db.transaction(async (transaction) => {
      const existing = await this.#findPriority(model, column, key, transaction);

      if (existing) {
        await model.update(
          { game_ids: clean.join(','), updated_at: new Date() },
          { where: { id: existing.id }, transaction }
        );
      } else {
        await model.create({ [column]: key, game_ids: clean.join(',') }, { transaction });
      }
    });

    this.logger?.info({ [column]: key, count: clean.length, staffId: actor?.id }, 'Game priority replaced');

    return { [column]: key, count: clean.length, uuids: clean };
  }

  /**
   * The stored row for a vendor or type, matched case- and whitespace-
   * insensitively — which is how it was written, and how the unique index
   * added by migration 016 keys it.
   */
  #findPriority(model, column, value, transaction) {
    return model.findOne({
      where: whereExpr(fn('LOWER', fn('BTRIM', col(column))), String(value).trim().toLowerCase()),
      order: [['updated_at', 'DESC']],
      raw: true,
      ...(transaction ? { transaction } : {}),
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Search
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/gis/admin/gis/games/search
   *
   * The lobby's search leaves out switched-off providers; the admin's
   * (`includeDisabled`) does not — curating a provider's games while it is off
   * is how an operator gets it ready to switch back on.
   */
  async search({ q, limit, includeDisabled = false }) {
    // A provider's second copy of one game is not a second result (see NOT_A_LATER_TWIN).
    const where = includeDisabled ? {} : withoutTwins(withoutDisabled({}, await disabledProviders(this.models)));
    return this.#rankedSearch({ q, limit, where });
  }

  /** @legacy GET /api/gis/admin/gis/vendor-search */
  async searchWithinVendor({ vendor, q, limit }) {
    return this.#rankedSearch({ q, limit, where: { provider: { [Op.iLike]: vendor } } });
  }

  /** @legacy GET /api/gis/admin/gis/type-search */
  async searchWithinType({ type, q, limit }) {
    return this.#rankedSearch({ q, limit, where: { type: { [Op.iLike]: type.trim() } } });
  }

  /**
   * Name-or-uuid search, exact match first, then prefix, then anywhere.
   *
   * Legacy expressed the ranking as a SQL CASE. It is done in JavaScript over
   * a bounded result set instead: the ordering is the same, and it does not
   * need the query text interpolated into an ORDER BY.
   */
  async #rankedSearch({ q, limit, where: scope }) {
    const term = String(q ?? '').trim();
    if (!term) return [];

    const rows = await this.models.Gisgamesnew.findAll({
      where: {
        ...scope,
        [Op.or]: [{ name: { [Op.iLike]: `%${term}%` } }, { uuid: { [Op.iLike]: `%${term}%` } }],
      },
      attributes: [...GAME_SUMMARY_FIELDS],
      // Fetch a little more than asked so the ranking has something to reorder,
      // then cut. Bounded, so a broad term cannot pull the whole catalogue.
      limit: Math.min(limit * 5, 500),
      order: [['name', 'ASC']],
      raw: true,
    });

    const lower = term.toLowerCase();
    const rank = (row) => {
      const name = String(row.name ?? '').toLowerCase();
      const uuid = String(row.uuid ?? '').toLowerCase();
      if (name === lower) return 0;
      if (name.startsWith(lower)) return 1;
      if (uuid.startsWith(lower)) return 2;
      return 3;
    };

    return this.#withSlugs(
      rows
        .sort((a, b) => rank(a) - rank(b) || String(a.name ?? '').localeCompare(String(b.name ?? '')))
        .slice(0, limit)
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Providers
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/gis/providersgis
   *
   * Each row keeps `name` (the catalogue's, which every filter and URL uses)
   * and gains what the site admin set: `displayName` and `logoUrl`, both null
   * when unset. A provider switched off is not listed. Ordered by the admin's
   * `sort_order` where one is set, then by name.
   */
  async listProviders({ search }) {
    const [rows, settings] = await Promise.all([this.#catalogueProviders(search), this.#providerSettings()]);

    const listed = rows
      .map((row) => ({ row, s: settings.get(providerKey(row.name)) }))
      .filter(({ s }) => s?.enabled !== false)
      .sort((a, b) => order(a.s) - order(b.s) || String(a.row.name).localeCompare(String(b.row.name)))
      .map(({ row, s }) => ({
        ...row,
        displayName: s?.display_name ?? null,
        logoUrl: s?.logo_updated_at ? logoUrl(row.name, s.logo_updated_at) : null,
      }));

    return { rows: listed, total: listed.length };
  }

  /**
   * The providers the lobby has games for, read from the live catalogue — `{ name }` per
   * provider, by name. Not `gis_providers`: that table is a fixed list of one aggregator's
   * names, so after the owner switched aggregator (`catalogueSwitch.js`) the lobby listed
   * providers with no games and none of the new ones.
   */
  async #catalogueProviders(search) {
    const where = { provider: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } };
    if (search) where[Op.and] = [{ provider: { [Op.iLike]: `%${search}%` } }];
    const rows = await this.models.Gisgamesnew.findAll({
      attributes: [[fn('BTRIM', col('provider')), 'name']],
      where,
      group: [fn('BTRIM', col('provider'))],
      order: [[fn('BTRIM', col('provider')), 'ASC']],
      raw: true,
    });
    return rows;
  }

  /** Every settings row WITHOUT the logo bytes, keyed by provider. */
  async #providerSettings() {
    const rows = await this.models.CasinoProviderSetting.findAll({
      attributes: { exclude: ['logo_data'] },
      raw: true,
    });
    return new Map(rows.map((r) => [providerKey(r.provider), r]));
  }

  // ── The site admin's provider settings (migration 067) ───────────────

  /**
   * Every lobby provider with its switch, logo and game count — including the
   * ones switched off, which is the point of the screen.
   *
   * The set is the live catalogue's providers (what the lobby lists) plus any provider that
   * has a settings row, so a provider the sync drops does not take its switch
   * out of reach.
   */
  async providerSettingsList() {
    const [providers, settings, counts] = await Promise.all([
      this.#catalogueProviders(),
      this.#providerSettings(),
      this.models.Gisgamesnew.findAll({
        attributes: [[fn('LOWER', fn('BTRIM', col('provider'))), 'provider'], [fn('COUNT', col('id')), 'games']],
        where: { provider: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        group: [fn('LOWER', fn('BTRIM', col('provider')))],
        raw: true,
      }),
    ]);

    const games = new Map(counts.map((c) => [c.provider, Number(c.games)]));
    const names = new Map();
    for (const p of providers) names.set(providerKey(p.name), String(p.name).trim());
    for (const key of settings.keys()) if (!names.has(key)) names.set(key, key);

    return [...names.entries()]
      .map(([key, name]) => this.#settingRow(name, settings.get(key), games.get(key) ?? 0))
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  }

  /** Switch a provider on or off, rename it for display, or move it. */
  async updateProviderSetting({ name, enabled, displayName, sortOrder, actor }) {
    const key = await this.#knownProvider(name);
    const patch = { updated_by: actorTag(actor) };
    if (enabled !== undefined) patch.enabled = enabled;
    // An empty string clears it back to the catalogue's own name / no order.
    if (displayName !== undefined) patch.display_name = displayName?.trim() || null;
    if (sortOrder !== undefined) patch.sort_order = sortOrder;

    await this.#upsertSetting(key, patch);

    this.logger?.warn({ provider: key, ...patch, staffId: actor?.id }, 'Lobby provider settings changed');
    return this.#settingFor(key);
  }

  /**
   * Upload or replace a provider's logo.
   *
   * The bytes are sniffed before anything is written (`imageUpload.inspect`):
   * PNG, JPEG or WebP. SVG is refused for the reason banners refuse it — it is
   * a document that can carry script, served from the platform's origin.
   */
  async putProviderLogo({ name, file, actor }) {
    const key = await this.#knownProvider(name);
    const image = imageUpload.inspect(file, E, { maxBytes: LOGO_MAX_BYTES });

    await this.#upsertSetting(key, {
      logo_data: image.data,
      logo_content_type: image.contentType,
      logo_byte_size: image.byteSize,
      logo_updated_at: new Date(),
      updated_by: actorTag(actor),
    });

    this.logger?.info(
      { provider: key, bytes: image.byteSize, contentType: image.contentType, staffId: actor?.id },
      'Provider logo replaced'
    );
    return this.#settingFor(key);
  }

  /**
   * The same as an upload, from an image URL. Only https to a public host (every address the
   * name resolves to is checked, so a link cannot reach the platform's own network), 10 s, 1 MB;
   * then the bytes go through the upload's own checks (PNG, JPEG or WebP).
   */
  async putProviderLogoFromUrl({ name, url, actor }) {
    await this.#knownProvider(name);
    const buffer = await fetchPublicImage(url, LOGO_MAX_BYTES).catch(() => null);
    if (!buffer) throw E.LOGO_URL_FAILED();
    return this.putProviderLogo({ name, file: { buffer, size: buffer.length }, actor });
  }

  /** Take the logo away; the site falls back to the provider's name. */
  async removeProviderLogo({ name, actor }) {
    const key = await this.#knownProvider(name);
    await this.#upsertSetting(key, {
      logo_data: null,
      logo_content_type: null,
      logo_byte_size: null,
      logo_updated_at: null,
      updated_by: actorTag(actor),
    });

    this.logger?.info({ provider: key, staffId: actor?.id }, 'Provider logo removed');
    return this.#settingFor(key);
  }

  /** A game's self-hosted tile art (`game_artwork`, migration 098), for an `<img src>`. */
  async artwork({ name }) {
    const [row] = await this.models.Gisgamesnew.sequelize.query(
      'SELECT data, content_type, byte_size, updated_at FROM game_artwork WHERE name = $1 AND data IS NOT NULL',
      { bind: [name], type: QueryTypes.SELECT }
    );
    if (!row) throw E.ARTWORK_NOT_FOUND({ name });
    return { data: Buffer.from(row.data), contentType: row.content_type, byteSize: row.byte_size, updatedAt: row.updated_at };
  }

  /**
   * The logo bytes, for an `<img src>`.
   *
   * The public route passes `includeDisabled: false`, so a provider taken out
   * of the lobby is not still fetchable by anyone who knows its name — the
   * same rule inactive banners follow. The admin preview passes true.
   */
  async providerLogo({ name, includeDisabled = false }) {
    const row = await this.models.CasinoProviderSetting.findOne({ where: { provider: providerKey(name) }, raw: true });
    if (!row?.logo_data || (!includeDisabled && row.enabled === false)) throw E.LOGO_NOT_FOUND({ provider: name });
    return {
      data: Buffer.from(row.logo_data),
      contentType: row.logo_content_type,
      byteSize: row.logo_byte_size ?? row.logo_data.length,
      updatedAt: row.logo_updated_at,
    };
  }

  /**
   * The settings key for a provider the catalogue knows, or 404.
   *
   * Without this check a write would create a row for any string in the URL —
   * free storage for an image under a name nothing ever lists.
   */
  async #knownProvider(name) {
    const key = providerKey(name);
    if (!key) throw E.PROVIDER_NOT_FOUND({ provider: name });

    const match = (column) => whereExpr(fn('LOWER', fn('BTRIM', col(column))), key);
    const [listed, upstream, hasGames, hasRow] = await Promise.all([
      this.models.GisProviders.count({ where: match('name') }),
      // The upstream list's names too: its screen writes this same switch.
      this.models.GisProvidersNew.count({ where: match('name') }),
      this.models.Gisgamesnew.count({ where: match('provider') }),
      this.models.CasinoProviderSetting.count({ where: { provider: key } }),
    ]);
    if (!listed && !upstream && !hasGames && !hasRow) throw E.PROVIDER_NOT_FOUND({ provider: name });
    return key;
  }

  /** Insert-or-update by key, so two first writes for one provider cannot race into a duplicate. */
  async #upsertSetting(key, patch) {
    await this.models.CasinoProviderSetting.upsert({ provider: key, ...patch, updated_at: new Date() });
  }

  async #settingFor(key) {
    const list = await this.providerSettingsList();
    return list.find((p) => p.key === key) ?? null;
  }

  #settingRow(name, s, games) {
    const hasLogo = Boolean(s?.logo_updated_at);
    return {
      key: providerKey(name),
      name,
      displayName: s?.display_name ?? null,
      enabled: s?.enabled !== false,
      sortOrder: s?.sort_order ?? null,
      games,
      hasLogo,
      logoUrl: hasLogo ? logoUrl(name, s.logo_updated_at) : null,
      logoContentType: hasLogo ? s.logo_content_type : null,
      logoByteSize: hasLogo ? s.logo_byte_size : null,
      logoUpdatedAt: hasLogo ? s.logo_updated_at : null,
      updatedBy: s?.updated_by ?? null,
      updatedAt: s?.updated_at ?? null,
    };
  }

  /**
   * @legacy GET /api/gis/admin/providers
   *
   * The upstream providers, each with the ONE switch the lobby honours —
   * `casino_provider_settings`, the Casino → Providers screen's. This read
   * `gis_providers_new.enabled`, which nothing else read: the two screens
   * could disagree, and only the newer one did anything.
   */
  async upstreamProviders() {
    const [rows, settings] = await Promise.all([
      this.models.GisProvidersNew.findAll({ attributes: ['name'], order: [['name', 'ASC']], raw: true }),
      this.#providerSettings(),
    ]);
    return rows.map((r) => ({ name: r.name, enabled: settings.get(providerKey(r.name))?.enabled !== false }));
  }

  /**
   * @legacy PUT /api/gis/admin/providers
   *
   * Enable or disable upstream providers. The second factor is verified by
   * admin-service, which owns staff credentials — casino-service must not read
   * a password hash it does not own.
   *
   * Writes the lobby's switch (`casino_provider_settings.enabled`), so this
   * screen and Casino → Providers are one switch. `gis_providers_new.enabled`
   * is kept in step for anything that still reads the legacy column.
   */
  async setUpstreamProviders({ updates, transactionPassword, actor }) {
    await this.clients.admin.post('/internal/admin/staff-directory/verify-transaction-password', {
      staffId: actor.id,
      transactionPassword,
      ...(actor.executiveId ? { executiveId: actor.executiveId } : {}),
    });

    // Every name checked before anything is written: one typo refuses the batch.
    const keys = [];
    for (const update of updates) keys.push(await this.#knownProvider(update.name));

    await this.db.transaction(async (transaction) => {
      for (const [index, update] of updates.entries()) {
        await this.models.CasinoProviderSetting.upsert(
          { provider: keys[index], enabled: update.enabled, updated_by: actorTag(actor), updated_at: new Date() },
          { transaction }
        );
        await this.models.GisProvidersNew.update(
          { enabled: update.enabled },
          { where: { name: update.name }, transaction }
        );
      }
    });

    this.logger?.warn(
      { staffId: actor.id, updates: updates.map((u) => `${u.name}=${u.enabled}`) },
      'Upstream game providers toggled'
    );

    return this.upstreamProviders();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Editing
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy PUT /api/gis/admin/gis/games/:uuid/image — unauthenticated.
   *
   * The URL is rendered in every player's lobby, so an unchecked value here is
   * stored content injection. It must be an absolute http(s) URL; legacy
   * accepted any non-empty string, including `javascript:` and `data:`.
   */
  async updateImage({ uuid, image, actor }) {
    const url = String(image).trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw E.IMAGE_URL_INVALID({ image: url.slice(0, 120) });

    const [changed] = await this.models.Gisgamesnew.update({ image: url }, { where: { uuid } });
    if (!changed) throw E.NOT_FOUND({ uuid });

    this.logger?.info({ uuid, staffId: actor?.id }, 'Game image replaced');

    return this.models.Gisgamesnew.findOne({
      where: { uuid },
      attributes: ['uuid', 'name', 'image'],
      raw: true,
    });
  }

  /**
   * Resolve opaque game references against BOTH catalogues.
   *
   * Extracted from `favourites`, which was the first caller; `recentlyPlayed`
   * is the second, and that is the rule this codebase already follows. Neither
   * list has a foreign key — a reference is whatever string named the game
   * when it was stored — so a row that matches neither catalogue resolves to
   * `null` and its caller keeps the row anyway. Legacy's LEFT JOIN did the
   * same, and it is what stops a provider retiring a game from silently
   * emptying somebody's list.
   *
   * Two catalogues, two keys, one query each. Both are indexed on the column
   * being matched, and neither list is long enough to want a union.
   */
  async #resolveGames(refs) {
    const byRef = new Map();
    if (!refs.length) return byRef;

    const [aggregator, inHouse] = await Promise.all([
      this.models.Gisgamesnew.findAll({
        where: { uuid: { [Op.in]: refs } },
        attributes: [...GAME_FIELDS],
        raw: true,
      }),
      this.models.JsGames.findAll({
        where: { game_uid: { [Op.in]: refs } },
        raw: true,
      }),
    ]);

    // In-house first, aggregator second: if one reference somehow named a game
    // in both, the aggregator row is the richer one and wins.
    for (const g of inHouse) {
      byRef.set(g.game_uid, {
        uuid: g.game_uid,
        name: g.game_name,
        provider: g.vendor,
        type: g.game_type,
        image: g.game_icon,
      });
    }
    for (const g of await this.#withSlugs(aggregator)) byRef.set(g.uuid, g);

    return byRef;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Recently played
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/gis/games/recently-played?user_id=
   *
   * The id came from the query string on an unauthenticated route, so any
   * player's history was one request away. It comes from the token now.
   */
  async recentlyPlayed({ userId, limit }) {
    const recent = await this.models.GisRecentlyPlayed.findAll({
      where: { user_id: userId },
      order: [['played_at', 'DESC']],
      limit: Math.min(limit, RECENTLY_PLAYED_LIMIT),
      raw: true,
    });

    if (!recent.length) return [];

    /**
     * BOTH CATALOGUES, not just the aggregator's.
     *
     * This read matched `Gisgamesnew` alone, which was right while only the
     * GIS launch path wrote the table. The in-house launch writes it now, and
     * an in-house `game_uid` is not a GIS `uuid` — so every house game would
     * have come back as a row with `game: null`, present in the list and
     * unnamed. Same resolver the favourites list uses, for the same reason.
     *
     * A game removed from the catalogue since it was played still belongs in
     * the list — legacy's LEFT JOIN kept it too, with every column null.
     */
    const [byRef, disabled] = await Promise.all([
      this.#resolveGames(recent.map((r) => r.game_uuid)),
      disabledProviders(this.models),
    ]);

    // A game whose provider the site admin switched off leaves the list, as it
    // left the lobby; switched back on, it returns (migration 067).
    return withoutDisabledGames(
      recent.map((r) => ({
        game_uuid: r.game_uuid,
        played_at: r.played_at,
        game: byRef.get(r.game_uuid) ?? null,
      })),
      disabled
    );
  }

  /**
   * Record a play and trim the list to its cap.
   *
   * Called by the launch path, not by a route. The trim is a single delete of
   * everything older than the cap, which is what the legacy `DELETE ... WHERE
   * id NOT IN (SELECT ... LIMIT 15)` expressed.
   */
  async recordPlay({ userId, gameUuid }) {
    await this.models.GisRecentlyPlayed.upsert({
      user_id: userId,
      game_uuid: gameUuid,
      played_at: new Date(),
    });

    const keep = await this.models.GisRecentlyPlayed.findAll({
      where: { user_id: userId },
      attributes: ['id'],
      order: [['played_at', 'DESC']],
      limit: RECENTLY_PLAYED_LIMIT,
      raw: true,
    });

    if (keep.length < RECENTLY_PLAYED_LIMIT) return;

    await this.models.GisRecentlyPlayed.destroy({
      where: { user_id: userId, id: { [Op.notIn]: keep.map((r) => r.id) } },
    });
  }

  /**
   * The three writes an in-house bet must perform beyond moving the money.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THE AGGREGATOR PATH DID ALL OF THIS AND THE HOUSE GAMES DID NONE OF IT
   *
   * `gis.service.js` calls `recordPlay` on launch and the aggregator keeps the
   * wager counters moving. The in-house engine wrote its `bets` row and
   * stopped, so three separate features read zero for a player who only ever
   * played house games:
   *
   *   `gis_recently_played` — `/recent` and the home and casino pages'
   *     Continue Playing tab were empty for everybody (gap 2).
   *   `userwager`           — `GET /user/wager/progress` reported
   *     `wagered: 0`, so a wagering requirement could never be met by playing
   *     the platform's own games (gap 19).
   *   `users.games_played`  — `profile.gamesPlayed` stayed 0, and Statistics
   *     printed bets and wins but no amount wagered.
   *
   * ── IT LIVES HERE, NOT IN THE CALLERS ─────────────────────────────────
   *
   * Two paths settle a house bet — `in-house/engine/gameEngine.js`, which is
   * the socket games the platform actually runs, and `js-games`, which is the
   * huidu provider (unconfigured, so it cannot be exercised today). Both need
   * the identical three writes, and `recordPlay` with its trim already lives
   * on this service. A second copy is how two lists drift apart.
   *
   * ── WHY IT IS BEST-EFFORT ─────────────────────────────────────────────
   *
   * The money movement is the contract: it is transactional, and for js-games
   * idempotent on `serial_number` with a provider timeout on the other end.
   * These three are bookkeeping ABOUT that movement. A failed counter must
   * never turn a settled bet into an error the caller retries — that would
   * double a payout to fix a statistic. So each is caught and logged.
   *
   * `increment` rather than read-modify-write: two settlements for one player
   * can land together, and `SET wager = wager + x` in the database is the only
   * version of this that is correct under that.
   */
  /**
   * ── THE COUNTER ITSELF NOW LIVES ON USER-SERVICE, IN USD ──────────────
   *
   * This used to add the raw stake — in the bet's own currency — to
   * `userwager.wager`, then post the before/after to VIP and affiliate. The
   * VIP bands, bonus gates and affiliate commission are USD-sized and pay
   * USDT, so on an INR site rupees were counted as dollars (₹1,500 of play
   * paid 6.5 USDT of level-ups). `POST /internal/user/wager/record` converts
   * the stake to USD first, counts it exactly once per `(source, ref)`, and
   * runs the VIP, affiliate and rakeback side effects itself.
   *
   * `currency` and `ref` are therefore required for a stake to count: a
   * caller that cannot name the bet cannot be made idempotent, and a stake
   * with no currency cannot be converted. `rakeback: false` skips the accrual
   * for a path that has none.
   */
  async recordActivity({
    userId,
    gameRef,
    wagered,
    currency,
    source = 'casino',
    ref,
    rakeback = true,
    countPlay = true,
    category,
    provider,
    odds,
    houseEdge,
    // The catalogue row to describe the bet by, when it is not `gameRef` (which also
    // writes recently-played — once per launch, not once per spin).
    catalogueRef,
  }) {
    try {
      if (gameRef) await this.recordPlay({ userId, gameUuid: gameRef });
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId), gameRef }, 'recordPlay failed');
    }

    const amount = wagered == null ? null : String(wagered);
    if (!amount || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return { counted: false };

    if (!currency || ref == null || ref === '') {
      this.logger?.warn({ userId: String(userId), source }, 'stake not counted: currency and ref are required');
      return { counted: false };
    }

    let outcome = { counted: false };
    try {
      if (this.clients?.user) {
        outcome =
          (await this.clients.user.post('/internal/user/wager/record', {
            userId,
            amount,
            currency: String(currency).toUpperCase(),
            source,
            ref: String(ref),
            rakeback: Boolean(rakeback),
            // What kind of bet — the hash.game formulas price by it (migration 132).
            ...(await this.#stakeKind({ gameRef: catalogueRef ?? gameRef, source, category, provider, odds, houseEdge })),
          })) ?? outcome;
      }
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId), source, ref }, 'wager record failed');
    }

    // A round, once — a retried settlement for the same bet is not another game.
    // `countPlay: false` is the in-house engine, which counts a round when it
    // SETTLES instead, so a refunded or invalid round is not a game played.
    if (countPlay && !outcome?.duplicate) {
      try {
        await this.models.Users.increment({ games_played: 1 }, { where: { id: userId } });
      } catch (error) {
        this.logger?.warn({ err: error, userId: String(userId) }, 'games_played update failed');
      }
    }

    return outcome;
  }

  /**
   * `category` / `provider` / `gameRef` / `odds` / `houseEdge` for `/wager/record`, only the keys
   * that are known. A caller that names the category keeps it; otherwise the catalogue row of
   * `gameRef` (`gisgamesnew` uuid, then `js_games` uid) gives type + provider. Never throws: a
   * failed lookup records the stake without them (user-service then uses the source's default).
   */
  async #stakeKind({ gameRef, source, category, provider, odds, houseEdge }) {
    let type = null;
    let vendor = provider ?? null;
    if (gameRef && (!category || !vendor)) {
      try {
        const gis = await this.models.Gisgamesnew?.findOne({ where: { uuid: String(gameRef) }, attributes: ['type', 'provider'], raw: true });
        const js = gis ? null : await this.models.JsGames?.findOne({ where: { game_uid: String(gameRef) }, attributes: ['game_type', 'vendor'], raw: true });
        type = gis?.type ?? js?.game_type ?? null;
        vendor = vendor ?? gis?.provider ?? js?.vendor ?? null;
      } catch (error) {
        this.logger?.warn({ err: error, gameRef }, 'stake kind lookup failed');
      }
    }
    const kind = { category: wagerCategory.resolveCategory({ category, source, type, provider: vendor }) };
    if (vendor) kind.provider = String(vendor).slice(0, 120);
    if (gameRef) kind.gameRef = String(gameRef).slice(0, 190);
    if (odds != null && /^\d+(\.\d+)?$/.test(String(odds))) kind.odds = Number(odds).toFixed(4).replace(/\.?0+$/, '');
    if (houseEdge != null) kind.houseEdge = String(houseEdge);
    return kind;
  }

  /**
   * A stake that was refunded or rolled back stops counting.
   *
   * Posts `(source, ref)` — the SAME key `recordActivity` counted the stake
   * under — to `/internal/user/wager/reverse`, which takes its USD back out of
   * `userwager` and its unclaimed rakeback back out of the accrual. Called
   * after the refund's money has committed; best-effort like the count: a
   * failure is logged and never fails the refund.
   *
   * `amount` (the refunded part, in the stake's currency) + `refundRef` (the provider's
   * refund id) make it a partial reversal, pro-rated in user-service (migration 090); both
   * are sent only when given, so a full reversal's body is unchanged. `outbox: true` queues a
   * failed call in `wager_reverse_outbox` for the user-service worker to retry (the reverse
   * is idempotent) instead of only logging it.
   */
  async reverseActivity({ userId, source, ref, amount = null, refundRef = null, outbox = false }) {
    if (userId == null || !source || ref == null || ref === '') return { reversed: false };
    const body = { userId: Number(userId), source, ref: String(ref) };
    if (amount != null && amount !== '') body.amount = money.toDecimalString(money.toMinorQuantised(String(amount)));
    if (refundRef != null && refundRef !== '') body.refundRef = String(refundRef);
    try {
      if (!this.clients?.user) return { reversed: false };
      return (await this.clients.user.post('/internal/user/wager/reverse', body)) ?? { reversed: false };
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId), source, ref }, 'wager reversal failed');
      if (outbox) await this.#queueReverse(body, error);
      return outbox ? { reversed: false, queued: true } : { reversed: false };
    }
  }

  /** A failed reverse call → `wager_reverse_outbox`, retried by the user-service worker. */
  async #queueReverse({ userId, source, ref, amount = null, refundRef = '' }, cause) {
    try {
      await this.db.sequelize.query(
        `INSERT INTO wager_reverse_outbox (origin, user_id, source, ref, amount, refund_ref, last_error)
         VALUES ('casino', :userId, :source, :ref, :amount, :refundRef, :error)
         ON CONFLICT (source, ref, refund_ref) DO NOTHING`,
        {
          replacements: {
            userId: String(userId), source, ref, amount, refundRef,
            error: String(cause?.message ?? cause).slice(0, 500),
          },
        }
      );
    } catch (error) {
      this.logger?.error(
        { err: error, userId: String(userId), source, ref },
        'wager reversal could not be queued — stake still counted. NEEDS MANUAL REVERSAL'
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Favourites
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The games this player has starred, newest first.
   *
   * ── THE REFERENCE IS RESOLVED, NOT JOINED ────────────────────────────
   *
   * A favourite is stored as whatever string the client used to name the game
   * (migration 038 argues why), and there are three such strings in play: the
   * aggregator's `gisgamesnew.uuid`, the in-house `js_games.game_uid`, and the
   * client's own slug. So both catalogues are asked, in that order, and a
   * reference that matches neither comes back as `game: null`.
   *
   * `game: null` is a real answer here, not a failure. `recentlyPlayed` one
   * method up does the same for a game that has left the catalogue, and legacy's
   * LEFT JOIN did before either of them. On this delivery it is also the COMMON
   * case: the aggregator catalogue is unsynced and only the twenty in-house
   * games exist, so a player starring anything else gets their reference back
   * and the client draws the tile from its own artwork. Refusing to store those
   * would leave the page as empty as it was before this feature existed.
   */
  async favourites({ userId, limit }) {
    const rows = await this.models.UserFavouriteGames.findAll({
      where: { user_id: userId },
      order: [['created_at', 'DESC']],
      limit: Math.min(limit, FAVOURITES_LIMIT),
      raw: true,
    });

    if (!rows.length) return [];

    const [byRef, disabled] = await Promise.all([
      this.#resolveGames(rows.map((r) => r.game_ref)),
      disabledProviders(this.models),
    ]);

    // Hidden, not deleted: the star is still stored, and the game is back in the
    // list the moment its provider is switched back on (migration 067).
    return withoutDisabledGames(
      rows.map((r) => ({
        game_ref: r.game_ref,
        source: r.source,
        created_at: r.created_at,
        game: byRef.get(r.game_ref) ?? null,
      })),
      disabled
    );
  }

  /**
   * Star a game.
   *
   * Idempotent by the unique index on `(user_id, game_ref)`: pressing the star
   * twice is the same fact stated twice, not a duplicate row and not a 409 the
   * client has to special-case. The `created_at` is left alone on a repeat, so
   * re-starring does not reorder somebody's list.
   *
   * The cap is checked BEFORE the upsert and only when the row would be new —
   * otherwise a player at the limit could not re-press a star they already have.
   */
  async addFavourite({ userId, gameRef, source }) {
    const existing = await this.models.UserFavouriteGames.findOne({
      where: { user_id: userId, game_ref: gameRef },
      raw: true,
    });
    if (existing) return { game_ref: gameRef, favourite: true };

    const held = await this.models.UserFavouriteGames.count({ where: { user_id: userId } });
    if (held >= FAVOURITES_LIMIT) throw E.TOO_MANY_FAVOURITES({ limit: FAVOURITES_LIMIT });

    await this.models.UserFavouriteGames.create({
      user_id: userId,
      game_ref: gameRef,
      source: source || 'unknown',
      created_at: new Date(),
    });

    return { game_ref: gameRef, favourite: true };
  }

  /**
   * Un-star a game.
   *
   * Removing one that is not there answers the same success. The caller asked
   * for a state, not for an event, and 404 here would make the client handle a
   * race it cannot avoid — two tabs, one star.
   */
  async removeFavourite({ userId, gameRef }) {
    await this.models.UserFavouriteGames.destroy({
      where: { user_id: userId, game_ref: gameRef },
    });
    return { game_ref: gameRef, favourite: false };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Shared
  // ══════════════════════════════════════════════════════════════════════

  /** A stored CSV of uuids → an ordered, de-duplicated array. */
  #splitIds(csv) {
    if (!csv || !String(csv).trim()) return [];

    const seen = new Set();
    const out = [];
    for (const part of String(csv).split(',')) {
      const value = part.trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
    return out;
  }

  /**
   * De-duplicate, then confirm every uuid is a real game.
   *
   * Legacy stored whatever it was handed. A typo'd uuid was accepted, saved,
   * and then silently dropped by the JOIN that read it back — the list looked
   * saved and came back one game short with nothing to explain it.
   */
  async #verifiedIds(uuids) {
    const seen = new Set();
    const clean = [];
    for (const value of uuids ?? []) {
      const uuid = String(value ?? '').trim();
      if (uuid && !seen.has(uuid)) {
        seen.add(uuid);
        clean.push(uuid);
      }
    }

    if (clean.length > MAX_COLLECTION_SIZE) throw E.COLLECTION_TOO_LARGE({ count: clean.length });
    if (!clean.length) return clean;

    const found = await this.models.Gisgamesnew.findAll({
      where: { uuid: { [Op.in]: clean } },
      attributes: ['uuid'],
      raw: true,
    });

    if (found.length !== clean.length) {
      const known = new Set(found.map((g) => g.uuid));
      throw E.UNKNOWN_GAMES({ unknown: clean.filter((u) => !known.has(u)).slice(0, 20) });
    }

    return clean;
  }
}

/** One part of a page slug — the JavaScript twin of `SLUG_PART_SQL`. */
const slugPart = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A row's page slug; `suffixed` when an earlier uuid holds the plain one (see `bySlug`). */
function gameSlug(row, suffixed) {
  const plain = `${slugPart(row.name)}-by-${slugPart(row.provider)}`;
  return suffixed ? `${plain}-${String(row.uuid).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}` : plain;
}

/** Ordered providers first (by `sort_order`), then the rest. */
function order(s) {
  const n = s?.sort_order ?? s?.sortOrder;
  return n === null || n === undefined ? Number.MAX_SAFE_INTEGER : Number(n);
}

/**
 * The public logo URL, versioned by when it was uploaded: the route caches it
 * for a year, and a replaced logo is a new URL rather than a stale cache.
 */
function logoUrl(name, updatedAt) {
  const v = new Date(updatedAt).getTime();
  return `/api/v1/casino/games/providers/${encodeURIComponent(String(name).trim())}/logo?v=${v}`;
}

/** What `updated_by` records: the staff id, as the other curation tables do. */
const actorTag = (actor) => (actor?.id === undefined || actor?.id === null ? null : String(actor.id));

module.exports = { GamesService, LOGO_MAX_BYTES, MOBILE_SUFFIX };
