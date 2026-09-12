'use strict';

const { Op } = require('sequelize');

const errors = require('./catalogue.errors');

/**
 * Sport configuration and fancy market visibility.
 *
 * Two small tables, both of them switches an operator flips, and both of them
 * previously reachable by anyone with the URL.
 */
class CatalogueService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Sports
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /sports/sports-config
   * @legacy GET /sports/sports
   *
   * Two endpoints returning the same table in two different envelopes —
   * `sportsconfigcontroller.getSportsConfig` sent a bare array and
   * `sportsconfigggcotl.getAllSports` sent `{success, data}`. One shape here.
   */
  async listSports({ enabledOnly } = {}) {
    const rows = await this.models.SportsConfig.findAll({
      where: enabledOnly ? { enabled: true } : {},
      order: [['game_name', 'ASC']],
      raw: true,
    });
    return rows.map((r) => this.#shapeSport(r));
  }

  /** @legacy GET /sports/sports/:id */
  async getSport({ id }) {
    const row = await this.models.SportsConfig.findByPk(id, { raw: true });
    if (!row) throw errors.SPORT_NOT_FOUND({ id });
    return this.#shapeSport(row);
  }

  /**
   * @legacy POST /sports/sports-config
   *
   * Configure a sport.
   *
   * Legacy inserted without checking, and `sports_config.game_id` has no unique
   * constraint — so the same sport could be configured twice with different
   * `enabled` values, and the filter that decides what players see matched
   * whichever row came back first.
   */
  async addSport({ gameId, gameName, enabled = false }) {
    // `sports_config.game_id` is INTEGER — see the note on `sportGameId` in
    // the validators. Comparing it against a non-numeric string is a type
    // error in Postgres, not a miss, so the schema rejects one first.
    const existing = await this.models.SportsConfig.findOne({
      where: { game_id: gameId },
      raw: true,
    });
    if (existing) throw errors.SPORT_EXISTS({ gameId });

    const row = await this.models.SportsConfig.create({
      game_id: gameId,
      game_name: gameName,
      enabled,
    });
    return this.#shapeSport(row.get({ plain: true }));
  }

  /**
   * @legacy PUT /sports/sports-config/:id
   * @legacy PUT /sports/sports/:id
   *
   * Two endpoints doing the same thing: one took `{game_name, enabled}` and the
   * other took `{enabled}` only. Merged — naming neither is refused rather than
   * producing legacy's `UPDATE sports_config SET  WHERE id = $1`, which is a
   * syntax error surfaced as a 500.
   */
  async updateSport({ id, gameName, enabled, staffId = null }) {
    const row = await this.models.SportsConfig.findByPk(id);
    if (!row) throw errors.SPORT_NOT_FOUND({ id });

    const patch = {};
    if (gameName !== undefined) patch.game_name = gameName;
    if (enabled !== undefined) patch.enabled = enabled;
    if (!Object.keys(patch).length) throw errors.NOTHING_TO_UPDATE();

    const before = { gameName: row.game_name, enabled: row.enabled };
    await row.update(patch);

    this.logger?.info(
      { id, staffId, before, after: patch },
      'Sport configuration changed'
    );

    return this.#shapeSport(row.get({ plain: true }));
  }

  /** @legacy DELETE /sports/sports-config/:id */
  async removeSport({ id, staffId = null }) {
    const deleted = await this.models.SportsConfig.destroy({ where: { id } });
    if (!deleted) throw errors.SPORT_NOT_FOUND({ id });

    // Removing a configuration row takes the sport off the board — the feed
    // filter keeps only sports that have an enabled row.
    this.logger?.warn({ id, staffId }, 'Sport configuration deleted — the sport is now off the board');
    return { id, deleted: true };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Fancy market controls
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /sports/admin/fancy-controls
   *
   * Legacy returned the whole table unpaged. It grows by one row per fancy
   * market ever touched, which on a busy book is thousands.
   */
  async listFancyControls({ eventId, hiddenOnly, limit = 100, offset = 0 }) {
    const { rows, count } = await this.models.AdminFancyControl.findAndCountAll({
      where: {
        ...(eventId ? { event_id: String(eventId) } : {}),
        ...(hiddenOnly ? { show_fancy: false } : {}),
      },
      order: [['updated_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeControl(r)) };
  }

  /** @legacy GET /sports/admin/fancy-controls/:eventId */
  async fancyControlsForEvent({ eventId }) {
    const rows = await this.models.AdminFancyControl.findAll({
      where: { event_id: String(eventId) },
      order: [['market_name', 'ASC']],
      raw: true,
    });
    return rows.map((r) => this.#shapeControl(r));
  }

  /**
   * @legacy POST /sports/admin/update-fancy-status
   *
   * Open or close one fancy market.
   *
   *   THE TABLE DID NOT EXIST, so this has been a 500 since it was written and
   *   no market has ever actually been closed.
   *
   *   LEGACY'S UPSERT SET `created_at = NOW()` ON THE UPDATE BRANCH. Re-closing
   *   a market overwrote when its control was first created, and there was no
   *   `updated_at` at all — so "when did somebody last touch this market"
   *   had no answer. Both columns exist now and each means what it says.
   */
  async setFancyStatus({ eventId, eventName, marketId, marketName, showFancy, staffId = null }) {
    const now = new Date();

    const [row] = await this.models.AdminFancyControl.upsert(
      {
        event_id: String(eventId),
        event_name: eventName ?? null,
        market_id: String(marketId),
        market_name: marketName ?? null,
        show_fancy: showFancy,
        updated_by: staffId,
        created_at: now,
        updated_at: now,
      },
      {
        conflictFields: ['market_id'],
        // `created_at` is NOT in this list on purpose — the update branch must
        // leave it alone. Legacy overwrote it on every change.
        fields: ['event_id', 'event_name', 'market_name', 'show_fancy', 'updated_by', 'updated_at'],
        returning: true,
      }
    );

    this.logger?.info(
      { eventId, marketId, showFancy, staffId },
      showFancy ? 'Fancy market opened' : 'Fancy market closed'
    );

    return this.#shapeControl(row?.get ? row.get({ plain: true }) : row);
  }

  /**
   * @legacy POST /sports/admin/bulk-update-fancy-status
   *
   * Close or open many markets at once.
   *
   * Legacy looped and ran one upsert per market, each its own round trip and
   * none of them in a transaction — so a failure halfway left some markets
   * closed and some open, with no way to tell which. One statement, one
   * transaction.
   */
  async bulkSetFancyStatus({ eventId, eventName, markets, staffId = null }) {
    if (!markets.length) throw errors.NOTHING_TO_UPDATE();

    const now = new Date();
    const rows = markets.map((m) => ({
      event_id: String(eventId),
      event_name: eventName ?? null,
      market_id: String(m.marketId),
      market_name: m.marketName ?? null,
      show_fancy: m.showFancy,
      updated_by: staffId,
      created_at: now,
      updated_at: now,
    }));

    await this.models.AdminFancyControl.bulkCreate(rows, {
      updateOnDuplicate: ['event_id', 'event_name', 'market_name', 'show_fancy', 'updated_by', 'updated_at'],
    });

    this.logger?.info(
      { eventId, count: rows.length, staffId, closed: rows.filter((r) => !r.show_fancy).length },
      'Fancy markets updated in bulk'
    );

    return this.fancyControlsForEvent({ eventId });
  }

  /**
   * @legacy DELETE /sports/admin/fancy-control/:marketId
   *
   * Remove a control, which returns the market to its default — visible.
   * Worth saying plainly, because "delete the control" reads like "hide it"
   * and does the opposite.
   */
  async removeFancyControl({ marketId, staffId = null }) {
    const deleted = await this.models.AdminFancyControl.destroy({
      where: { market_id: String(marketId) },
    });
    if (!deleted) throw errors.FANCY_CONTROL_NOT_FOUND({ marketId });

    this.logger?.warn(
      { marketId, staffId },
      'Fancy market control removed — the market is visible again'
    );
    return { marketId, deleted: true };
  }

  // ══════════════════════════════════════════════════════════════════════

  #shapeSport(row) {
    return {
      id: row.id,
      gameId: String(row.game_id),
      gameName: row.game_name,
      enabled: Boolean(row.enabled),
    };
  }

  #shapeControl(row) {
    if (!row) return null;
    return {
      id: row.id,
      eventId: row.event_id,
      eventName: row.event_name,
      marketId: row.market_id,
      marketName: row.market_name,
      // TRUE means players can see and bet it.
      showFancy: Boolean(row.show_fancy),
      updatedBy: row.updated_by ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = { CatalogueService };
