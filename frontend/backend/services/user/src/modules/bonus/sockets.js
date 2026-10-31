'use strict';

const { Op } = require('sequelize');
const { LITERAL_EVENTS, AUDIENCE, encode } = require('@ibitplay/socket');

/**
 * Bonus countdown timers, over the socket.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ONE-SECOND LOOP OVER EVERY CONNECTED SOCKET
 *
 * `legacy/bonus/bonusengine.js`:
 *
 *     if (io) setInterval(async () => {
 *       for (const s of io.sockets.sockets.values()) {
 *         if (!s.userid) continue;
 *         s.emit('bonusTimerUpdate', await getUserBonusTimers(s.userid));
 *       }
 *     }, 1000);
 *
 * One database query per connected player PER SECOND, forever, awaited
 * sequentially inside the interval. With a thousand players online that is a
 * thousand queries a second — and because each is awaited in turn, a slow one
 * pushes the whole loop past its own interval and the next tick starts before
 * the last finished, so the loops pile up.
 *
 * All of it to render a countdown the client can compute itself. The server
 * already sends `claim_deadline`; the number of seconds left is arithmetic on a
 * timestamp, not a fact that needs fetching.
 *
 * So the interval is gone. `getBonusTimers` answers on request with the
 * deadlines AND the derived `secondsLeft` — the same shape legacy sent, so
 * shipped clients need no change — and a client that wants a live countdown
 * ticks it locally between requests.
 *
 * ── AND THE REPLY GOES OUT ON A DIFFERENT EVENT ──────────────────────────
 *
 *     client.on('getBonusTimers', async () => {
 *       ...
 *       client.emit('bonusTimerUpdate', timerData);
 *
 * Asked on one name, answered on another. Kept, because shipped clients listen
 * on `bonusTimerUpdate` — but the transport also replies on the event it was
 * asked on, so an `ack` callback and the legacy listener both work.
 * ═════════════════════════════════════════════════════════════════════════
 */

function register({ on, deps }) {
  const { models, logger } = deps;

  /**
   * @legacy SOCKET getBonusTimers
   */
  on(LITERAL_EVENTS.GET_BONUS_TIMERS, {
    audience: AUDIENCE.USER,
    /**
     * Sixty a minute is one a second — as fast as legacy's interval pushed —
     * so a client that genuinely wants that cadence can still have it, but it
     * costs that client its own budget instead of the whole platform's.
     */
    limit: { windowMs: 60_000, max: 60 },
    handle: async (_payload, context) => {
      const now = Date.now();

      const rows = await models.BonusHistoryEngine.findAll({
        where: {
          userid: context.userId,
          is_claimed: false,
          is_unclaimable: false,
          claim_deadline: { [Op.gte]: new Date(now) },
        },
        attributes: ['id', 'bonus_type', 'bonus_amount', 'claim_deadline'],
        order: [['claim_deadline', 'ASC']],
        raw: true,
      });

      const payload = {
        userid: String(context.userId),
        activeBonuses: rows.map((row) => ({
          id: row.id,
          type: row.bonus_type,
          // Legacy sent `Number(bonus_amount)` — a float for a NUMERIC(30,8)
          // column. A string keeps every digit the column holds.
          amount: String(row.bonus_amount ?? '0'),
          deadline: row.claim_deadline,
          secondsLeft: Math.max(0, Math.floor((new Date(row.claim_deadline).getTime() - now) / 1000)),
        })),
      };

      /**
       * The legacy event name as well as the ack.
       *
       * `bonusTimerUpdate` is what shipped clients listen on; the transport
       * answers on `getBonusTimers` (or the ack callback) for anything written
       * against the ported protocol. Both, so neither breaks.
       */
      context.socket.emit(LITERAL_EVENTS.BONUS_TIMER_UPDATE, encode(payload));

      logger?.debug({ userId: String(context.userId), active: rows.length }, 'Bonus timers served');
      return payload;
    },
  });
}

module.exports = { register };
