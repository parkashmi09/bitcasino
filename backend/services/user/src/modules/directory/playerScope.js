'use strict';

const { Op, literal } = require('sequelize');
const { defineErrors } = require('@ibitplay/common');

/**
 * Which players a staff caller may see — for the staff listings in this
 * service that are not the directory itself.
 *
 * The same question `DirectoryService` and `WalletService.assertPlayerVisible`
 * ask, answered the same way: admin-service owns `staff`, so it resolves the
 * caller's visible staff (`visibleStaffIds`, behind
 * `/internal/admin/staff-directory/staff/:id/descendants`) and a tree that
 * contains the platform root sees everyone, direct signups included. Anyone
 * else sees the players whose `parent_staff_id` is in that list.
 *
 * The staff id is the verified token's (`req.staff.id`), never a header or a
 * query parameter, so a caller cannot widen its own scope. A failed lookup
 * throws — a listing that cannot resolve its scope must not fall back to
 * everyone.
 */

const errors = defineErrors('PLAYER_SCOPE', {
  /**
   * 404 rather than 403, like every other per-player staff route: saying the
   * player exists but is outside the caller's tree is itself information
   * about someone else's downline.
   */
  PLAYER_NOT_IN_YOUR_TREE: { status: 404, message: 'Player not found' },
});

/** `{ all: true }`, or `{ all: false, staffIds }`. */
async function visibleStaff({ clients, config }, staffId) {
  if (!staffId) return { all: false, staffIds: [] };

  const result = await clients.admin.get(`/internal/admin/staff-directory/staff/${staffId}/descendants`);
  const ids = (result?.ids ?? result?.data?.ids ?? []).map(Number);

  const root = Number(config?.ROOT_STAFF_ID ?? 1);
  if (ids.includes(root)) return { all: true, staffIds: ids };

  return { all: false, staffIds: ids };
}

/**
 * The ids of the players this caller may see, as STRINGS — or `null` for all.
 *
 * Strings because they are bound against both BIGINT owner columns and the
 * VARCHAR ones (`user_kyc.user_id`, `p2p_orders.user_id`), and a number
 * against VARCHAR is `character varying = integer`, which Postgres refuses.
 */
async function visibleUserIds(deps, staffId) {
  const scope = await visibleStaff(deps, staffId);
  if (scope.all) return null;
  if (!scope.staffIds.length) return [];

  const users = await deps.models.Users.findAll({
    where: { parent_staff_id: scope.staffIds },
    attributes: ['id'],
    raw: true,
  });
  return users.map((u) => String(u.id));
}

/**
 * `{ [column]: ids }` for a listing's `where`, or `{}` when the caller sees
 * everyone. `requested` (an optional `userId` filter) is intersected with the
 * scope: a filter naming a player outside the tree finds nothing.
 */
async function ownerWhere(deps, staffId, column, requested) {
  const ids = await visibleUserIds(deps, staffId);

  if (requested != null && requested !== '') {
    const wanted = String(requested);
    if (ids && !ids.includes(wanted)) return { [column]: [] };
    return { [column]: wanted };
  }

  return ids ? { [column]: ids } : {};
}

/** A per-player staff route: the player must be in the caller's tree. */
async function assertPlayerVisible(deps, staffId, userId) {
  const scope = await visibleStaff(deps, staffId);
  if (scope.all) return;

  // Some owner columns are VARCHAR; a value that is not an id is nobody's.
  const player = scope.staffIds.length && /^\d+$/.test(String(userId))
    ? await deps.models.Users.findOne({
        where: { id: userId, parent_staff_id: scope.staffIds },
        attributes: ['id'],
        raw: true,
      })
    : null;
  if (!player) throw errors.PLAYER_NOT_IN_YOUR_TREE({ userId });
}

/** `channel` → users ki SQL shart: direct = koi parent nahi, agent = Sports Exchange agent ke neeche. */
const CHANNEL_SQL = { direct: 'parent_staff_id IS NULL', agent: 'parent_staff_id IS NOT NULL' };

/**
 * Direct Users | Agent Users tab — listing ke `where` me ek aur shart jodo: `column` ka player
 * us channel ka ho. `channel` na ho to `where` jaisa tha waisa (purana jawab). `text: true` jab
 * column VARCHAR ho (`user_kyc.user_id`, `p2p_orders.user_id`).
 */
function withChannel(where, column, channel, { text = false } = {}) {
  if (!CHANNEL_SQL[channel]) return where;
  const ids = literal(`(SELECT id${text ? '::text' : ''} FROM users WHERE ${CHANNEL_SQL[channel]})`);
  return { ...where, [Op.and]: [...(where[Op.and] ?? []), { [column]: { [Op.in]: ids } }] };
}

module.exports = { visibleStaff, visibleUserIds, ownerWhere, assertPlayerVisible, withChannel, CHANNEL_SQL, errors };
