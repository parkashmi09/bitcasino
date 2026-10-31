'use strict';

const { cascadeUpdate, CASCADE_KINDS } = require('./lockSources');
const { descendantIds } = require('../staff-directory/staffDirectory.service');

/**
 * Suspending a staff account suspends its whole downline — the same cascade
 * the system lock (`POST /admin/locks {system: true}`) applies.
 *
 * Every staff account beneath it and every player under any of them gets
 * `system_locked` through `cascadeUpdate`, held by `suspend:<staffId>` in
 * `lock_sources`. So every check that already honours the system lock —
 * staff and player login, the auth guards on existing tokens, casino launch,
 * the bet lock — refuses them, and reactivation lifts ONLY what the
 * suspension imposed: a lock set directly on a child, or held by another
 * ancestor or by a `POST /admin/locks` on this same agent, stays.
 *
 * The suspended account itself is refused by its own `status`; it is not
 * system-locked here.
 *
 * @param {object} models
 * @param {number|string} staffId the account whose status changed
 * @param {boolean} suspended true when the new status is not `active`
 * @returns {Promise<{ agentsAffected: number, playersAffected: number }>}
 */
async function cascadeSuspension(models, staffId, suspended, { transaction, logger } = {}) {
  const subtree = await descendantIds(models, staffId, { logger });
  if (!subtree.length) return { agentsAffected: 0, playersAffected: 0 };
  const below = subtree.filter((id) => Number(id) !== Number(staffId));

  const set = cascadeUpdate({ system_locked: Boolean(suspended) }, staffId, { kind: CASCADE_KINDS.SUSPEND });

  const [agentsAffected] = below.length
    ? await models.Staff.update(set, { where: { id: below }, transaction })
    : [0];
  const [playersAffected] = await models.Users.update(set, {
    where: { parent_staff_id: subtree },
    transaction,
  });

  logger?.warn(
    { staffId, suspended, agentsAffected, playersAffected },
    suspended ? 'Staff suspension cascaded to its downline' : 'Staff reactivation lifted its downline suspension'
  );
  return { agentsAffected, playersAffected };
}

module.exports = { cascadeSuspension };
