'use strict';

const { Op } = require('sequelize');
const { money, wagerCategory } = require('@ibitplay/common');
const { createRewardFormula } = require('../../lib/rewardFormula');
const { promotionsBlocked } = require('@ibitplay/auth');

const { WalletService } = require('../wallet/wallet.service');
const errors = require('./rakeback.errors');
const { ACCRUED_COLUMN, MIN_CLAIM, REASON } = require('./rakeback.constants');
const { vipRewards } = require('@ibitplay/common');
const { DEFAULT_RAKEBACK_RATE } = vipRewards;
const { createRewardMoney } = require('../../lib/rewardMoney');
const { afterBonus } = require('../notifications/notifyPlayer');

/**
 * Rakeback — a share of the house edge, accrued from wagering and claimed.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE CLAIM WAS FOUR UNRELATED STATEMENTS WITH NOTHING HOLDING THEM TOGETHER
 *
 * `Rule.addRakeback`, in full shape:
 *
 *     SELECT rakeamount FROM users WHERE id = $1              -- 1. read
 *     if (rakebackNum) {
 *       UPDATE credits SET usdt = usdt + $2 WHERE uid = $1    -- 2. pay
 *       UPDATE userbonus SET rakebonus = rakebonus + $2, ...  -- 3. record
 *       UPDATE users SET rakeamount = $2 WHERE id = $1        -- 4. reset to 0
 *     }
 *
 * No transaction, no row lock, nested callbacks. Every failure mode this
 * produces costs money in the same direction:
 *
 *   DOUBLE CLAIM. Two clicks arrive together. Both run statement 1 and read the
 *   same balance — say 50. Both credit 50. Both reset to zero. The player has
 *   100 and the house paid twice. There is nothing between the read and the
 *   write to prevent it: no `FOR UPDATE`, no guarded WHERE, no idempotency key.
 *   The socket event `ADD_RAKEBACK` takes no payload at all, so a client
 *   emitting it in a loop is a straightforward drain.
 *
 *   PARTIAL FAILURE. If statement 3 fails, the player has been paid (2) but
 *   `rakeamount` is never reset (4) — so the same balance is claimable again,
 *   and again. If statement 4 fails, identically. Each is its own round trip
 *   with its own `if (err) reject`, and a rejection after statement 2 leaves
 *   the money moved.
 *
 *   NO LEDGER ROW. `UPDATE credits SET usdt = usdt + $2` and nothing else. The
 *   payment does not appear in the player's statement and there is nothing to
 *   reconcile the balance against.
 *
 * ── HOW IT WORKS HERE ────────────────────────────────────────────────────
 *
 * One transaction, opening with `SELECT … FOR UPDATE` on the player's row. A
 * second claim arriving at the same moment blocks there until the first
 * commits, then reads the accrual as zero and is refused. Postgres decides who
 * wins, rather than two callbacks racing.
 *
 * The zeroing is then written with `WHERE rakeamount >= ?` and its row count
 * checked — a second answer to the same question, so that a future change which
 * drops the lock does not silently reopen the double claim.
 *
 * Everything else happens inside that transaction, so a failure anywhere
 * unwinds the zeroing too: the balance comes back rather than vanishing, which
 * is the failure legacy's four independent statements could not avoid.
 * ═════════════════════════════════════════════════════════════════════════
 */
class RakebackService {
  constructor(deps) {
    const { models, db, logger, config, clients } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.clients = clients;
    this.wallet = deps.wallet ?? new WalletService(deps);
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    this.rewardFormula = deps.rewardFormula ?? createRewardFormula(deps);
  }

  /*
   * ── UNITS ──────────────────────────────────────────────────────────────
   *
   * `users.rakeamount` (and every `rakeback_accruals` row) is in USD: the
   * stake arrives USD-converted and the VIP rate is applied to it. The
   * balance is converted into the site's reward currency only when it is
   * SHOWN or PAID (`rewardMoney.fromUsd`), so an owner changing the reward
   * currency never re-denominates an accrued balance. `MIN_CLAIM` is USD.
   */

