'use strict';

const { QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');
const { STAFF_LEVELS } = require('@ibitplay/auth');

/**
 * Account list — zip ka `GET /admin/users/all-details` (Account List, Active Users, Bank).
 *
 * Hamesha sirf DIRECT children:
 *   - bina parentId ke  → login wale ke apne children
 *   - parentId ke saath → us staff ke children (drill-down, sirf dekhne ke liye)
 *
 * Owner ke children me direct users bhi aate hain (khud signup kiya, parent_staff_id NULL).
 *
 * Har row ke numbers seedha `credits` row se, zip jaise:
 *   CR            = credit                  (parent ne ab tak net kitna diya)
 *   pts           = all_point
 *   Client(P/L)   = all_point − credit       (settlement me itna barabar karna hai)
 *   Available pts = inr                      (abhi ka balance)
 *   Exposure      = player ka open exposure (staff ka 0, zip jaisa)
 */

const round2 = (value) => Math.round(Number.parseFloat(value || 0) * 100) / 100;
const show = (value) => money.fromStored(value ?? '0', { field: 'balance' });

// Ek hi query me staff + players. Executive (sub-login) list me nahi aate.
const CHILDREN_SQL = `
  SELECT 'staff' AS account_type, s.id AS account_id, s.name AS username, r.name AS role,
         s.percentage, s.status, s.bet_status, s.sports_betlocked,
         c.id AS wallet_id, c.inr, c.credit, c.all_point, 0 AS exposure,
         (EXISTS (SELECT 1 FROM staff k WHERE k.parent_id = s.id)
           OR EXISTS (SELECT 1 FROM users p WHERE p.parent_staff_id = s.id)) AS has_children,
         false AS is_direct_user,
         s.phone, s.country AS city, s.created_at, c.sports_pts, c.upper_point, c.down_point, c.thirdparty_pts, c.original_game_pts
    FROM staff s
    JOIN roles r ON r.id = s.role_id
    LEFT JOIN credits c ON c.staff_id = s.id
   WHERE s.parent_id = :parentId AND r.level < :executiveLevel
  UNION ALL
  SELECT 'user', u.id, u.name, 'User',
         NULL, u.status, u.bet_status, u.sports_betlocked,
         c.id, c.inr, c.credit, c.all_point,
         COALESCE((SELECT ABS(SUM(e.total_exposure)) FROM mssports.total_exposures e WHERE e.user_id = u.id), 0),
         false, u.parent_staff_id IS NULL,
         u.phone, u.last_city, u.created, c.sports_pts, c.upper_point, c.down_point, c.thirdparty_pts, c.original_game_pts
    FROM users u
    LEFT JOIN credits c ON c.uid = u.id
   WHERE u.parent_staff_id = :parentId OR (:withDirectUsers AND u.parent_staff_id IS NULL AND NOT u.is_demo)`;

/** Ek DB row → screen ki row. */
function toRow(r) {
  const allPoint = round2(r.all_point);
  const credit = round2(r.credit);
  return {
    accountType: r.account_type, // 'staff' | 'user'
    accountId: String(r.account_id),
    walletId: r.wallet_id == null ? null : String(r.wallet_id),
    username: r.username,
    role: r.role,
    percentage: r.percentage == null ? null : Number(r.percentage),
    credit: show(r.credit),
    allPoint: show(r.all_point),
    settlementPoints: show(round2(allPoint - credit)),
    available: show(r.inr),
    exposure: show(r.exposure),
    betLocked: r.bet_status !== 'active' || r.sports_betlocked === true,
    userLocked: r.status !== 'active',
    hasChildren: r.has_children === true,
    isDirectUser: r.is_direct_user === true, // owner ka wallet iske len-den me nahi aata

    // More modal ke Profile tab ke liye (zip "Additional Information")
    phone: r.phone ?? null,
    city: r.city ?? null,
    createdAt: r.created_at ?? null,
    sportsPts: show(r.sports_pts),
    casinoPts: show(r.thirdparty_pts), // third-party (casino) games
    originalPts: show(r.original_game_pts), // Original games
    upperPoint: show(r.upper_point),
    downPoint: show(r.down_point),
  };
}

/**
 * Direct children ki list, page ke hisaab se.
 *
 * @param {object} p
 * @param {number} p.parentId        jiske children chahiye (login wala ya drill-down staff)
 * @param {boolean} p.withDirectUsers owner ke liye true — direct users bhi
 * @param {string} [p.search]        username me dhoondo
 */
// Direct Users | Agent Users tab: direct = sirf direct users, agent = staff + unke players. Na ho = dono.
const CHANNEL_SQL = { direct: 'AND a.is_direct_user', agent: 'AND NOT a.is_direct_user' };

async function listChildren(sequelize, { parentId, withDirectUsers, search, channel, accountType, limit, offset }) {
  const replacements = {
    parentId,
    withDirectUsers: Boolean(withDirectUsers),
    executiveLevel: STAFF_LEVELS.EXECUTIVE,
    search: search ? `%${search}%` : null,
    accountType: accountType ?? null,
    limit,
    offset,
  };
  const where = `WHERE (CAST(:search AS text) IS NULL OR a.username ILIKE :search)
    AND (CAST(:accountType AS text) IS NULL OR a.account_type = :accountType) ${CHANNEL_SQL[channel] ?? ''}`;

  const [rows, [{ total }]] = await Promise.all([
    sequelize.query(
      `SELECT * FROM (${CHILDREN_SQL}) a ${where}
        ORDER BY LOWER(a.username), a.account_id
        LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(`SELECT COUNT(*)::int AS total FROM (${CHILDREN_SQL}) a ${where}`, {
      replacements,
      type: QueryTypes.SELECT,
    }),
  ]);

  return { rows: rows.map(toRow), total };
}

module.exports = { listChildren, round2 };
