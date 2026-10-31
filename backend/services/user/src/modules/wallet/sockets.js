'use strict';

const { EVENTS, AUDIENCE } = require('@ibitplay/socket');
const { money, entitlements, assertCurrencySupportedFor } = require('@ibitplay/common');

const errors = require('./wallet.errors');
const { WalletService, creditPayload } = require('./wallet.service');
const { MAX_RAIN_PLAYERS, MIN_TIP, TIP_BLOCKED_CURRENCIES, CHAT_ROOMS } = require('./social.constants');
const { TipService } = require('../tip/tip.service');

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
/** A refusal the player can act on (a coded 4xx), as opposed to a fault that should surface. */
const isRefusal = (error) => Boolean(error?.code) && (error.status == null || error.status < 500);
/**
 * Rain recipients the tip rules turn away one at a time (tips off, agent-tree player, closed
 * account): skipped, the rain carries on. Anything else (limits, balance, rate) stops it.
 */
const RAIN_SKIP = new Set(['TIP_USER_NOT_FOUND', 'TIP_DISABLED_BY_RECIPIENT', 'TIP_RECIPIENT_UNAVAILABLE', 'TIP_SELF']);

function register({ on, deps }) {
  const wallet = new WalletService(deps);
  /*
   * Chat tips and rain go through the tip module, not a bare wallet transfer: the same plan
   * switch, per-player "Allow tips", agent-tree rules, operator limits, ledger reasons, `tips`
   * row and notification as the wallet's Tip tab. Before this, a socket message skipped all of it.
   */
  const tips = new TipService(deps);
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
        await entitlements.assertFeatureEntitled('tips');
        if (TIP_BLOCKED_CURRENCIES.includes(currency)) {
          // Legacy's `if (coin === "nc") return "NC is the test coin !"`.
          throw errors.CURRENCY_NOT_TIPPABLE({ currency });
        }
        assertCurrencySupportedFor('TIPS', currency);

        const minor = money.toMinor(String(amount ?? '0'));
        if (minor < money.toMinor(MIN_TIP)) throw errors.TIP_TOO_SMALL({ minimum: MIN_TIP });

        const result = await tips.send({
          userId: context.userId,
          toUsername: String(target ?? '').trim().slice(0, 50),
          currency,
          amount: money.toDecimalString(minor),
        });

        logger?.info({ from: String(context.userId), tipId: result.tipId, currency, amount: result.amount }, 'Chat tip sent');
        return ok({ target: result.toUsername, amount: result.amount, currency, tipId: result.tipId, balance: result.balance });
      } catch (error) {
        if (isRefusal(error)) return refuse(error);
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
        await entitlements.assertFeatureEntitled('tips');
        assertCurrencySupportedFor('TIPS', currency);
        // Twice as many candidates as wanted: some will have tips off or be agent-tree players.
        const candidates = await recentChatters({ models, room, excludeUserId: context.userId, limit: count * 2 });
        const names = new Map(
          (await models.Users.findAll({ where: { id: candidates.map((r) => r.id) }, attributes: ['id', 'name'], raw: true }))
            .map((u) => [String(u.id), u.name])
        );

        /**
         * One tip per recipient through the tip module (each atomic, each its own `tips` row).
         * A recipient the rules turn away is skipped; the first refusal that is about the SENDER
         * (balance, limits, rate) stops the rain, and the tips already sent stand. The reply says
         * how many landed, so the sender is never told a rain of ten succeeded when six did.
         */
        const paid = [];
        let stoppedBy = null;
        for (const recipient of candidates) {
          if (paid.length === count) break;
          const name = names.get(String(recipient.id));
          if (!name) continue;
          try {
            await tips.send({ userId: context.userId, toUsername: name, currency, amount: money.toDecimalString(each), note: 'Rain' });
            paid.push(String(recipient.id));
          } catch (error) {
            if (RAIN_SKIP.has(error?.code)) continue;
            if (isRefusal(error)) { stoppedBy = error; break; }
            throw error;
          }
        }
        if (!paid.length && !stoppedBy && candidates.length < count) {
          throw errors.RAIN_NOT_ENOUGH_PLAYERS({ wanted: count, found: candidates.length });
        }

        logger?.info(
          { from: String(context.userId), currency, each: money.toDecimalString(each), paid: paid.length, wanted: count },
          'Rain sent'
        );

        if (!paid.length) throw stoppedBy ?? errors.RAIN_NOT_ENOUGH_PLAYERS({ wanted: count, found: 0 });

        return ok({
          players: paid.length,
          // Named so a partial rain cannot be read as a complete one.
          requested: count,
          each: money.toDecimalString(each),
          currency,
          recipients: paid,
        });
      } catch (error) {
        if (isRefusal(error)) return refuse(error);
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
      // The same payload the wallet pushes after every movement.
      return creditPayload(await wallet.getBalances(String(context.userId)));
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
