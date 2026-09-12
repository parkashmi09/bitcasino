'use strict';

const { EVENTS, AUDIENCE } = require('@ibitplay/socket');

const { RakebackService } = require('./rakeback.service');

/**
 * Rakeback, over the socket.
 *
 * Both events were socket-only in legacy — there is no HTTP equivalent in
 * `legacy/index.js` — and both took no payload at all. `ADD_RAKEBACK` is
 * therefore a money movement triggered by an empty message, which is why the
 * rate limit below is not decoration.
 */

const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: false, msg: error.message, error: { code: error.code } });

function register({ on, deps }) {
  const service = new RakebackService(deps);

  /**
   * @legacy SOCKET 4d0779dab780d8b773e7h6fl9jxd7hm7
   *
   * `C.RAKEBACK_AMOUNT` — how much is claimable.
   */
  on(EVENTS.RAKEBACK_AMOUNT, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 60 },
    handle: async (_payload, context) => {
      try {
        return ok(await service.amount({ userId: context.userId }));
      } catch (error) {
        if (error.code?.startsWith('RAKEBACK_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET k2089ht7ae660578ed9gffgh8hkk7vxj
   *
   * `C.ADD_RAKEBACK` — claim it.
   *
   * ── THE RATE LIMIT IS PART OF THE FIX ────────────────────────────────
   *
   * Legacy's handler is:
   *
   *     client.on(C.ADD_RAKEBACK, () => {
   *       if (!id) return;
   *       Rule.addRakeback(id, (result) => { ... });
   *     });
   *
   * No payload, no limit, and `addRakeback` read the balance and credited it
   * without a lock. A client emitting this in a tight loop had every iteration
   * read the same balance before any of them had reset it.
   *
   * The row lock in the service is what makes that safe. This is the cheaper
   * refusal in front of it — a claim is a once-in-a-while action, and ten a
   * minute is already generous for a button.
   */
  on(EVENTS.ADD_RAKEBACK, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 10 },
    handle: async (_payload, context) => {
      try {
        return ok(await service.claim({ userId: context.userId }));
      } catch (error) {
        if (error.code?.startsWith('RAKEBACK_')) return refuse(error);
        if (error.code === 'WALLET_INSUFFICIENT_FUNDS') return refuse(error);
        throw error;
      }
    },
  });
}

module.exports = { register };
