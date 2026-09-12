'use strict';

const { LITERAL_EVENTS, AUDIENCE } = require('@ibitplay/socket');

const { SpinWheelService } = require('./spinWheel.service');

/**
 * The lucky wheel, over the socket.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `wheeler` WAS AN IN-MEMORY ARRAY
 *
 *     client.on("wheeler", (data) => {
 *       if (!id) return;
 *       id = parseFloat(id);
 *       if (!_.includes(luckeyUsers, id)) {
 *         client.emit("wheeler", encode({ status: true }));
 *         luckeyUsers.push(id);
 *       } else {
 *         client.emit("wheeler", encode({ status: false }));
 *       }
 *     });
 *
 * `luckeyUsers` is a module-scope array in `legacy/Users/index.js`. Everything
 * that follows from that:
 *
 *   ONE PROCESS ONLY. `legacy/index.js` forks a worker per CPU, so each worker
 *   has its own array. A player refused on worker 1 reconnects, lands on worker
 *   2, and is eligible again. On an eight-core box the answer is eight spins.
 *
 *   LOST ON RESTART. Every deploy made every player eligible again.
 *
 *   IT NEVER SHRANK. An entry was pushed and never removed, so the array grew
 *   for the life of the process — and eligibility was permanent-until-restart
 *   rather than a cooldown.
 *
 *   `id = parseFloat(id)` REASSIGNS THE CONNECTION'S OWN ID. The handler
 *   overwrites the enclosing-scope `id` that every OTHER handler on that socket
 *   reads. It happens to produce the same number, so nothing broke — but a
 *   handler mutating the connection's identity is one refactor away from doing.
 *
 * And it never spun anything: the reply is `{status: true}` or `{status:
 * false}`, with the prize decided entirely on the client.
 *
 * `SpinWheelService` has the real thing — a cooldown from the config, a deposit
 * requirement, weighted slices, and one transaction with the claim history
 * locked so two simultaneous requests cannot both pass.
 * ═════════════════════════════════════════════════════════════════════════
 */

const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: false, msg: error.message, error: { code: error.code } });

function register({ on, deps }) {
  const service = new SpinWheelService(deps);

  /**
   * @legacy SOCKET wheeler
   *
   * `{status: true}` when the player may spin — the shape shipped clients
   * expect — with the eligibility detail alongside it.
   */
  on(LITERAL_EVENTS.WHEELER, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 30 },
    handle: async (payload, context) => {
      try {
        /**
         * `{ spin: true }` performs the spin; anything else asks whether it is
         * allowed. Legacy had one event that did neither properly, and clients
         * send it with no payload — so the default stays the CHECK, and a spin
         * has to be asked for. A message that could not be distinguished from a
         * page load must not consume a player's spin.
         */
        if (payload?.spin !== true) {
          const eligibility = await service.eligibility({ userId: context.userId });
          return { status: eligibility.eligible, ...eligibility };
        }

        return ok(await service.spin({ userId: context.userId }));
      } catch (error) {
        if (error.code?.startsWith('SPIN_')) return refuse(error);
        throw error;
      }
    },
  });
}

module.exports = { register };
