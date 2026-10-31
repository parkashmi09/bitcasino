'use strict';

/**
 * Locking an account out of the platform, and the public referral lookup.
 *
 * Two small surfaces that share nothing except being what was left.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * LOCKING AN AGENT DID NOT LOCK THEIR TREE
 *
 * `POST /locksystem/update-system-lock` with a `staff_id`:
 *
 *     const query         = `UPDATE users SET ${setClause} WHERE parent_staff_id = $N`;
 *     const queryForStaff = `UPDATE staff SET ${setClause} WHERE id = $1 AND parent_id IS NOT NULL`;
 *
 * The first locks the players attached DIRECTLY to that agent. The second locks
 * that ONE agent. Neither touches the agent's sub-agents, or the players
 * beneath those sub-agents.
 *
 * So an operator locking a compromised agent locks the agent and their own
 * players, and leaves the entire branch below still betting. On a platform
 * where the reason to lock an agent is usually that money is going missing
 * through them, this is the failure that matters: the lock reports success and
 * the exposure continues one level down.
 *
 * Here the whole subtree is locked, in one transaction.
 *
 * ── AND THE `user_id` BRANCH ONLY REACHED DIRECT CHILDREN ────────────────
 *
 *     if (req.staff.level) {
 *       values.push(req.staff.id);
 *       query += ` AND parent_staff_id = $${values.length}`;
 *     }
 *
 * `parent_staff_id = caller` — so any agent above the player's immediate agent
 * silently locked nothing. The UPDATE matched zero rows and the handler still
 * answered `"Lock update successfully."`, because it never looked at the row
 * count. A supervisor locking a player two levels down was told it worked.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * AND `GET /api/public/user-transfers/:uid` WAS AN IDOR ON A ROUTE CALLED PUBLIC
 *
 *     router.get('/user-transfers/:uid', ctrl.getUserTransfers);
 *
 * No authentication, and the uid comes from the path. It returns every
 * `staff_transfers` row involving that player — every deposit and withdrawal,
 * the amounts, the timestamps and the counterparty NAMES — for any id anybody
 * types. Player ids are sequential.
 *
 * `GET /api/public/ref/:slug` genuinely is public: it maps a referral slug to
 * the WhatsApp number a prospective customer should message, and is read before
 * anyone has an account. That one stays open, rate-limited.
 */
module.exports = {
  name: 'locks',
  service: 'admin',
  basePath: '/locks',
  models: ['admin', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
