'use strict';

const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const { WalletService } = require('../wallet/wallet.service');
const errors = require('./rakeback.errors');
const { ACCRUED_COLUMN, RAKEBACK_CURRENCY, MIN_CLAIM, REASON } = require('./rakeback.constants');

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
    const { models, db, logger, config } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.wallet = deps.wallet ?? new WalletService(deps);
  }

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

    return {
      amount: accrued,
      currency: RAKEBACK_CURRENCY,
      claimable: money.gte(accrued, MIN_CLAIM),
      minimum: MIN_CLAIM,
      /** The player's rate. A different column, and read-only here. */
      rate: user.rakeback === null || user.rakeback === undefined ? null : String(user.rakeback),
    };
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

      const movement = await this.wallet.credit(
        {
          userId,
          currency: RAKEBACK_CURRENCY,
          amount: accrued,
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
          rakebonus: money.toDecimalString(money.add(money.toMinor(bonusRow.rakebonus ?? '0'), money.toMinor(accrued))),
          totalbonus: money.toDecimalString(
            money.add(money.toMinor(bonusRow.totalbonus ?? '0'), money.toMinor(accrued))
          ),
        },
        { transaction }
      );

      this.logger?.info(
        { userId: String(userId), amount: accrued, ledgerId: movement.ledgerId },
        'Rakeback claimed'
      );

      return {
        claimed: accrued,
        currency: RAKEBACK_CURRENCY,
        newBalance: movement.newBalance,
        /**
         * Zero by construction — the row was locked, so nothing accrued
         * between the read and the update. Returned explicitly because legacy
         * answered `{ status: "Rakeback claimed successfully." }`, a sentence
         * where the client needed a number.
         */
        remaining: money.toDecimalString(money.toMinor('0')),
      };
    });
  }
}

module.exports = { RakebackService };
