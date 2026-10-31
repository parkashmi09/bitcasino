'use strict';

const { Op, fn, col } = require('sequelize');

const { entitlements } = require('@ibitplay/common');

const E = require('./jsCuration.errors');
const { isRowEntitledIn } = require('../games/gameEntitlement');
const {
  COLLECTIONS,
  COLLECTION_SLUGS,
  SCOPES,
  SCOPE_VALUES,
  GAME_FIELDS,
  MAX_LIST_SIZE,
} = require('./jsCuration.constants');

/**
 * Curation over `js_games` — the catalogue the lobby actually renders.
 *
 * Separate from `JsGamesService` on purpose: that class is the money path (two
 * provider protocols, wallet callbacks, launch sessions) and this one moves no
 * balance at all. What it moves is attention, which is worth guarding for its
 * own reasons but not worth entangling with a bet callback.
 *
 * See migration 040 for why the aggregator's seven curation tables are one
 * table here, and why the stored identifier is `game_uid`.
 */
class JsCurationService {
  constructor({ models, db, logger }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  What there is to curate
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Every vendor in the catalogue, with its game count and whether it has been
   * curated.
   *
   * Counted over active games only. A vendor whose games are all switched off
   * is still listed — with a count of zero — because that is a state an
   * operator needs to see rather than a vendor that has vanished from the
   * screen.
   */
  async vendorList() {
    return this.#facetList('vendor', SCOPES.VENDOR);
  }

  /** Every `game_type` in the catalogue. Same shape as `vendorList`. */
  async typeList() {
    return this.#facetList('game_type', SCOPES.TYPE);
  }

  /**
   * The named collections, each with the size of its curated list.
   *
   * Driven by the constant rather than by what is in the table, so a
   * collection nobody has curated yet still appears — with `games: 0` — and
   * can be opened and filled. Listing only the rows that exist would mean a
   * new collection was invisible until somebody had already curated it.
   */
  async collectionList() {
    const rows = await this.models.JsGameCuration.findAll({
      where: { scope: SCOPES.COLLECTION },
      raw: true,
    });
    const byKey = new Map(rows.map((row) => [row.key, row]));

    return COLLECTION_SLUGS.map((slug) => {
      const row = byKey.get(slug);
      return {
        key: slug,
        label: COLLECTIONS[slug].label,
        games: this.#split(row?.game_uids).length,
        curated: Boolean(row),
        updatedAt: row?.updated_at ?? null,
        updatedBy: row?.updated_by ?? null,
      };
    });
  }

  /**
   * One facet of the catalogue — the distinct values of a column, their game
   * counts, and which of them carry a curated list.
   */
  async #facetList(column, scope) {
    const [facets, curated] = await Promise.all([
      this.models.JsGames.findAll({
        attributes: [[col(column), 'name'], [fn('COUNT', col('id')), 'games']],
        where: { [column]: { [Op.ne]: null }, is_active: true },
        group: [col(column)],
        order: [[col(column), 'ASC']],
        raw: true,
      }),
      this.models.JsGameCuration.findAll({ where: { scope }, raw: true }),
    ]);

    const byKey = new Map(curated.map((row) => [row.key, row]));

    return facets
      .filter((facet) => String(facet.name ?? '').trim() !== '')
      .map((facet) => {
        const row = byKey.get(facet.name);
        return {
          name: facet.name,
          games: Number(facet.games) || 0,
          curated: Boolean(row),
          prioritized: this.#split(row?.game_uids).length,
          updatedAt: row?.updated_at ?? null,
          updatedBy: row?.updated_by ?? null,
        };
      });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reading and writing one curated list
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The curated list for one `(scope, key)`, in the operator's order.
   *
   * ── THE ORDER IS THE ROW, SO IT IS REBUILT AND NOT QUERIED ──────────────
   *
   * A `WHERE game_uid IN (...)` comes back in whatever order the planner
   * chooses, which is not the curated one. The rows are fetched in one query
   * and then re-sorted against the CSV, which is also what drops a uid whose
   * game has since left the catalogue: it simply finds no row.
   */
  async read({ scope, key }) {
    this.#assertScope(scope);
    if (scope === SCOPES.COLLECTION) this.#assertCollection(key);

    const row = await this.models.JsGameCuration.findOne({ where: { scope, key }, raw: true });
    const uids = this.#split(row?.game_uids);

    return {
      scope,
      key,
      curated: Boolean(row),
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
      games: await this.#gamesInOrder(uids),
    };
  }

  /**
   * Replace the curated list.
   *
   * Whole-list replacement rather than add/remove operations: the order is the
   * data, and two operators reordering the same list concurrently should have
   * one of them win cleanly rather than interleave into an order neither of
   * them chose.
   */
  async write({ scope, key, gameUids, actor }) {
    this.#assertScope(scope);
    if (scope === SCOPES.COLLECTION) this.#assertCollection(key);

    // De-duplicated, order preserved: a uid listed twice would render the same
    // tile twice, and `Set` keeps the FIRST occurrence, which is the position
    // the operator dragged it to.
    const uids = [...new Set(gameUids.map((uid) => String(uid).trim()).filter(Boolean))];
    if (uids.length > MAX_LIST_SIZE) throw E.LIST_TOO_LARGE({ max: MAX_LIST_SIZE, given: uids.length });

    if (uids.length) {
      const known = await this.models.JsGames.findAll({
        attributes: ['game_uid'],
        where: { game_uid: { [Op.in]: uids } },
        raw: true,
      });
      const found = new Set(known.map((row) => row.game_uid));
      const missing = uids.filter((uid) => !found.has(uid));
      if (missing.length) throw E.UNKNOWN_GAMES({ missing: missing.slice(0, 20), count: missing.length });
    }

    const [row] = await this.models.JsGameCuration.upsert(
      {
        scope,
        key,
        game_uids: uids.join(','),
        updated_by: actor?.username ?? actor?.name ?? (actor?.id ? `staff:${actor.id}` : null),
      },
      { returning: true }
    );

    this.logger?.info({ scope, key, games: uids.length, actor: actor?.id }, 'js-games curation updated');

    return {
      scope,
      key,
      curated: true,
      updatedAt: row?.updated_at ?? new Date(),
      updatedBy: row?.updated_by ?? null,
      games: await this.#gamesInOrder(uids),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The lobby's own read
  // ══════════════════════════════════════════════════════════════════════

  /**
   * A named collection, paged, for the site.
   *
   * Public, and deliberately NOT an error when nothing has been curated: a
   * collection an operator has not filled in is an empty row on the page, not a
   * broken one. The site decides what to do with an empty list — the home page
   * falls back to its built-in set.
   *
   * Inactive games are filtered here rather than at write time. An operator
   * switching a game off should take it out of every collection at once, and
   * having to remember which lists mention it is how a dead tile survives on
   * the front page.
   */
  async collection({ collection, page, perPage }) {
    this.#assertCollection(collection);

    const row = await this.models.JsGameCuration.findOne(
      { where: { scope: SCOPES.COLLECTION, key: collection }, raw: true }
    );
    const uids = this.#split(row?.game_uids);
    if (!uids.length) return { rows: [], total: 0 };

    // The owner's plan: a curated tile whose provider or category is switched off leaves the row.
    const plan = await entitlements.getEntitlements();
    const games = (await this.#gamesInOrder(uids)).filter(
      (game) => game.is_active !== false && isRowEntitledIn(plan, game)
    );
    const offset = (page - 1) * perPage;

    return { rows: games.slice(offset, offset + perPage), total: games.length };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The picker
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Catalogue search for the admin pickers.
   *
   * Ranked the way `searchGamesV1` ranks: exact name, then name prefix, then
   * vendor prefix, then the rest. Operators search for a game they already have
   * in mind, and an exact match buried under twenty substring hits reads as the
   * search not working.
   */
  async search({ q, vendor, type, limit, activeOnly = true }) {
    const term = String(q ?? '').trim();

    const rows = await this.models.JsGames.findAll({
      attributes: [...GAME_FIELDS],
      where: {
        ...(activeOnly ? { is_active: true } : {}),
        ...(vendor ? { vendor } : {}),
        ...(type ? { game_type: type } : {}),
        ...(term
          ? {
              [Op.or]: [
                { game_name: { [Op.iLike]: `%${term}%` } },
                { vendor: { [Op.iLike]: `%${term}%` } },
                { game_type: { [Op.iLike]: `%${term}%` } },
              ],
            }
          : {}),
      },
      order: [['game_name', 'ASC']],
      limit,
      raw: true,
    });

    if (!term) return rows;

    const lower = term.toLowerCase();
    const rank = (row) => {
      const name = String(row.game_name ?? '').toLowerCase();
      if (name === lower) return 0;
      if (name.startsWith(lower)) return 1;
      if (String(row.vendor ?? '').toLowerCase().startsWith(lower)) return 2;
      return 3;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.game_name.localeCompare(b.game_name));
  }

  /**
   * Point a tile at a different image.
   *
   * The aggregator side has the same operation and it is worth having here:
   * `game_icon` comes from the provider and a broken CDN URL is the most
   * visible defect the lobby can have, with no other way to correct it.
   */
  async updateIcon({ gameUid, icon, actor }) {
    const [changed] = await this.models.JsGames.update(
      { game_icon: icon },
      { where: { game_uid: gameUid } }
    );
    if (!changed) throw E.UNKNOWN_GAMES({ missing: [gameUid], count: 1 });

    this.logger?.info({ gameUid, actor: actor?.id }, 'js-games tile image updated');

    return this.models.JsGames.findOne({ attributes: [...GAME_FIELDS], where: { game_uid: gameUid }, raw: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Internals
  // ══════════════════════════════════════════════════════════════════════

  async #gamesInOrder(uids) {
    if (!uids.length) return [];

    const rows = await this.models.JsGames.findAll({
      attributes: [...GAME_FIELDS],
      where: { game_uid: { [Op.in]: uids } },
      raw: true,
    });

    const byUid = new Map(rows.map((row) => [row.game_uid, row]));
    return uids.map((uid) => byUid.get(uid)).filter(Boolean);
  }

  #split(csv) {
    return String(csv ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  #assertScope(scope) {
    if (!SCOPE_VALUES.includes(scope)) throw E.SCOPE_NOT_FOUND({ scope, known: SCOPE_VALUES });
  }

  #assertCollection(collection) {
    if (!COLLECTION_SLUGS.includes(collection)) {
      throw E.COLLECTION_NOT_FOUND({ collection, known: COLLECTION_SLUGS });
    }
  }
}

module.exports = { JsCurationService };