  /**
   * What is claimable.
   *
   * @legacy SOCKET 4d0779dab780d8b773e7h6fl9jxd7hm7 (C.RAKEBACK_AMOUNT)
   *
   * Legacy's version had no error branch that called back — on a database
   * error it logged and returned, and the client's spinner never stopped. It
   * also did `res.rows[0].rakeamount` with no check that the row existed.
   */
  async amount({ userId }) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', ACCRUED_COLUMN, 'rakeback'],
      raw: true,
    });

    if (!user) throw errors.USER_NOT_FOUND({ userId: String(userId) });

    const accrued = money.toDecimalString(money.toMinor(user[ACCRUED_COLUMN] ?? '0'));
    const quote = await this.rewardMoney.fromUsd(accrued);

    return {
      amount: quote.amount,
      currency: quote.currency,
      amountUsd: accrued,
      claimable: money.gte(accrued, MIN_CLAIM),
      minimum: MIN_CLAIM,
      /** The player's rate. A different column, and read-only here. */
      rate: user.rakeback === null || user.rakeback === undefined ? null : String(user.rakeback),
    };
  }

  /**
   * Accrue rakeback earned on a stake.
   *
   * @legacy the `UPDATE users SET rakeamount = rakeamount + $1` inside
   *         `jsgamesv2`'s bet callback.
   *
   * ── WHY THIS IS A ROUTE AND NOT A QUERY IN CASINO-SERVICE ────────────
   *
   * `users` belongs to this service, and so does every other operation on this
   * balance — reading it, claiming it, zeroing it under a row lock. A second
   * service writing the same column from its own callback is how the legacy
   * code ended up with an accrual nobody could account for.
   *
   * casino-service computes the figure, because only it knows the stake and
   * the rate. It posts it here, because only this service writes the column.
   *
   * ── EXACTLY ONCE ─────────────────────────────────────────────────────
   *
   * The accrual row goes in FIRST, inside the transaction. If `(source, ref)`
   * has been seen the unique index rejects it, the transaction unwinds, and
   * the total is not touched — so a retried internal call, which
   * `ServiceClient` will make on any 5xx or timeout, adds nothing the second
   * time.
   */
  /**
   * Accrue rakeback earned on a stake.
   *
   * Accepts either a pre-computed `amount` (compat) or a `stakeUsd` whose
   * VIP rate is read from `users.rakeback` (preferred — casino converts the
   * stake to USD, this service owns the loyalty rate).
   */
  async accrue({ userId, amount, stakeUsd, source, ref, kind = null }) {
    /* Rakeback is a promotion: nothing accrues on a B2B site (for anybody) or for an agent-tree
       player (packages/auth/src/agentPlayers.js `promotionsBlocked`, fails closed). A no-op, not
       an error — the stake itself still counts, and a retry must not see a failure. */
    if (await promotionsBlocked(userId)) {
      return { accrued: null, amount: '0.00000000', currency: 'USD', duplicate: false, skipped: 'PROMOTIONS_BLOCKED' };
    }

    let value;

    const formula = amount == null && kind ? await this.rewardFormula() : null;
    if (amount != null) {
      value = money.toDecimalString(money.toMinor(amount));
    } else if (formula?.mode === 'hash') {
      /* hash.game "Instant": Wagered × house edge × 10% — the bet's own house edge (1 − RTP,
         capped at 4%; originals 1%, slots 4%), not a flat per-card rate. */
      const edge = String(kind.house_edge ?? wagerCategory.DEFAULT_HOUSE_EDGE[kind.category] ?? wagerCategory.DEFAULT_HOUSE_EDGE.slots);
      value = money.toDecimalString(money.percentOf(money.toDecimalString(money.multiply(stakeUsd, edge)), formula.instant ?? '10'));
      if (!money.gt(value, '0')) return { accrued: null, amount: '0.00000000', currency: 'USD', duplicate: false, skipped: 'ZERO' };
    } else {
      const user = await this.models.Users.findByPk(userId, {
        attributes: ['id', 'rakeback'],
        raw: true,
      });
      if (!user) throw errors.USER_NOT_FOUND({ userId: String(userId) });

      const rawRate = user.rakeback == null || user.rakeback === '' ? null : String(user.rakeback);
      const rate =
        rawRate && money.gt(rawRate, '0') ? money.toDecimalString(money.toMinor(rawRate)) : DEFAULT_RAKEBACK_RATE;
      value = money.toDecimalString(money.multiply(stakeUsd, rate));
    }

    // A zero or negative accrual is not a thing to record. Rakeback is a share
    // of a stake; there is no such thing as a negative share of one.
    if (!money.gt(value, '0')) throw errors.ACCRUAL_NOT_POSITIVE({ amount: String(amount ?? value) });

    const currency = 'USD';

    try {
      return await this.db.transaction(async (transaction) => {
        const user = await this.models.Users.findByPk(userId, {
          attributes: ['id', ACCRUED_COLUMN],
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!user) throw errors.USER_NOT_FOUND({ userId: String(userId) });

        await this.models.RakebackAccrual.create(
          { user_id: userId, amount: value, currency, source, ref: String(ref) },
          { transaction }
        );

        /**
         * Relative, not absolute.
         *
         * The row is locked above, so an absolute write computed from the read
         * would also be correct — but a relative one stays correct if that lock
         * is ever dropped, and it costs nothing.
         */
        await this.models.Users.increment(ACCRUED_COLUMN, {
          by: value,
          where: { id: userId },
          transaction,
        });

        const accrued = money.toDecimalString(
          money.add(user[ACCRUED_COLUMN] ?? '0', value)
        );

        this.logger?.info({ userId, source, ref, amount: value }, 'Rakeback accrued');
        return { accrued, amount: value, currency, duplicate: false };
      });
    } catch (error) {
      if (error?.name !== 'SequelizeUniqueConstraintError') throw error;

      /**
       * Already accrued. This is a SUCCESS — the caller asked for this stake to
       * be accrued and it has been. Answering with an error would make a
       * retried callback look like a failure and invite another retry.
       */
      this.logger?.info({ userId, source, ref }, 'Duplicate rakeback accrual ignored');
      const current = await this.amount({ userId });
      return { accrued: current.amount, amount: '0.00000000', currency, duplicate: true };
    }
  }

  /**
   * Claim it.
   *
   * @legacy SOCKET k2089ht7ae660578ed9gffgh8hkk7vxj (C.ADD_RAKEBACK)
   */
  async claim({ userId }) {

    return this.db.transaction(async (transaction) => {
      /**
       * THE LOCK.
       *
       * `SELECT … FOR UPDATE` on the player's row. A second claim arriving at
       * the same moment blocks here until this transaction commits, then reads
       * the accrual as zero and is refused by the minimum check below.
       *
       * That is the whole of the double-claim fix. Legacy read this value with
       * a plain SELECT, so both requests saw the same balance and both were
       * paid it.
       */
      const user = await this.models.Users.findByPk(userId, {
        // `name` comes along because `userbonus.name` is NOT NULL and this is
        // the only read of the player in this transaction.
        attributes: ['id', 'name', ACCRUED_COLUMN],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!user) throw errors.USER_NOT_FOUND({ userId: String(userId) });

      const accrued = money.toDecimalString(money.toMinor(user[ACCRUED_COLUMN] ?? '0'));

      /**
       * Legacy's guard was `if (rakebackNum)` — plain truthiness on a parsed
       * number, so 0.00000001 qualified and wrote four rows to pay out a
       * hundred-millionth of a tether.
       */
      if (money.lt(accrued, MIN_CLAIM)) {
        throw errors.NOTHING_TO_CLAIM({ accrued, minimum: MIN_CLAIM });
      }

      /**
       * Zero it, guarded on the value we read.
       *
       * The lock above already makes this safe; the `>=` in the WHERE is the
       * second answer to the same question, so that a future change which drops
       * the lock does not silently reopen the double claim. The row count is
       * checked rather than assumed.
       */
      const [affected] = await this.models.Users.update(
        { [ACCRUED_COLUMN]: '0' },
        {
          where: { id: userId, [ACCRUED_COLUMN]: { [Op.gte]: accrued } },
          transaction,
        }
      );

      if (affected !== 1) {
        // Unreachable while the lock is held, and checked anyway — legacy had
        // no equivalent, and both concurrent requests were paid.
        throw errors.CLAIM_IN_PROGRESS({ userId: String(userId) });
      }

      // Priced now, in the site's reward currency, from the USD balance.
      const { amount: payout, currency } = await this.rewardMoney.fromUsd(accrued);

      const movement = await this.wallet.credit(
        {
          userId,
          currency,
          amount: payout,
          reason: REASON.CLAIM,
          /**
           * A second line of defence behind the guarded UPDATE, and the reason
           * a retried request returns the original movement rather than paying
           * again. Bucketed to the minute because a claim has no id of its own
           * — the accrual it consumed no longer exists to name.
           */
          idempotencyKey: `rakeback:${userId}:${accrued}:${Math.floor(Date.now() / 60_000)}`,
          refType: 'RAKEBACK',
          refId: String(userId),
          description: 'Rakeback claim',
        },
        { sourceService: 'user-service', transaction }
      );

      /**
       * The bonus counters. Legacy's third statement.
       *
       * `UPDATE ... WHERE userid = $1` against a row that may not exist is a
       * no-op — legacy treated that as success, so a player with no `userbonus`
       * row was paid and their totals never moved. Created here if missing.
       */
      const [bonusRow] = await this.models.Userbonus.findOrCreate({
        where: { userid: userId },
        defaults: {
          userid: userId,
          /**
           * `userbonus.name` is NOT NULL and denormalises the player's name.
           * The row we read at the top of this transaction has it — no second
           * query, and no `null` that the model layer would reject.
           */
          name: user.name ?? String(userId),
          /**
           * Every NOT NULL column on this table, and none of them has a
           * database default. Legacy never created the row — its
           * `UPDATE ... WHERE userid = $1` simply matched nothing — so the
           * question of what a fresh row contains never came up there.
           */
          totalbonus: '0',
          rakebonus: '0',
          vipbonus: '0',
          specialbonus: '0',
          generalbonus: '0',
        },
        transaction,
      });

      await bonusRow.update(
        {
          rakebonus: money.toDecimalString(money.add(money.toMinor(bonusRow.rakebonus ?? '0'), money.toMinor(payout))),
          totalbonus: money.toDecimalString(
            money.add(money.toMinor(bonusRow.totalbonus ?? '0'), money.toMinor(payout))
          ),
        },
        { transaction }
      );

      this.logger?.info(
        { userId: String(userId), amount: accrued, ledgerId: movement.ledgerId },
        'Rakeback claimed'
      );

      return {
        claimed: payout,
        claimedUsd: accrued,
        currency,
        newBalance: movement.newBalance,
        /**
         * Zero by construction — the row was locked, so nothing accrued
         * between the read and the update. Returned explicitly because legacy
         * answered `{ status: "Rakeback claimed successfully." }`, a sentence
         * where the client needed a number.
         */
        remaining: money.toDecimalString(money.toMinor('0')),
      };
      // A second claim is refused before it gets here, so the time names this one.
    }).then(afterBonus(userId, (r) => ({ key: `rakeback:claim:${Date.now()}`, title: 'Rakeback claimed', amount: r.claimed, currency: r.currency, link: '/vip' })));
  }
}

module.exports = { RakebackService };
