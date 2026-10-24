'use strict';

const crypto = require('node:crypto');
const { EVENTS, AUDIENCE } = require('@ibitplay/socket');
const { money } = require('@ibitplay/common');

const errors = require('./wallet.errors');
const { WalletService } = require('./wallet.service');
const { REASON } = require('./wallet.constants');
const { MAX_RAIN_PLAYERS, MIN_TIP, TIP_BLOCKED_CURRENCIES, CHAT_ROOMS } = require('./social.constants');

/**
 * The wallet and social socket events — the ones that move money.
 *
 * Every one routes through `WalletService`, which is one transaction with a
 * guarded debit, exact minor units and an idempotency key. Nothing here does
 * its own arithmetic.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. A TIP WAS THREE UNRELATED STATEMENTS
 *
 *     Rule.getClientCoinCredit(id, coin, (senderBalance) => {
 *       if (senderBalance >= amount) {
 *         Rule.reduceBalance(id, amount, coin, (res, error) => {
 *           Rule.addBalance(targetID, amount, coin, (result, err) => {
 *
 * An unlocked read, a compare in JavaScript, then two independent UPDATEs with
 * no transaction between them. Three separate failures:
 *
 *   - two concurrent tips both see the same balance and both pass the check;
 *   - `reduceBalance` is `SET ${coin} = ${coin} - $2` with NO FLOOR, so the
 *     sender goes negative;
 *   - if `addBalance` fails, the sender has been debited and nobody was
 *     credited. The money is gone.
 *
 * ── 2. `C.RAIN` HAS NEVER WORKED ─────────────────────────────────────────
 *
 *     client.on(C.RAIN, (data) => {
 *       let { amount, players, room, coin } = data;
 *
 * It is the ONLY handler in `Users/index.js` that does not call `decode(data)`
 * — the other twenty-four do. Destructuring a raw Buffer yields `undefined`
 * for all four fields, so `makeRain` receives `amount = undefined`,
 * `_.toNumber` makes it `NaN`, `if (amount <= 0)` is false for `NaN`, and
 * execution reaches
 *
 *     assert(amount >= 0);
 *
 * which throws. Inside a socket handler with no try/catch, that is an
 * unhandled rejection — which in modern Node terminates the process, taking
 * every connected player with it.
 *
 * So `C.RAIN` is not a feature with a bug. It is a way to restart the server.
 *
 * ── 3. AND RAIN BUILT A TABLE NAME FROM THE MESSAGE ───────────────────────
 *
 *     let table = "chat_" + _.lowerCase(room);
 *
 * Chat really is stored per room — `chat_global` and `chat_brazil` are both
 * real tables — so the concatenation has a legitimate intent. What makes it a
 * defect is that `room` arrives in the message and `_.lowerCase` is a
 * FORMATTING function, not a sanitiser: it converts punctuation to spaces, so
 * an injection is mangled into a syntax error rather than refused. It blocks
 * this by accident, and a room name containing a digit or underscore is
 * mangled too.
 *
 * `CHAT_ROOMS` maps a room to its model, so an unknown room is refused and
 * there is no string to build.
 */

/** Legacy's reply shape. Clients read `status`. */
const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: false, msg: error.message, error: { code: error.code } });

