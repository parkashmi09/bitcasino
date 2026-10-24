'use strict';

const { Op, fn, col } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./cryptoWithdraw.errors');
const { STATUS, TRANSITIONS, REFUNDING_STATUSES } = require('./cryptoWithdraw.constants');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');

/**
 * The crypto withdrawal queue.
 *
 * The money is already gone from the player's balance by the time a row exists
 * here — `legacy/Users/Rule.js` inserts the request and then calls
 * `reduceBalance`. So every state this service can move a row into is a
 * decision about money that has already moved, and exactly one of them has to
 * give it back.
 */
class CryptoWithdrawService {
  constructor(deps) {
    const { models, db, logger, config } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.wallet = new WalletService(deps);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /getWithdrawDataUser
   *
   * One player's withdrawals.
   *
   * Legacy took the player from `?uid=` on an unauthenticated route, so anyone
   * could read anyone's withdrawal history — amounts and destination wallet
   * addresses included. The player is the authenticated caller on the user
   * router; on the admin router it is a path parameter behind a permission.
   */
  async listForUser({ userId, status, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Withdrawals.findAndCountAll({
      where: { uid: userId, ...(status ? { status } : {}) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#present(r)) };
  }

  /**
   * @legacy GET /getWithdrawData
   * @legacy GET /withdrawals
   *
   * The whole queue, for staff.
   *
   * ─────────────────────────────────────────────────────────────────────
   * BOTH LEGACY VERSIONS WERE UNAUTHENTICATED, AND `/withdrawals` WAS
   * `SELECT * FROM withdrawals`
   *
   * No filter, no paging, no permission. Every withdrawal on the platform —
   * player id, amount, coin, and the destination wallet address of each one —
   * to anyone who could reach the port. The wallet addresses are the part that
   * does not expire: they are on a public chain, so that response links every
   * player on this platform to their on-chain activity, permanently.
   *
   * `/withdrawals` then called `convertToUSDT` once PER ROW — an await each,
   * inside a `Promise.all` over the whole table. On a table of any size that is
   * a rate lookup per withdrawal on every request.
   *
   * The conversion is not done here at all. A USDT equivalent computed at read
   * time is a different number every time the endpoint is called, so it cannot
   * be reconciled against anything and does not belong on a payment record.
   * The amount and the coin are returned; `modules/exchange-rate` converts, and
   * a caller that wants a total in one currency asks it once.
   * ─────────────────────────────────────────────────────────────────────
   */
  async listAll({ status, userId, coin, from, to, limit = 50, offset = 0 }) {
    const where = {
      ...(status ? { status } : {}),
      ...(userId ? { uid: userId } : {}),
      ...(coin ? { coin } : {}),
      ...(from || to
        ? { date: { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) } }
        : {}),
    };

    const { rows, count } = await this.models.Withdrawals.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.uid));

    return {
      total: count,
      rows: rows.map((r) => ({
        ...this.#present(r, { forStaff: true }),
        username: names.get(String(r.uid)) ?? null,
      })),
    };
  }

  /**
   * @legacy GET /api/withdrawNew
   *
   * A player's own withdrawals, optionally today's only.
   *
   * Legacy's version restricted with `DATE(date) = CURRENT_DATE`, which casts
   * every row before comparing and so cannot use an index on `date`. A
   * half-open range on the raw column can.
   */
  async listMine({ userId, filter, limit = 50, offset = 0 }) {
    return this.listForUser({
      userId,
      limit,
      offset,
      ...(filter === 'today' ? { from: this.#startOfToday() } : {}),
    });
  }

  /** Totals per status, for the queue header. */
  async summary({ userId }) {
    const rows = await this.models.Withdrawals.findAll({
      attributes: ['status', 'coin', [fn('COUNT', col('id')), 'count'], [fn('SUM', col('amount')), 'total']],
      where: userId ? { uid: userId } : {},
      group: ['status', 'coin'],
      raw: true,
    });

    return rows.map((r) => ({
      status: r.status,
      coin: r.coin,
      count: Number(r.count),
      total: money.toDecimalString(money.toMinor(r.total ?? '0')),
    }));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The decision
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /updateWithdrawStatus
   *
   * Move a withdrawal through the queue, refunding if it is refused.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE LEGACY HANDLER WAS ONE STATEMENT
   *
   *     UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *
   *
   * with `id` and `status` from the body, on an unauthenticated route. Four
   * things follow from that, and all four are fixed here:
   *
   *   REJECTING DID NOT REFUND. The balance was debited when the player asked.
   *   Setting the status to 'rejected' returned nothing — the money simply
   *   stayed gone, with no ledger row anywhere recording that it had.
   *
   *   `status` WAS A FREE STRING. Anything at all could be written. The alert
   *   classifier underneath matched a fixed list, so a near-miss like
   *   'complete' stored fine, fired no alert, and read as settled.
   *
   *   THERE WAS NO STATE MACHINE. A withdrawal already sent could be set back
   *   to pending and approved again — and approval is the instruction to send
   *   coin, so that is a second payout of one request.
   *
   *   THE UPDATE WAS UNCONDITIONAL. Two staff acting at once both succeeded.
   *   The row is locked here and the transition is checked under that lock.
   * ─────────────────────────────────────────────────────────────────────
   */
  async decide({ withdrawalId, status, txid, comment }, staff) {
    return this.db.transaction(async (transaction) => {
      const row = await this.models.Withdrawals.findOne({
        where: { id: withdrawalId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!row) throw errors.NOT_FOUND({ withdrawalId });

      const current = row.status ?? STATUS.IN_QUEUE;
      const allowed = TRANSITIONS[current];

      // A status the machine has never heard of — an existing row written by
      // legacy's free-string update. Say so rather than guessing.
      if (!allowed) {
        throw errors.INVALID_TRANSITION({
          withdrawalId,
          from: current,
          to: status,
          reason: 'the current status is not one this queue recognises',
        });
      }
      if (!allowed.length) throw errors.TERMINAL({ withdrawalId, status: current });
      if (!allowed.includes(status)) {
        throw errors.INVALID_TRANSITION({ withdrawalId, from: current, to: status, allowed });
      }

      let refund = null;
      if (REFUNDING_STATUSES.includes(status)) {
        refund = await this.wallet.credit(
          {
            userId: row.uid,
            currency: row.coin,
            amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
            reason: REASON.WITHDRAWAL_REVERSAL,
            /**
             * Keyed on the withdrawal, so a retried rejection refunds once.
             * The state machine above would normally stop a second attempt —
             * this is the guard that holds if it is ever loosened.
             */
            idempotencyKey: `crypto-withdraw-refund:${withdrawalId}`,
            refType: 'CRYPTO_WITHDRAWAL',
            refId: String(withdrawalId),
            description: `Withdrawal #${withdrawalId} rejected — funds returned`,
          },
          { sourceService: 'user-service', transaction }
        );
      }

      await row.update(
        {
          status,
          // The on-chain hash, once it exists. Legacy had nowhere to put it —
          // migration 022 adds the column, and the note there explains the
          // variable named `txid` that holds the string "In Queue".
          ...(txid ? { txid } : {}),
          ...(comment ? { note: comment } : {}),
          decided_by: staff?.id ?? null,
          decided_at: new Date(),
        },
        { transaction }
      );

      this.logger?.info(
        {
          withdrawalId,
          from: current,
          to: status,
          // The real staff id, from a verified token. Legacy read
          // `x-staff-id` off the request headers, so the audit trail recorded
          // whoever the caller said they were.
          staffId: staff?.id ?? null,
          refundLedgerId: refund?.ledgerId ?? null,
        },
        'Crypto withdrawal status changed'
      );

      return {
        withdrawalId,
        from: current,
        status,
        comment: comment ?? null,
        txid: txid ?? null,
        refunded: Boolean(refund),
        newBalance: refund?.newBalance ?? null,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════

  async #namesFor(ids) {
    if (!ids.length) return new Map();
    const rows = await this.models.Users.findAll({
      where: { id: { [Op.in]: [...new Set(ids)] } },
      attributes: ['id', 'name'],
      raw: true,
    });
    return new Map(rows.map((u) => [String(u.id), u.name]));
  }

  #startOfToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }

  /**
   * What a withdrawal looks like on the way out.
   *
   * The destination wallet address is truncated for the player's own view and
   * shown in full only to staff. It is enough to confirm "yes, that is the
   * address I gave" without the response being a convenient place to harvest
   * addresses from if it is ever logged or cached.
   */
  #present(row, { forStaff = false } = {}) {
    return {
      id: row.id,
      userId: row.uid,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      coin: row.coin,
      chain: row.chain ?? null,
      wallet: forStaff ? row.wallet : this.#maskWallet(row.wallet),
      status: row.status,
      txid: row.txid ?? null,
      date: row.date,
      ...(forStaff
        ? { decidedBy: row.decided_by ?? null, decidedAt: row.decided_at ?? null, note: row.note ?? null }
        : {}),
    };
  }

  #maskWallet(wallet) {
    const value = String(wallet ?? '');
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
}

module.exports = { CryptoWithdrawService };
