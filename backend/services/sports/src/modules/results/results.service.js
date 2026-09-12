'use strict';

const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./results.errors');

/**
 * Settled market and fancy results.
 *
 * Read-only. The settlement path writes these rows; nothing here can change
 * one, which is deliberate — a payout record that a reporting endpoint can
 * edit is not a record.
 */
class ResultsService {
  constructor({ models, clients, logger, config }) {
    this.models = models;
    this.clients = clients;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  A player's own
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /sportsbetting/MO/:id
   *
   * Settled match-odds positions for one player.
   *
   * Legacy took the player from the URL on a route with no middleware, so any
   * id returned that player's settled positions and payouts.
   */
  async marketResults({ userId, limit = 10, offset = 0 }) {
    const { rows, count } = await this.models.Marketwins.findAndCountAll({
      where: { user_id: String(userId) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeMarket(r)) };
  }

  /** @legacy GET /sportsbetting/FAN/:id */
  async fancyResults({ userId, limit = 10, offset = 0 }) {
    const { rows, count } = await this.models.Fanwins.findAndCountAll({
      where: { userid: String(userId) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeFancy(r)) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Staff
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /sportsbetting/marketwins
   * @legacy GET /sportsbetting
   *
   * Settled match-odds results across the caller's tree.
   *
   * Two legacy endpoints over the same table: one scoped by the `x-staff-id`
   * header, and the router's bare root with no scoping whatsoever.
   */
  async listMarketResults({ staff, search, userId, matchId, limit = 10, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff);
    const scope = this.#scopeFor(visible, userId);

    const where = {
      user_id: scope,
      ...(matchId ? { matchid: String(matchId) } : {}),
      ...(search
        ? {
            [Op.or]: [
              { matchname: { [Op.iLike]: `%${search}%` } },
              { winteam: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {}),
    };

    const { rows, count } = await this.models.Marketwins.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.user_id));
    return {
      total: count,
      rows: rows.map((r) => ({ ...this.#shapeMarket(r), username: names.get(String(r.user_id)) ?? null })),
    };
  }

  /** @legacy GET /sportsbetting/fanwins */
  async listFancyResults({ staff, search, userId, limit = 10, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff);
    const scope = this.#scopeFor(visible, userId);

    const { rows, count } = await this.models.Fanwins.findAndCountAll({
      where: {
        userid: scope,
        ...(search ? { fancyname: { [Op.iLike]: `%${search}%` } } : {}),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.userid));
    return {
      total: count,
      rows: rows.map((r) => ({ ...this.#shapeFancy(r), username: names.get(String(r.userid)) ?? null })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Narrow to one player, refusing if they are outside the tree.
   *
   * Legacy's `restrictByTree = !tree.includes(1)` meant a caller whose tree
   * contained the platform owner skipped the filter entirely — and the tree
   * came from a header the caller set.
   */
  #scopeFor(visible, userId) {
    if (!userId) return visible.map(String);
    if (!visible.map(String).includes(String(userId))) throw errors.NOT_IN_YOUR_TREE({ userId });
    return [String(userId)];
  }

  async #visibleUserIds(staff) {
    let staffIds;
    try {
      const result = await this.clients.admin.get(
        `/internal/admin/staff-directory/staff/${staff.id}/descendants`
      );
      staffIds = result?.ids ?? result?.data?.ids;
    } catch (error) {
      this.logger?.error({ err: error, staffId: staff?.id }, 'Could not resolve the staff reporting scope');
      throw errors.VISIBILITY_UNAVAILABLE();
    }
    if (!Array.isArray(staffIds) || !staffIds.length) throw errors.VISIBILITY_UNAVAILABLE();

    const includeUnassigned = staffIds.map(Number).includes(1);
    const users = await this.models.Users.findAll({
      where: includeUnassigned
        ? { [Op.or]: [{ parent_staff_id: staffIds }, { parent_staff_id: null }] }
        : { parent_staff_id: staffIds },
      attributes: ['id'],
      raw: true,
    });
    return users.map((u) => u.id);
  }

  async #namesFor(ids) {
    if (!ids.length) return new Map();
    const numeric = [...new Set(ids.map(Number))].filter(Number.isFinite);
    if (!numeric.length) return new Map();
    const rows = await this.models.Users.findAll({
      where: { id: { [Op.in]: numeric } },
      attributes: ['id', 'name'],
      raw: true,
    });
    return new Map(rows.map((u) => [String(u.id), u.name]));
  }

  #shapeMarket(row) {
    return {
      id: row.id,
      userId: row.user_id,
      matchId: row.matchid,
      eventId: row.eventid,
      matchName: row.matchname,
      winner: row.winteam,
      bets: row.totalbets != null ? Number(row.totalbets) : null,
      // The exposure held on each outcome at settlement, as exact decimals.
      // Legacy returned these raw, so a caller reading them as numbers picked
      // up whatever precision the JSON serialiser gave.
      exposure: {
        team1: money.toDecimalString(money.toMinor(row.team1ex ?? '0')),
        team2: money.toDecimalString(money.toMinor(row.team2ex ?? '0')),
        draw: money.toDecimalString(money.toMinor(row.drawex ?? '0')),
      },
      payout: money.toDecimalString(money.toMinor(row.payout ?? '0')),
    };
  }

  #shapeFancy(row) {
    return {
      id: row.id,
      userId: row.userid,
      matchId: row.matchid ?? null,
      eventId: row.eventid ?? null,
      fancyName: row.fancyname,
      selection: row.selection,
      runsOdds: row.runsodds != null ? String(row.runsodds) : null,
      payout: money.toDecimalString(money.toMinor(row.payout ?? '0')),
    };
  }
}

module.exports = { ResultsService };
