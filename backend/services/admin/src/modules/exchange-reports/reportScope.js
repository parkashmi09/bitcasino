'use strict';

const { QueryTypes } = require('sequelize');
const { AppError } = require('@ibitplay/common');
const { STAFF_LEVELS } = require('@ibitplay/auth');

const { manageableStaffIds } = require('../staff-directory/staffDirectory.service');

/**
 * Reports ka scope — zip ka `getUserIdsByHierarchy`.
 *
 * Login wala sirf apne tree ka data dekhta hai:
 *   staffIds  = uske neeche ke saare staff (khud bhi). Owner = poori site.
 *   players   = un staff ke players + (sirf owner) direct users (parent_staff_id NULL).
 *
 * "Search By Client Name" me koi account chuna ho to report usi tak simit:
 *   player → sirf wahi,  staff → uske neeche ke players.
 */

const notInTree = () => new AppError('This account is not in your tree', 404, 'EXCHANGE_NOT_IN_YOUR_TREE');

/**
 * Login wale ka tree. `channel` = Direct Users | Agent Users tab:
 *   'direct' → sirf direct users (koi staff / agent ka player nahi),
 *   'agent'  → sirf staff tree (direct users nahi),  na ho → dono (purana).
 */
async function treeOf(models, actor, logger, channel) {
  const ids = await manageableStaffIds(models, actor.id, { logger, level: actor.level });
  return {
    meId: Number(actor.id),
    staffIds: channel === 'direct' ? [] : ids.map(Number),
    withDirectUsers: channel === 'agent' ? false : Boolean(actor.canIssueFunds),
  };
}

/** Players ke ids (string — users.id bigint hai) jinke parent `staffIds` me hain. */
async function playersUnder(sequelize, staffIds, withDirectUsers) {
  if (!staffIds.length && !withDirectUsers) return [];
  const rows = await sequelize.query(
    `SELECT id FROM users
      WHERE parent_staff_id IN (:staffIds) OR (:withDirectUsers AND parent_staff_id IS NULL)`,
    { replacements: { staffIds: staffIds.length ? staffIds : [0], withDirectUsers }, type: QueryTypes.SELECT }
  );
  return rows.map((r) => String(r.id));
}

/** Chuna hua account (client) — tree ke andar hona chahiye. */
async function findClient(sequelize, tree, { clientType, clientId }) {
  if (!clientType || !clientId) return null;

  if (clientType === 'user') {
    const [user] = await sequelize.query('SELECT id, name, parent_staff_id FROM users WHERE id = :id', {
      replacements: { id: clientId },
      type: QueryTypes.SELECT,
    });
    const visible = user && (tree.staffIds.includes(Number(user.parent_staff_id)) || (user.parent_staff_id == null && tree.withDirectUsers));
    if (!visible) throw notInTree();
    return { type: 'user', id: String(user.id), name: user.name };
  }

  if (!tree.staffIds.includes(Number(clientId))) throw notInTree();
  const [staff] = await sequelize.query('SELECT id, name FROM staff WHERE id = :id', {
    replacements: { id: clientId },
    type: QueryTypes.SELECT,
  });
  if (!staff) throw notInTree();
  return { type: 'staff', id: String(staff.id), name: staff.name };
}

/**
 * Report kin players par chalega:
 *   koi client nahi → poora tree,  player → [wahi],  staff → uska subtree.
 */
async function playersFor(sequelize, tree, client) {
  if (!client) return playersUnder(sequelize, tree.staffIds, tree.withDirectUsers);
  if (client.type === 'user') return [client.id];

  // Owner ne khud ko chuna — poora tree (direct users bhi).
  if (Number(client.id) === tree.meId) return playersUnder(sequelize, tree.staffIds, tree.withDirectUsers);

  const rows = await sequelize.query('SELECT descendant_id FROM staff_hierarchy WHERE ancestor_id = :id', {
    replacements: { id: client.id },
    type: QueryTypes.SELECT,
  });
  const subtree = rows.map((r) => Number(r.descendant_id)).filter((id) => tree.staffIds.includes(id));
  if (!subtree.includes(Number(client.id))) subtree.push(Number(client.id));
  return playersUnder(sequelize, subtree, false);
}

/** "Search By Client Name" — tree ke players + staff, naam se (zip ka ClientMultiselect). */
async function searchClients(sequelize, tree, search) {
  const rows = await sequelize.query(
    `SELECT * FROM (
       SELECT 'user' AS type, u.id::text AS id, u.name AS username, 'User' AS role
         FROM users u
        WHERE u.name ILIKE :q
          AND (u.parent_staff_id IN (:staffIds) OR (:withDirectUsers AND u.parent_staff_id IS NULL))
       UNION ALL
       SELECT 'staff', s.id::text, s.name, r.name
         FROM staff s JOIN roles r ON r.id = s.role_id
        WHERE s.name ILIKE :q AND s.id IN (:staffIds) AND r.level < :executiveLevel
     ) a
     ORDER BY LOWER(a.username)
     LIMIT 15`,
    {
      replacements: {
        q: `%${search}%`,
        staffIds: tree.staffIds.length ? tree.staffIds : [0],
        withDirectUsers: tree.withDirectUsers,
        executiveLevel: STAFF_LEVELS.EXECUTIVE,
      },
      type: QueryTypes.SELECT,
    }
  );
  return rows;
}

/** Account ka wallet (credits.id) — point_ledger.wallet_id yahi hai. */
async function walletIdOf(sequelize, account) {
  const column = account.type === 'user' ? 'uid' : 'staff_id';
  const [row] = await sequelize.query(`SELECT id FROM credits WHERE ${column} = :id`, {
    replacements: { id: account.id },
    type: QueryTypes.SELECT,
  });
  return row ? Number(row.id) : null;
}

module.exports = { treeOf, playersUnder, findClient, playersFor, searchClients, walletIdOf, notInTree };
