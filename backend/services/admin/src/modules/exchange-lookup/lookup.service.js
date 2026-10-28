'use strict';

const { QueryTypes } = require('sequelize');
const { STAFF_LEVELS } = require('@ibitplay/auth');

const { manageableStaffIds } = require('../staff-directory/staffDirectory.service');

/**
 * Username search — zip ka `searchUsersByUsername`.
 *
 * Zip `Wallets` table me username dhoondta tha; hamare yahan wallet `credits` hai
 * aur naam `staff.name` / `users.name` me. Scope zip jaisa:
 *   - owner     → poori site (direct users bhi), khud ko chhod ke
 *   - baaki     → apna poora downline (har level niche tak), khud ko chhod ke
 * Owner (level 1) aur executive (level 7) accounts list me nahi aate.
 *
 * Har result zip ki shape me: { wallet_id, user_id, staff_id, username, user_type }.
 */

const SEARCH_SQL = `
  SELECT * FROM (
    SELECT c.id AS wallet_id, NULL::bigint AS user_id, s.id AS staff_id, s.name AS username, 'STAFF' AS user_type
      FROM staff s
      JOIN roles r ON r.id = s.role_id
      LEFT JOIN credits c ON c.staff_id = s.id
     WHERE s.id IN (:staffIds) AND s.id <> :me
       AND r.level > :ownerLevel AND r.level < :executiveLevel
       AND s.name ILIKE :like
    UNION ALL
    SELECT c.id, u.id, NULL::bigint, u.name, 'USER'
      FROM users u
      LEFT JOIN credits c ON c.uid = u.id
     WHERE (u.parent_staff_id IN (:staffIds) OR (:withDirectUsers AND u.parent_staff_id IS NULL AND NOT u.is_demo))
       AND u.name ILIKE :like
  ) a
  ORDER BY LOWER(a.username), a.user_type
  LIMIT :limit OFFSET :offset`;

// % aur _ ko seedha text maano, wildcard nahi.
const likeOf = (text) => `%${String(text).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/**
 * @param {object} models
 * @param {object} p
 * @param {{ id: number, level: number }} p.actor login wala staff
 * @param {string} p.username  naam ka hissa
 */
async function searchByUsername(models, { actor, username, page = 1, limit = 25, logger }) {
  const isOwner = Number(actor.level) === STAFF_LEVELS.SUPER_ADMIN;
  const staffIds = await manageableStaffIds(models, actor.id, { logger, level: actor.level });

  const rows = await models.Credits.sequelize.query(SEARCH_SQL, {
    replacements: {
      staffIds: staffIds.length ? staffIds : [0],
      me: actor.id,
      ownerLevel: STAFF_LEVELS.SUPER_ADMIN,
      executiveLevel: STAFF_LEVELS.EXECUTIVE,
      withDirectUsers: isOwner,
      like: likeOf(username),
      limit,
      offset: (page - 1) * limit,
    },
    type: QueryTypes.SELECT,
  });

  const results = rows.map((r) => ({
    wallet_id: r.wallet_id == null ? null : String(r.wallet_id),
    user_id: r.user_id == null ? null : String(r.user_id),
    staff_id: r.staff_id == null ? null : String(r.staff_id),
    username: r.username,
    user_type: r.user_type, // 'STAFF' | 'USER'
  }));
  return { results, page, limit };
}

module.exports = { searchByUsername };