function register({ on, deps }) {
  const wallet = new WalletService(deps);
  const { models, logger } = deps;

  /** Resolve a display name to an id, for the tip target. */
  const idOfName = async (name) => {
    const row = await models.Users.findOne({
      where: { name: String(name ?? '').trim() },
      attributes: ['id', 'status'],
      raw: true,
    });
    return row;
  };

  /**
   * @legacy SOCKET 573a867973fa586555cab080e7d837ad
   *
   * `C.SEND_TIP` — send money to another player by name.
   */
  on(EVENTS.SEND_TIP, {
    audience: AUDIENCE.USER,
    // Money leaving an account, one message at a time. Legacy metered nothing.
    limit: { windowMs: 60_000, max: 20 },
    handle: async (payload, context) => {
      const { target, amount, coin } = payload ?? {};
      const currency = String(coin ?? '').toUpperCase();

      try {
        if (TIP_BLOCKED_CURRENCIES.includes(currency)) {
          // Legacy's `if (coin === "nc") return "NC is the test coin !"`.
          throw errors.CURRENCY_NOT_TIPPABLE({ currency });
        }

        const minor = money.toMinor(String(amount ?? '0'));
        if (minor < money.toMinor(MIN_TIP)) throw errors.TIP_TOO_SMALL({ minimum: MIN_TIP });

        const recipient = await idOfName(target);
        // One code for "no such player" and "closed account" — a tip box that
        // distinguishes them is a way to enumerate usernames.
        if (!recipient || recipient.status === 'closed') throw errors.TIP_TARGET_NOT_FOUND();
        if (String(recipient.id) === String(context.userId)) throw errors.TIP_TO_SELF();

        const result = await wallet.transfer(
          {
            fromUserId: String(context.userId),
            toUserId: String(recipient.id),
            currency,
            amount: money.toDecimalString(minor),
            /**
             * A key derived from the sender, the target and a random nonce, so
             * a socket retry of the SAME message moves the money once — and
             * two deliberate tips of the same amount still both go through.
             */
            idempotencyKey: `tip:${context.userId}:${recipient.id}:${crypto.randomUUID()}`,
            description: 'Tip',
          },
          { reason: REASON.TRANSFER_OUT }
        );

        logger?.info(
          { from: String(context.userId), to: String(recipient.id), currency, amount: money.toDecimalString(minor) },
          'Tip sent'
        );

        return ok({ target: String(recipient.id), amount: money.toDecimalString(minor), currency, ...result });
      } catch (error) {
        if (error.code?.startsWith('WALLET_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 23678db5efde9ab76bce8c23a6d91b50
   *
   * `C.RAIN` — split an amount between several players in a chat room.
   *
   * See the module header: the legacy handler never decoded its payload, so
   * this event has never done anything except throw.
   */
  on(EVENTS.RAIN, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 5 * 60_000, max: 5 },
    handle: async (payload, context) => {
      const { amount, players, room, coin } = payload ?? {};
      const currency = String(coin ?? '').toUpperCase();

      try {
        if (TIP_BLOCKED_CURRENCIES.includes(currency)) throw errors.CURRENCY_NOT_TIPPABLE({ currency });

        const count = Number(players);
        if (!Number.isInteger(count) || count < 1 || count > MAX_RAIN_PLAYERS) {
          throw errors.RAIN_PLAYER_COUNT({ max: MAX_RAIN_PLAYERS });
        }

        const each = money.toMinor(String(amount ?? '0'));
        if (each < money.toMinor(MIN_TIP)) throw errors.TIP_TOO_SMALL({ minimum: MIN_TIP });

        /**
         * The recipients: the most recent distinct chatters in the room, the
         * sender excluded. Legacy picked them from `chat_${room}` — a table
         * name built by concatenation from the message.
         */
        const recipients = await recentChatters({ models, room, excludeUserId: context.userId, limit: count });
        if (recipients.length < count) throw errors.RAIN_NOT_ENOUGH_PLAYERS({ wanted: count, found: recipients.length });

        /**
         * Each transfer is its own atomic operation. The FIRST one that cannot
         * be afforded stops the rain, and the ones already sent stand — the
         * alternative is holding a transaction open across N transfers, which
         * on a busy wallet is a lock somebody else is waiting behind.
         *
         * The reply says how many landed, so the sender is never told a rain
         * of ten succeeded when six did.
         */
        const paid = [];
        const nonce = crypto.randomUUID();

        for (const recipient of recipients) {
          try {
            await wallet.transfer(
              {
                fromUserId: String(context.userId),
                toUserId: String(recipient.id),
                currency,
                amount: money.toDecimalString(each),
                idempotencyKey: `rain:${nonce}:${recipient.id}`,
                description: 'Rain',
              },
              { reason: REASON.TRANSFER_OUT }
            );
            paid.push(String(recipient.id));
          } catch (error) {
            if (error.code === errors.INSUFFICIENT_FUNDS.code) break;
            throw error;
          }
        }

        logger?.info(
          { from: String(context.userId), currency, each: money.toDecimalString(each), paid: paid.length, wanted: count },
          'Rain sent'
        );

        if (!paid.length) throw errors.INSUFFICIENT_FUNDS({ currency });

        return ok({
          players: paid.length,
          // Named so a partial rain cannot be read as a complete one.
          requested: count,
          each: money.toDecimalString(each),
          currency,
          recipients: paid,
        });
      } catch (error) {
        if (error.code?.startsWith('WALLET_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 660cb6fe7737d7b70e7a07b706b93f70
   *
   * `C.CREDIT` — the player's own balances.
   *
   * Keyed by the LOWERCASE coin code, which is what legacy emitted (it sent the
   * `credits` row straight out, and those columns are `btc`, `inr`, ...) and
   * what the client still indexes by. `wallet.getBalances` uppercases for the
   * REST contract, so the keys are lowered again here — an uppercase `INR` in
   * this payload reads as a missing balance on the client and the header shows
   * 0.00 for a funded wallet.
   */
  on(EVENTS.CREDIT, {
    audience: AUDIENCE.USER,
    handle: async (_payload, context) => {
      const balances = await wallet.getBalances(String(context.userId));
      return ok({
        credit: Object.fromEntries(
          Object.entries(balances).map(([code, value]) => [code.toLowerCase(), value])
        ),
      });
    },
  });

  /**
   * @legacy SOCKET e70b7663b91b67a7f7e027c00f5a30e2
   *
   * `C.CREDIT_COIN` — one balance.
   */
  on(EVENTS.CREDIT_COIN, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const currency = String(payload?.coin ?? 'INR').toUpperCase();
      try {
        const balance = await wallet.getBalance(String(context.userId), currency);
        return ok({ coin: currency, value: balance });
      } catch (error) {
        if (error.code?.startsWith('WALLET_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET c23c59dd3258d3a53d7132652f8bf98a
   *
   * `C.WALLET_HISTORY`.
   *
   * The player comes from the token. Legacy took `id` from the connection
   * closure, which was correct here — but the same closure is what
   * `C.RESET_PASSWORD` and the chat events did NOT have to satisfy.
   */
  on(EVENTS.WALLET_HISTORY, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const { limit = 50, offset = 0 } = payload ?? {};
      const history = await wallet.listHistory({
        userId: String(context.userId),
        limit: Math.min(Number(limit) || 50, 200),
        offset: Math.max(Number(offset) || 0, 0),
      });
      return ok({ history: history.rows, total: history.count ?? history.total ?? history.rows?.length ?? 0 });
    },
  });
}

/**
 * The most recent distinct chatters in a room.
 *
 * The room chooses a MODEL from a fixed map rather than a table name from a
 * string — see the module header.
 */
async function recentChatters({ models, room, excludeUserId, limit }) {
  const modelName = CHAT_ROOMS[String(room ?? 'global').toLowerCase()];
  if (!modelName) throw errors.UNKNOWN_ROOM({ room });

  const model = models[modelName];
  if (!model) throw errors.UNKNOWN_ROOM({ room });

  /**
   * Ordered by `sorter`, not by `id` — the chat tables have no `id` column.
   * `sorter` is a NOT NULL numeric the writer sets, and it is what legacy's
   * own reads ordered on.
   */
  const rows = await model.findAll({
    attributes: ['uid'],
    order: [['sorter', 'DESC']],
    // Look at more rows than needed, because the same player chatting twice is
    // one recipient.
    limit: limit * 20,
    raw: true,
  });

  const seen = new Set();
  const recipients = [];
  for (const row of rows) {
    const id = String(row.uid);
    if (id === String(excludeUserId) || seen.has(id)) continue;
    seen.add(id);
    recipients.push({ id: row.uid });
    if (recipients.length === limit) break;
  }
  return recipients;
}

module.exports = { register };
