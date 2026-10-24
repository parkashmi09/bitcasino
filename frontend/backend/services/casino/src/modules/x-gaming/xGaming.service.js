'use strict';

const { Op, fn, col } = require('sequelize');

/**
 * The `apigames` catalogue — the xGaming vendor listing.
 *
 * Reads only. No money, no upstream calls: this is a local table the sync fills.
 *
 * ── WHAT CHANGED ─────────────────────────────────────────────────────────
 *
 * THE COUNT WAS CACHED AND THE PAGE WAS NOT. `getGamesByVendorPaginated` cached
 * the total for ten minutes but queried the rows live, so for ten minutes after
 * any catalogue change the paginator advertised a page count that did not match
 * what the pages returned — an empty last page, or games that could not be
 * reached. The two come from one query here.
 *
 * THE SEARCH RANKING WAS SQL AND THE COUNT DID NOT MATCH IT. The search built a
 * relevance CASE with `$paramIndex` offsets, then ran the count with
 * `params.slice(0, paramIndex - 1)` — a different parameter list, and so a
 * different filter, from the query it was counting.
 *
 * `enabled = 1` is preserved: `apigames.enabled` is an integer flag, not a
 * boolean, and rows carry 0 and 1.
 */
class XGamingService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  /** @legacy GET /xGaming/by-vendor */
  async byVendor({ vendor, page, per_page: perPage }) {
    const { rows, count } = await this.models.Apigames.findAndCountAll({
      where: { vendor, enabled: 1 },
      attributes: this.#summary(),
      order: [['id', 'ASC']],
      limit: perPage,
      offset: (page - 1) * perPage,
      raw: true,
    });

    return { rows, total: count };
  }

  /** @legacy GET /xGaming/vendors */
  async vendors({ vendor, pageSize }) {
    const rows = await this.models.Apigames.findAll({
      attributes: ['vendor', [fn('COUNT', col('id')), 'game_count']],
      where: {
        enabled: 1,
        ...(vendor && vendor !== 'all' ? { vendor } : {}),
      },
      group: ['vendor'],
      order: [['vendor', 'ASC']],
      raw: true,
    });

    return rows.map((row) => {
      const gameCount = Number(row.game_count);
      return {
        vendor: row.vendor,
        game_count: gameCount,
        ...(pageSize ? { total_pages: Math.ceil(gameCount / pageSize), page_size: pageSize } : {}),
      };
    });
  }

  /**
   * @legacy GET /xGaming/games/search
   *
   * Title, vendor and type, exact match first, then prefix, then anywhere —
   * the same ranking the SQL expressed, applied to a bounded result set so the
   * count and the rows come from one filter.
   */
  async search({ keyword, page, limit }) {
    const term = String(keyword ?? '').trim();

    const where = term
      ? {
          [Op.or]: [
            { title: { [Op.iLike]: `%${term}%` } },
            { vendor: { [Op.iLike]: `%${term}%` } },
            { type: { [Op.iLike]: `%${term}%` } },
          ],
        }
      : {};

    const { rows, count } = await this.models.Apigames.findAndCountAll({
      where,
      attributes: this.#summary(),
      order: [['title', 'ASC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    if (!term) return { rows, total: count };

    const lower = term.toLowerCase();
    const rank = (row) => {
      const title = String(row.title ?? '').toLowerCase();
      const vendor = String(row.vendor ?? '').toLowerCase();
      if (title === lower) return 0;
      if (title.startsWith(lower)) return 1;
      if (vendor.startsWith(lower)) return 2;
      return 3;
    };

    return { rows: [...rows].sort((a, b) => rank(a) - rank(b)), total: count };
  }

  /**
   * The columns a listing exposes.
   *
   * Explicit, because `apigames` is a wide sync table and legacy answered with
   * `SELECT *` in one place and a hand-written list in another — so the same
   * game came back with different fields depending on which endpoint found it.
   */
  #summary() {
    return [
      'id',
      'title',
      'platform',
      'type',
      'subtype',
      'vendor',
      'created_at',
      'details_description_en',
      'details_thumbnails_300x300',
    ];
  }
}

module.exports = { XGamingService };
