'use strict';

/**
 * Agent System dashboard (zip msadmin ka Home): login wale ka apna wallet (credits) +
 * downline exposure. Baaki zip user-reports (User History, Auth List, Fraud, Register Detail) hata diye.
 */

const { QueryTypes } = require('sequelize');
const { STAFF_LEVELS } = require('@ibitplay/auth');

const { manageableStaffIds } = require('../staff-directory/staffDirectory.service');

const round2 = (value) => Math.round(Number.parseFloat(value || 0) * 100) / 100;
/** NUMERIC → "123.45" (2 decimals). */
const show = (value) => round2(value).toFixed(2);

class UserReportsService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  get sequelize() {
    return this.models.Credits.sequelize;
  }

  #query(sql, replacements) {
    return this.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Home (dashboard)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Zip `Home.jsx` ke cards — login wale ka apna `credits` row:
   *   Balance = inr, Credit pts = credit, All pts = all_point,
   *   Settlement pts = all_point − credit, Upper / Down pts, Sports / Casino / Original pts (P/L ke liye).
   * Exposure = tree ke agent players ka open exposure (zip: downline ka total). Direct users
   * (koi parent nahi) Agent System ke nahi — owner ke liye bhi yahan kabhi nahi gine jaate.
   */
  async home({ actor }) {
    const [wallet] = await this.#query(
      `SELECT inr, credit, all_point, upper_point, down_point, sports_pts, thirdparty_pts, original_game_pts
         FROM credits WHERE staff_id = :staffId LIMIT 1`,
      { staffId: actor.id }
    );
    const exposure = await this.#downlineExposure(actor);
    const allPoint = round2(wallet?.all_point);
    const credit = round2(wallet?.credit);

    return {
      balance: show(wallet?.inr),
      exposure: show(exposure),
      credit: show(wallet?.credit),
      allPoint: show(wallet?.all_point),
      settlementPoints: show(round2(allPoint - credit)),
      upperPoint: show(wallet?.upper_point),
      downPoint: show(wallet?.down_point),
      sportsPts: show(wallet?.sports_pts),
      casinoPts: show(wallet?.thirdparty_pts),
      originalPts: show(wallet?.original_game_pts),
      isOwner: this.#isOwner(actor),
    };
  }

  /** Tree ke agent players ka exposure — har player ka |SUM(total_exposure)|, phir sabka jod. Direct users nahi. */
  async #downlineExposure(actor) {
    const staffIds = await this.#treeStaffIds(actor);
    const [row] = await this.#query(
      `SELECT COALESCE(SUM(x.exp), 0) AS total FROM (
         SELECT ABS(SUM(e.total_exposure)) AS exp
           FROM mssports.total_exposures e
           JOIN users u ON u.id = e.user_id
          WHERE u.parent_staff_id IN (:staffIds)
          GROUP BY e.user_id) x`,
      { staffIds: staffIds.length ? staffIds : [0] }
    );
    return row.total;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  User History — Login History / Change Password History / Ip Detail
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  //  User Authentication
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  //  Fraud Report
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  //  User Register Detail
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════════════════════════════════

  #isOwner(actor) {
    return Number(actor.level) === STAFF_LEVELS.SUPER_ADMIN;
  }

  /** Login wale ke neeche ke saare staff ids (khud bhi). Owner = poori site. */
  async #treeStaffIds(actor) {
    const ids = await manageableStaffIds(this.models, actor.id, { logger: this.logger, level: actor.level });
    return ids.map(Number);
  }
}

module.exports = { UserReportsService };
