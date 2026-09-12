'use strict';

const { money } = require('@ibitplay/common');

const errors = require('./wallet.errors');
const { WalletRepository } = require('./wallet.repository');
const { OPERATION, REASON, CREDIT_REASONS, resolveColumn, CURRENCY_COLUMN } = require('./wallet.constants');

/**
 * The money spine.
 *
 * Every balance change on the platform passes through this class. Casino and
 * sports never touch `credits` — they call the internal API, which calls these
 * methods. That is the whole point of the boundary: row locking, ledger writes
 * and idempotency exist in exactly one place, so there is one implementation to
 * get right and one to audit.
 *
 * The four rules, all enforced below rather than by convention:
 *
 *   1. Every movement runs in a real transaction. The balance change, the
 *      ledger row and the history row commit together or not at all.
 *   2. Every movement takes the wallet row lock BEFORE reading a balance.
 *   3. Every debit is guarded at `>= amount` in SQL. A debit that would go
 *      negative writes nothing and returns INSUFFICIENT_FUNDS.
 *   4. Every movement carries an idempotency key. A replay returns the original
 *      ledger row; it does not move money a second time.
 */
class WalletService {
  constructor({ models, db, config, logger, clients }) {
    this.repo = new WalletRepository({ models, db });
    this.db = db;
    this.config = config;
    this.logger = logger;
    // admin-service owns `staff`, so "whose players may this operator see" is
    // asked there rather than answered from a header. See `#visibleStaffIds`.
    this.clients = clients;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /getwallet
   * @legacy GET /sportsbetting/wallet/:uuid
   *
   * The second path was a balance read mounted inside the SPORTS BETTING
   * router, keyed on a `uuid` in the URL with no authentication — so any uuid
   * returned that player's balance.
   */
  async getBalances(userId) {
    const wallet = await this.repo.findWallet(userId);
    if (!wallet) return {};

    const { uid, ...balances } = wallet;
    /**
     * Canonical decimal strings, so a client never sees "0" for one currency
     * and "0.00000000" for another.
     *
     * `fromStored`, not `toMinor` — every column on `credits` is a BARE
     * `numeric`, no declared scale, so Postgres has always accepted whatever
     * arithmetic produced. Seven live rows carry balances like
     * `1534.479999999999986`. `toMinor` refuses those, correctly for a write
     * and fatally for a read: this endpoint 400'd for those accounts, and the
     * header rendered its zero fallback against a wallet with money in it.
     */
    return Object.fromEntries(
      Object.entries(balances).map(([code, value]) => [
        code.toUpperCase(),
        money.fromStored(value ?? '0'),
      ])
    );
  }

  /**
   * @legacy GET /getwallet
   *
   * EVERY PLAYER'S WALLET, one page at a time — the listing behind the
   * operator console's wallet screen.
   *
   * Legacy answered this as `SELECT * FROM credits` on an unauthenticated
   * route: every balance on the platform to anyone who asked, unpaged, and
   * carrying the wallet rows of players the caller had no authority over. Here
   * it is staff-scoped, paged, searchable, and returns the id and name beside
   * the money and nothing else about the player.
   *
   * The rows carry EVERY currency, unlike `getBalances` per row: the screen is
   * a currency-switchable table, and 200 rows of lazily-loaded coins is 200
   * requests to render one column.
   */
  async listBalances({ staffId, search, limit, offset }) {
    const visible = await this.#visibleStaffIds(staffId);

    const { rows, total } = await this.repo.listPlayerWallets({
      parentStaffIds: visible.all ? null : visible.ids,
      search,
      limit,
      offset,
    });

    return {
      rows: rows.map(({ uid, name, wallet }) => ({
        uid,
        name,
        // Every supported currency on every row, so the table can switch
        // currency without a refetch — and a player with no wallet row reads
        // as zeros rather than as gaps.
        balances: Object.fromEntries(
          Object.entries(CURRENCY_COLUMN).map(([code, column]) => [
            code,
            // `fromStored` for the same reason as `getBalances` — see there.
            money.fromStored(wallet?.[column] ?? '0'),
          ])
        ),
      })),
      total,
    };
  }

  /**
   * Whose players this operator may see.
   *
   * Resolved by admin-service, which owns `staff` — the same question the
   * player directory asks, answered the same way. The id comes from a verified
   * token; a caller cannot widen its own scope.
   */
  async #visibleStaffIds(staffId) {
    const { ids } = await this.clients.admin.get(
      `/internal/admin/staff-directory/staff/${staffId}/descendants`
    );

    const root = Number(this.config.ROOT_STAFF_ID ?? 1);
    if (ids.map(Number).includes(root)) return { all: true, ids: [] };

    return { all: false, ids: ids.map(Number) };
  }

  async getBalance(userId, currency) {
    const wallet = await this.repo.findWallet(userId);
    if (!wallet) throw errors.WALLET_NOT_FOUND({ userId });

    const column = resolveColumn(currency);
    return money.fromStored(wallet[column] ?? '0');
  }

  /** @legacy GET /wallethistory/:uid */
  async listHistory(params) {
    return this.repo.listHistory(params);
  }

  async listLedger(params) {
    return this.repo.listLedger(params);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Movements
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Add money to a wallet.
   *
   * Used for payouts, deposits, refunds and operator credits. Cannot fail for
   * lack of funds, but still takes the lock: the ledger records the balance
   * before and after, and those figures are only true if nothing else changed
   * the row between the read and the write.
   */
  async credit(input, context = {}) {
    return this.#move({ ...input, direction: OPERATION.CREDIT }, context);
  }

  /**
   * Remove money from a wallet.
   *
   * Fails with `WALLET_INSUFFICIENT_FUNDS` (402) rather than going negative.
   * The decision is made by Postgres via the guarded UPDATE, not by a
   * JavaScript comparison that a concurrent request could invalidate.
   */
  async debit(input, context = {}) {
    return this.#move({ ...input, direction: OPERATION.DEBIT }, context);
  }

  /**
   * The one implementation both directions share.
   *
   * Keeping them in one method is deliberate: a credit path that drifts from
   * the debit path is how you end up with idempotency on one and not the other.
   */
  async #move(input, context) {
    const {
      userId, currency, amount, reason, idempotencyKey, direction,
      refType, refId, description, matchId, marketType, sportId, eventId, betId,
    } = input;

    if (!idempotencyKey) throw errors.IDEMPOTENCY_KEY_REQUIRED({ userId, reason });
    if (money.lte(amount, '0')) throw errors.NEGATIVE_AMOUNT({ amount });

    const isCredit = direction === OPERATION.CREDIT;

    // An ambient transaction means the caller is composing this movement with
    // its own writes — approving a fiat deposit flips the deposit row AND
    // credits the player, and those two must commit together or not at all.
    // `withTransaction` joins the existing one rather than opening a second,
    // which would let the credit survive a rolled-back approval.
    return this.db.transaction(async (transaction) => {
      // ── 1. Replay? ────────────────────────────────────────────────
      const replay = await this.repo.findByIdempotencyKey(idempotencyKey, transaction);
      if (replay) return this.#describeReplay(replay, { amount, currency, userId });

      // ── 2. Lock the wallet ────────────────────────────────────────
      let locked = await this.repo.lockBalance(userId, currency, transaction);

      if (!locked) {
        // A player with no wallet row can still be credited — their first
        // deposit creates it. A debit against a wallet that does not exist is
        // an insufficient-funds case, not a 404, because that is what it means
        // to the caller.
        if (!isCredit) throw errors.INSUFFICIENT_FUNDS({ userId, currency, requested: amount, available: '0' });
        await this.repo.createWallet(userId, transaction);
        locked = await this.repo.lockBalance(userId, currency, transaction);
      }

      // A stored balance, so `fromStored` — see `getBalances`. `amount` below
      // stays on `toMinor`: that is the CALLER's number, and an over-precise
      // request is a bug worth rejecting.
      const previousBalance = money.fromStored(locked.balance);

      // ── 3. Move the money ─────────────────────────────────────────
      let newBalance;

      if (isCredit) {
        newBalance = await this.repo.credit(userId, currency, amount, transaction);
      } else {
        const result = await this.repo.debit(userId, currency, amount, transaction);
        if (!result.ok) {
          throw errors.INSUFFICIENT_FUNDS({
            userId,
            currency,
            requested: money.toDecimalString(money.toMinor(amount)),
            available: previousBalance,
          });
        }
        newBalance = result.balance;
      }

      newBalance = money.fromStored(newBalance);

      // ── 4. Record it ──────────────────────────────────────────────
      const ledger = await this.#writeRecords(
        {
          userId, currency, amount, reason, idempotencyKey, isCredit,
          previousBalance, newBalance, description,
          refType, refId, matchId, marketType, sportId, eventId, betId,
          sourceService: context.sourceService || null,
          username: context.username || null,
        },
        transaction
      );

      return {
        ledgerId: ledger.id,
        userId,
        currency,
        amount: money.toDecimalString(money.toMinor(amount)),
        direction,
        previousBalance,
        newBalance,
        idempotencyKey,
        replayed: false,
      };
    }, { transaction: context.transaction });
  }

  /** Ledger + history, written inside the caller's transaction. */
  async #writeRecords(entry, transaction) {
    const signedAmount = entry.isCredit
      ? money.toDecimalString(money.toMinor(entry.amount))
      : money.toDecimalString(-money.toMinor(entry.amount));

    const ledger = await this.repo.writeLedger(
      {
        // credits_ledger.user_id is TEXT in the legacy schema.
        user_id: String(entry.userId),
        currency: entry.currency,
        // Signed, so summing the ledger reconciles against the balance.
        amount: signedAmount,
        reason: entry.reason,
        description: entry.description || entry.reason,
        balance: entry.newBalance,
        closing: entry.newBalance,
        idempotency_key: entry.idempotencyKey,
        source_service: entry.sourceService,
        match_id: entry.matchId ?? null,
        market_type: entry.marketType ?? null,
        sport_id: entry.sportId ?? null,
        eventid: entry.eventId ?? null,
        bet_id: entry.betId ?? null,
        meta: {
          ...(entry.refType ? { refType: entry.refType } : {}),
          ...(entry.refId ? { refId: entry.refId } : {}),
          ...(entry.rollbackOf ? { rollbackOf: entry.rollbackOf } : {}),
          previousBalance: entry.previousBalance,
        },
      },
      transaction
    );

    await this.repo.writeHistory(
      {
        uid: entry.userId,
        // `wallet_history.username` is NOT NULL, but an internal caller
        // (casino debiting a stake) has no username to send — and looking one
        // up would add a `users` query to every single bet on the platform.
        // The uid is already an identifying value, so it stands in when the
        // caller has no better label. The admin UI, which does know the name,
        // passes it and gets it.
        username: entry.username || String(entry.userId),
        coin: entry.currency,
        operation: entry.isCredit ? OPERATION.CREDIT : OPERATION.DEBIT,
        amount: money.toDecimalString(money.toMinor(entry.amount)),
        previous_balance: entry.previousBalance,
        new_balance: entry.newBalance,
        description: entry.description || entry.reason,
      },
      transaction
    );

    return ledger;
  }

  /**
   * Shape a replay to look exactly like the original response.
   *
   * The caller retried because it never saw the first answer; giving it a
   * different shape now would make the retry path the odd one out, and that is
   * the path least likely to be tested.
   *
   * A key reused with DIFFERENT parameters is a caller bug, not a retry —
   * silently returning the original would hide a real problem, so it is a 409.
   */
  #describeReplay(replay, attempted) {
    const originalAmount = money.abs(replay.amount);
    const attemptedAmount = money.toMinor(attempted.amount);

    if (originalAmount !== attemptedAmount || replay.currency !== attempted.currency) {
      throw errors.IDEMPOTENCY_CONFLICT({
        idempotencyKey: replay.idempotency_key,
        original: { amount: money.toDecimalString(originalAmount), currency: replay.currency },
        attempted: { amount: money.toDecimalString(attemptedAmount), currency: attempted.currency },
      });
    }

    return {
      ledgerId: replay.id,
      userId: Number(replay.user_id),
      currency: replay.currency,
      amount: money.toDecimalString(originalAmount),
      direction: money.isNegative(replay.amount) ? OPERATION.DEBIT : OPERATION.CREDIT,
      previousBalance: replay.meta?.previousBalance ?? null,
      newBalance: String(replay.balance ?? '0'),
      idempotencyKey: replay.idempotency_key,
      replayed: true,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Compensation
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Undo a previous movement.
   *
   * This is what casino and sports call when a bet was debited but the round
   * failed to write — the stake has already left the wallet, and leaving it
   * there because a later step broke is not an option.
   *
   * A rollback is itself a movement: it gets its own ledger row, its own
   * idempotency key, and it references the entry it reverses. The original row
   * is never deleted, so the statement shows what happened rather than
   * pretending it did not.
   */
  async rollback({ ledgerId, idempotencyKey, reason }, context = {}) {
    if (!idempotencyKey) throw errors.IDEMPOTENCY_KEY_REQUIRED({ ledgerId });

    return this.db.transaction(async (transaction) => {
      const replay = await this.repo.findByIdempotencyKey(idempotencyKey, transaction);
      if (replay) return { ledgerId: replay.id, replayed: true, reversedEntry: ledgerId };

      const original = await this.repo.findLedgerEntry(ledgerId, transaction);
      if (!original) throw errors.LEDGER_ENTRY_NOT_FOUND({ ledgerId });

      const already = await this.repo.findRollbackOf(ledgerId, transaction);
      if (already) throw errors.ALREADY_ROLLED_BACK({ ledgerId, rollbackLedgerId: already.id });

      const userId = Number(original.user_id);
      const currency = original.currency;
      const amount = money.toDecimalString(money.abs(original.amount));
      // Reverse the direction of the original.
      const isCredit = money.isNegative(original.amount);

      const locked = await this.repo.lockBalance(userId, currency, transaction);
      if (!locked) throw errors.WALLET_NOT_FOUND({ userId });

      const previousBalance = money.fromStored(locked.balance);
      let newBalance;

      if (isCredit) {
        newBalance = await this.repo.credit(userId, currency, amount, transaction);
      } else {
        const result = await this.repo.debit(userId, currency, amount, transaction);
        if (!result.ok) {
          // The player has already spent the payout. Forcing the balance
          // negative would create a state nothing else in the platform handles,
          // so this needs a human.
          throw errors.ROLLBACK_WOULD_GO_NEGATIVE({
            userId, currency, required: amount, available: previousBalance, ledgerId,
          });
        }
        newBalance = result.balance;
      }

      newBalance = money.fromStored(newBalance);

      const ledger = await this.#writeRecords(
        {
          userId, currency, amount, isCredit, idempotencyKey,
          reason: isCredit ? REASON.BET_ROLLBACK : REASON.BONUS_REVERSAL,
          description: `${reason} (reverses #${ledgerId})`,
          previousBalance, newBalance,
          rollbackOf: ledgerId,
          sourceService: context.sourceService || null,
        },
        transaction
      );

      return {
        ledgerId: ledger.id,
        reversedEntry: ledgerId,
        userId,
        currency,
        amount,
        previousBalance,
        newBalance,
        replayed: false,
      };
    });
  }

  /**
   * Move money between two wallets in one transaction.
   *
   * Both rows are locked in a deterministic order — lowest user id first.
   * Without that, a transfer A->B running at the same time as B->A grabs the
   * locks in opposite orders and the two deadlock.
   */
  async transfer({ fromUserId, toUserId, currency, amount, idempotencyKey, description }, context = {}) {
    if (fromUserId === toUserId) throw errors.SAME_ACCOUNT_TRANSFER({ userId: fromUserId });
    if (!idempotencyKey) throw errors.IDEMPOTENCY_KEY_REQUIRED({ fromUserId, toUserId });

    return this.db.transaction(async (transaction) => {
      const replay = await this.repo.findByIdempotencyKey(idempotencyKey, transaction);
      if (replay) return { debitLedgerId: replay.id, replayed: true };

      const [first, second] = [fromUserId, toUserId].sort((a, b) => a - b);
      await this.repo.lockBalance(first, currency, transaction);
      await this.repo.lockBalance(second, currency, transaction);

      const fromBefore = await this.repo.lockBalance(fromUserId, currency, transaction);
      if (!fromBefore) throw errors.WALLET_NOT_FOUND({ userId: fromUserId });

      const debitResult = await this.repo.debit(fromUserId, currency, amount, transaction);
      if (!debitResult.ok) {
        throw errors.INSUFFICIENT_FUNDS({
          userId: fromUserId,
          currency,
          requested: amount,
          available: money.fromStored(fromBefore.balance),
        });
      }

      const toBefore = await this.repo.lockBalance(toUserId, currency, transaction);
      if (!toBefore) await this.repo.createWallet(toUserId, transaction);
      const toBalanceBefore = toBefore ? toBefore.balance : '0';

      const toAfter = await this.repo.credit(toUserId, currency, amount, transaction);

      const debitLedger = await this.#writeRecords(
        {
          userId: fromUserId, currency, amount, isCredit: false,
          reason: REASON.TRANSFER_OUT, idempotencyKey,
          description: description || `Transfer to #${toUserId}`,
          previousBalance: money.fromStored(fromBefore.balance),
          newBalance: money.fromStored(debitResult.balance),
          refType: 'TRANSFER', refId: String(toUserId),
          sourceService: context.sourceService || null,
        },
        transaction
      );

      const creditLedger = await this.#writeRecords(
        {
          userId: toUserId, currency, amount, isCredit: true,
          reason: REASON.TRANSFER_IN,
          // The credit leg needs its own key — the unique index would reject a
          // second row carrying the same one.
          idempotencyKey: `${idempotencyKey}:in`,
          description: description || `Transfer from #${fromUserId}`,
          previousBalance: money.fromStored(toBalanceBefore),
          newBalance: money.fromStored(toAfter),
          refType: 'TRANSFER', refId: String(fromUserId),
          sourceService: context.sourceService || null,
        },
        transaction
      );

      return {
        debitLedgerId: debitLedger.id,
        creditLedgerId: creditLedger.id,
        fromUserId,
        toUserId,
        currency,
        amount: money.toDecimalString(money.toMinor(amount)),
        replayed: false,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Operator adjustments
  // ══════════════════════════════════════════════════════════════════════

  /**
   * A staff-initiated balance change.
   *
   * @legacy POST /updatebalance
   * @legacy POST /adminwalletadd
   *
   * The idempotency key is derived rather than caller-supplied: an admin UI
   * double-click is the retry that matters here, and it will not think to send
   * a key. Deriving it from (staff, player, currency, amount, operation, minute)
   * makes a double-click a replay while leaving a deliberate second adjustment a
   * minute later free to go through.
   */
  async adminAdjust({ userId, currency, amount, operation, description }, context = {}) {
    const staffId = context.staffId ?? 'system';
    const minute = Math.floor(Date.now() / 60_000);
    const idempotencyKey = `adm:${staffId}:${userId}:${currency}:${operation}:${amount}:${minute}`;

    const input = {
      userId,
      currency,
      amount,
      idempotencyKey,
      reason: operation === OPERATION.CREDIT ? REASON.ADMIN_CREDIT : REASON.ADMIN_DEBIT,
      description,
      refType: 'STAFF',
      refId: String(staffId),
    };

    return operation === OPERATION.CREDIT
      ? this.credit(input, context)
      : this.debit(input, context);
  }

  /**
   * Compare a wallet against the sum of its own ledger.
   *
   * A mismatch means something changed a balance without recording it — the
   * exact failure this module is built to prevent. Exposed so it can be run as
   * a reconciliation job rather than discovered by a player complaint.
   */
  async reconcile({ userId, currency }) {
    const [balance, ledgerSum] = await Promise.all([
      this.getBalance(userId, currency),
      this.repo.sumLedger({ userId, currency }),
    ]);

    const drift = money.subtract(balance, ledgerSum);

    return {
      userId,
      currency,
      balance,
      ledgerSum: money.toDecimalString(money.toMinor(ledgerSum)),
      drift: money.toDecimalString(drift),
      balanced: drift === 0n,
    };
  }
}

module.exports = { WalletService, CREDIT_REASONS };
