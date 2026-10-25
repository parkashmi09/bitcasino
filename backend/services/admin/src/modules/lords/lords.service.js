'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { money, withdrawBlock } = require('@ibitplay/common');
const { hashPassword, canActOn, effectiveStaffLevel, STAFF_LEVELS } = require('@ibitplay/auth');

const errors = require('./lords.errors');
const { ACCOUNT_TYPE, PASSWORD_ROUNDS } = require('./lords.constants');
const { manageableStaffIds, verifyTransactionPassword } = require('../staff-directory/staffDirectory.service');
const { directSources } = require('../locks/lockSources');
const { cascadeSuspension } = require('../locks/suspendCascade');
const {
  assertTransactionPassword,
  hasTransactionPassword,
  errors: txnErrors,
} = require('../staff-auth/transactionPassword');
const {
  debitStaffFloat,
  creditStaffFloat,
  readStaffFloat,
  insufficientStaffBalance,
  insufficientPlayerBalance,
} = require('./staffFloat');
const { TRANSFER_TYPE } = require('./lords.constants');
const { addPointEntry, POINT_EVENT } = require('./pointLedger');
const {
  isOwnerStaff,
  isDirectUser,
  readOwnerDirectBalance,
  debitOwnerDirectBalance,
  creditOwnerDirectBalance,
  insufficientDirectBalance,
  LEDGER_TYPE,
} = require('./ownerWallet');

/** The only currency a staff float holds (`credits.inr` on the staff row). */
const FLOAT_CURRENCY = 'INR';

/** A NUMERIC that arrived as a string, as a plain number. Missing reads as 0. */
const num = (value) => Number(value ?? 0) || 0;

/**
 * A stored balance as a number, quantised to the platform scale first.
 *
 * `fromStored` rather than `toMinor`: real `credits` rows carry twenty decimal
 * places, and rejecting one of them would 400 the whole page.
 */
const stored = (value) => Number(money.fromStored(value ?? '0', { field: 'balance' }));

/* ── SIGN CONVENTION — read this before touching any P&L number ──────────────
 *
 * `users.gt` and `users.casino_gt` are accumulated from the bet ledgers, so
 * they are from the PLAYER's point of view: positive means the player is up.
 *
 * The panel shows the opposite — an agent looking at its downline wants ITS
 * profit, and a player winning is money the house paid out. So every P&L figure
 * leaving here is NEGATED, and named `sports_pnl` / `casino_pnl` rather than
 * `gt` / `casino_gt`: a key matching a column name while carrying the opposite
 * sign is a trap for whoever reads it next.
 * ────────────────────────────────────────────────────────────────────────── */
const housePnl = (playerPnl) => -num(playerPnl);

/**
 * Operator actions on one account.
 *
 * Every write requires the operator's transaction password — legacy's rule,
 * kept, because it is the one control that separates "somebody stole a
 * session" from "an operator decided this".
 */
class LordsService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Account settings
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /lords/user-setting/update-password
   *
   * Set a password on a staff account or a player beneath the caller.
   *
   *   LEGACY WROTE THE PLAINTEXT ALONGSIDE THE HASH, for both account types:
   *   `UPDATE staff SET password=$1, password2=$2` and the same against
   *   `users`. Only the hash is written here.
   */
  async setPassword({ actor, accountType, accountId, newPassword, transactionPassword }) {
    // Strictly BELOW the caller: your own password is changed through
    // `/admin/staff/password`, which asks for the old one.
    await this.#assertInTree(actor, accountType, accountId, { excludeSelf: 'use My account to change your own password' });
    await this.#assertTransactionPassword(actor, transactionPassword);

    const model = accountType === ACCOUNT_TYPE.STAFF ? this.models.Staff : this.models.Users;
    const [affected] = await model.update(
      {
        password: await hashPassword(newPassword, PASSWORD_ROUNDS),
        // A reset ends the staff account's open sessions, like the other password paths.
        ...(accountType === ACCOUNT_TYPE.STAFF ? { token_version: literal('token_version + 1') } : {}),
      },
      { where: { id: accountId } }
    );
    if (!affected) throw errors.NOT_FOUND({ accountId });

    this.logger?.warn(
      { actorStaffId: actor.id, accountType, accountId },
      'Password set by an operator'
    );
    return { accountType, accountId: Number(accountId), changed: true };
  }

  /**
   * @legacy POST /lords/user-setting/status
   *
   * The lock switches: overall status, betting, sports, casino, system.
   *
   * Legacy took all five in one body and applied whichever were present, which
   * is right — an operator suspending an account usually wants several at once
   * and separate endpoints make that non-atomic.
   */
  async setStatus({ actor, accountType, accountId, transactionPassword, ...flags }) {
    await this.#assertInTree(actor, accountType, accountId);
    if (accountType === ACCOUNT_TYPE.STAFF) {
      if (Number(accountId) === Number(actor.id)) {
        throw errors.CANNOT_ACT_ON_SELF({ reason: 'you cannot change your own locks' });
      }
      // Strictly below the caller, as every other staff write: the agent tree
      // (levels 4–6) now holds `users:lock`, and a subtree may still carry a
      // legacy row at or above the caller's level.
      await this.#assertBelowActor(actor, accountId);
    }
    await this.#assertTransactionPassword(actor, transactionPassword);

    const patch = {};
    if (flags.status !== undefined) patch.status = flags.status;
    if (flags.betStatus !== undefined) patch.bet_status = flags.betStatus;
    if (flags.sportsLocked !== undefined) patch.sports_betlocked = flags.sportsLocked;
    if (flags.casinoLocked !== undefined) patch.casino_locked = flags.casinoLocked;
    if (flags.systemLocked !== undefined) patch.system_locked = flags.systemLocked;

    if (!Object.keys(patch).length) throw errors.NOT_FOUND({ reason: 'nothing to change' });

    const isStaff = accountType === ACCOUNT_TYPE.STAFF;
    const model = isStaff ? this.models.Staff : this.models.Users;
    // A lock set or lifted HERE is a direct one — recorded as such, so a later
    // unlock of the parent agent does not undo it. See `locks/lockSources.js`.
    const sources = directSources(patch);
    await this.db.transaction(async (transaction) => {
      const before = isStaff && patch.status !== undefined
        ? await this.models.Staff.findByPk(accountId, { attributes: ['id', 'status'], transaction, raw: true })
        : null;
      const [affected] = await model.update(
        sources ? { ...patch, lock_sources: sources } : patch,
        { where: { id: accountId }, transaction }
      );
      if (!affected) throw errors.NOT_FOUND({ accountId });

      // Suspending a staff account suspends its downline, as the system lock
      // does; reactivating lifts it. See `locks/suspendCascade.js`.
      const active = (status) => status == null || status === 'active';
      if (before && active(before.status) !== active(patch.status)) {
        await cascadeSuspension(this.models, accountId, !active(patch.status), { transaction, logger: this.logger });
      }
    });

    this.logger?.warn(
      { actorStaffId: actor.id, accountType, accountId, patch },
      'Account locks changed'
    );
    return { accountType, accountId: Number(accountId), ...patch };
  }

  /**
   * @legacy POST /lords/user-setting/exposure-limit
   *
   * How much a player may have at risk across open bets at once.
   */
  async setExposureLimit({ actor, accountType, accountId, exposureLimit, transactionPassword }) {
    // Strictly BELOW the caller — a limit you can raise on yourself is not one.
    await this.#assertInTree(actor, accountType, accountId, { excludeSelf: 'you cannot change your own exposure limit' });
    await this.#assertTransactionPassword(actor, transactionPassword);

    if (accountType === ACCOUNT_TYPE.STAFF) {
      await this.models.StaffCredits.update(
        { exposure_limit: exposureLimit },
        { where: { staff_id: accountId } }
      );
    } else {
      await this.models.Users.update({ exposure_limit: exposureLimit }, { where: { id: accountId } });
    }

    this.logger?.info(
      { actorStaffId: actor.id, accountType, accountId, exposureLimit },
      'Exposure limit changed'
    );
    return { accountType, accountId: Number(accountId), exposureLimit };
  }

  /**
   * @legacy POST /lords/update-current
   *
   * Set an AGENT's credit line — how far below zero their float may go.
   *
   *   staff → `credits.credit_limit` (staff row): the agent's credit line. ENFORCED
   *           on every movement that funds a player from the agent's float
   *           (refill, agent-tree balance credit, a transfer to a player) —
   *           see `staffFloat.js`.
   *   user  → REFUSED (ACCOUNTS_PLAYER_CREDIT_NOT_SUPPORTED). Players never
   *           play on credit: every bet and withdrawal guards at `>= 0` in the
   *           wallet spine and nothing reads `credits.credit_limit` (migration
   *           068 zeroed it). Refused before the transaction-password check —
   *           there is nothing to authorise.
   */
  async setCreditLimit({ actor, accountType = ACCOUNT_TYPE.USER, accountId, creditLimit, transactionPassword }) {
    if (accountType !== ACCOUNT_TYPE.STAFF) throw errors.PLAYER_CREDIT_NOT_SUPPORTED({ accountType, accountId });

    await this.#assertInTree(actor, accountType, accountId, { excludeSelf: 'you cannot set your own credit line' });
    await this.#assertTransactionPassword(actor, transactionPassword);

    const [row, created] = await this.models.StaffCredits.findOrCreate({
      where: { staff_id: accountId },
      defaults: { staff_id: accountId, inr: '0', credit_limit: creditLimit },
    });
    if (!created) await row.update({ credit_limit: creditLimit });

    this.logger?.warn(
      { actorStaffId: actor.id, accountType, accountId, creditLimit },
      'Credit limit changed — this is how far below zero a balance may go'
    );
    return { accountType, accountId: Number(accountId), creditLimit };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Money
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /lords/quick-refill
   * @legacy POST /lords/funds/transfer
   * @legacy POST /funds/transfer
   *
   * Credit a player directly.
   *
   * ─────────────────────────────────────────────────────────────────────
   * WHERE THE MONEY COMES FROM
   *
   * Everyone funds it from their own balance (`credits` row) — the owner too,
   * since migration 099: the owner first puts money into their own wallet
   * (`ownerAddBalance`) and every refill draws it down. A guarded debit that
   * refuses rather than going negative.
   *
   * One exception: the owner refilling a DIRECT user (no parent) — that is paid
   * from the owner's Direct User balance (`staff_balances.inr`), not the
   * owner's `credits` row (`ownerWallet.js`).
   * ─────────────────────────────────────────────────────────────────────
   */
  async refill({ actor, accountId, amount, note, transactionPassword }) {
    await this.#assertMoneyTarget(actor, accountId);
    await this.#assertTransactionPassword(actor, transactionPassword);

    const ceiling = String(this.config.ADMIN_MAX_REFILL ?? '1000000');
    if (money.gt(amount, ceiling)) throw errors.REFILL_TOO_LARGE({ amount, ceiling });

    // Owner aur direct user: owner ke Direct User balance (staff_balances) se katega.
    const ownerToDirectUser = actor.canIssueFunds && (await isDirectUser(this.models, accountId));

    return this.db.transaction(async (transaction) => {
      /**
       * The guarded debit. `inr >= :amount` in the WHERE means Postgres
       * decides under its own row lock and the row count is the answer —
       * legacy read the balance with `FOR UPDATE` inside a transaction shared
       * by every concurrent request, which is a lock whose scope nobody can
       * reason about.
       */
      if (ownerToDirectUser) {
        const debited = await debitOwnerDirectBalance(this.models, actor.id, amount, {
          transaction,
          entry: { type: LEDGER_TYPE.USER_DEPOSIT, userId: accountId, note: note ?? 'Refill' },
        });
        if (!debited) throw insufficientDirectBalance({ amount });
      } else {
        const debited = await debitStaffFloat(this.models, actor.id, amount, { transaction, allowCredit: true });
        if (!debited) throw insufficientStaffBalance({ amount });
      }

      const [credits, created] = await this.models.Credits.findOrCreate({
        where: { uid: accountId },
        defaults: { uid: accountId, inr: amount },
        transaction,
      });
      if (!created) {
        await this.models.Credits.increment(
          { inr: money.toDecimalString(money.toMinor(amount)) },
          { where: { uid: accountId }, transaction }
        );
      }

      const transfer = await this.models.StaffTransfers.create(
        {
          from_type: ACCOUNT_TYPE.STAFF,
          from_id: actor.id,
          to_type: ACCOUNT_TYPE.USER,
          to_id: accountId,
          amount,
          direction: 'deposit',
          // Its own type, so a statement can say "Refill" rather than passing
          // it off as an ordinary transfer. Rows written before this are
          // 'transfer' and still read as one. ('issuance' rows are history:
          // the owner refilled without paying before migration 099.)
          transfer_type: ownerToDirectUser ? TRANSFER_TYPE.DIRECT : TRANSFER_TYPE.REFILL,
          note: note ?? null,
          created_at: new Date(),
        },
        { transaction }
      );

      // Point ledger: parent ne player ko diya.
      await addPointEntry(
        this.models,
        {
          child: { type: ACCOUNT_TYPE.USER, id: accountId },
          parent: { type: ACCOUNT_TYPE.STAFF, id: actor.id },
          amount,
          isDeposit: true,
          transferId: transfer.id,
          eventType: ownerToDirectUser ? POINT_EVENT.BANK_DEPOSIT : undefined,
          remark: note ?? 'Refill',
        },
        { transaction }
      );

      const after = await this.models.Credits.findOne({
        where: { uid: accountId },
        transaction,
        raw: true,
      });

      this.logger?.info(
        { actorStaffId: actor.id, accountId, amount },
        'Wallet refilled'
      );

      return {
        accountId: Number(accountId),
        amount: money.toDecimalString(money.toMinor(amount)),
        balance: money.fromStored(after?.inr ?? '0'),
        currency: 'INR',
        issued: false,
      };
    });
  }

  /**
   * Agent-tree "adjust balance" — `POST /admin/user/wallet/adjust` from an
   * agent-tree session (levels 4–6 and their executives), forwarded here by
   * user-service because the staff float lives in this service's domain.
   *
   * ─────────────────────────────────────────────────────────────────────
   * IT IS A TRANSFER, NOT AN ADJUSTMENT
   *
   * The adjust route credited the player and debited nobody: an agent holding
   * `wallet:credit` could create money for its players without limit, with no
   * transaction password and nothing on either statement. An agent-tree
   * player's money comes ONLY from their agent, so here:
   *
   *   credit — the agent's float pays: guarded debit of the staff `credits.inr`
   *            (down to −credit_limit), credit of the player's INR wallet
   *   debit  — the player's wallet pays (guarded at >= amount), and the agent's
   *            float receives it
   *
   * one transaction, both rows written by guarded/atomic UPDATEs — two
   * concurrent credits cannot both pass the float guard. Recorded as:
   *
   *   staff_transfers  transfer_type 'adjust' — both statements read it
   *   credits_ledger   TRANSFER_IN / TRANSFER_OUT + the idempotency key, so the
   *                    player's wallet still reconciles against its ledger
   *   wallet_history   the row the Wallets screen's history reads
   *
   * The ledger reason is deliberately NOT ADMIN_CREDIT: the player statement
   * reads that reason as a house adjustment, and this movement is already on
   * it through `staff_transfers`.
   *
   * INR only: an agent's float is the staff `credits.inr`, and there is no float
   * in any other currency to draw from.
   *
   * OWNER (migration 099): the owner comes through here too, for INR.
   *   - player has a parent → the owner's wallet pays, exactly like an agent
   *   - DIRECT user (no parent) → the owner's Direct User balance
   *     (`staff_balances.inr`) pays / gets it back, the owner's `credits` row
   *     does NOT; recorded as transfer_type 'direct' and point events
   *     'Bank Deposite' / 'Bank Withdraw' (see `ownerWallet.js`)
   * ─────────────────────────────────────────────────────────────────────
   */
  async adjustPlayer({
    actor, userId, currency, amount, operation, description, idempotencyKey, username, transactionPassword,
  }) {
    // user-service forwards only the staff id; owner hai ya nahi, DB se dekho.
    // (Owner ka executive owner nahi hai — wo sirf apne parent ka kaam karta hai.)
    if (actor.canIssueFunds === undefined) {
      actor = { ...actor, canIssueFunds: !actor.executiveId && (await isOwnerStaff(this.models, actor.id)) };
    }

    // Tree scope FIRST: an account outside the caller's tree is a 404 whatever
    // password came with it, so the password check is never an oracle (or a
    // spent attempt) for a probe at someone else's player.
    await this.#assertMoneyTarget(actor, userId);
    await assertTransactionPassword(this.models, actor.id, transactionPassword, {
      // Everyone, the owner too (user, 2026-10-20).
      required: true,
      executiveId: actor.executiveId ?? null,
    });

    // Owner aur direct user: owner ka Direct User balance (staff_balances) badlega, credits nahi.
    const ownerToDirectUser = actor.canIssueFunds && (await isDirectUser(this.models, userId));

    if (String(currency).toUpperCase() !== FLOAT_CURRENCY) {
      throw errors.FLOAT_CURRENCY_ONLY({ currency, allowed: FLOAT_CURRENCY });
    }

    const minor = money.toMinor(amount);
    const decimal = money.toDecimalString(minor);

    const ceiling = String(this.config.ADMIN_MAX_REFILL ?? '1000000');
    if (money.gt(decimal, ceiling)) throw errors.REFILL_TOO_LARGE({ amount: decimal, ceiling });

    const isCredit = operation === 'credit';

    // A debit is the player's cash-out to their agent: the withdrawal block (migration 091,
    // direct or cascaded from an agent above) refuses it before anything moves.
    if (!isCredit) await withdrawBlock.assertWithdrawAllowed(this.models, { userId });

    return this.db.transaction(async (transaction) => {
      // ── 1. Replay? A double-click or a retried request moves nothing twice.
      if (idempotencyKey) {
        const replay = await this.models.CreditsLedger.findOne({
          where: { idempotency_key: idempotencyKey },
          transaction,
          raw: true,
        });
        if (replay) {
          if (money.abs(replay.amount) !== minor) {
            throw errors.IDEMPOTENCY_CONFLICT({ idempotencyKey });
          }
          return {
            ledgerId: replay.id,
            transferId: replay.meta?.refId ?? null,
            userId: Number(userId),
            currency: FLOAT_CURRENCY,
            amount: decimal,
            direction: operation,
            previousBalance: replay.meta?.previousBalance ?? null,
            newBalance: String(replay.balance ?? '0'),
            staffBalance: await readStaffFloat(this.models, actor.id, { transaction }),
            idempotencyKey,
            replayed: true,
          };
        }
      }

      // ── 2. Lock the player's wallet, so the before/after figures are true.
      const lockWallet = () =>
        this.models.Credits.findOne({
          where: { uid: userId },
          attributes: ['uid', 'inr'],
          lock: transaction.LOCK.UPDATE,
          transaction,
          raw: true,
        });

      let wallet = await lockWallet();
      if (!wallet) {
        if (!isCredit) throw insufficientPlayerBalance({ requested: decimal, available: '0' });
        await this.models.Credits.findOrCreate({ where: { uid: userId }, defaults: { uid: userId }, transaction });
        wallet = await lockWallet();
      }
      const previous = money.toMinorQuantised(wallet.inr ?? '0');

      // ── 3. Move it. Each side is a guarded/atomic UPDATE decided by Postgres.
      //       Owner → direct user: owner ka Direct User balance (staff_balances).
      if (isCredit) {
        if (ownerToDirectUser) {
          const debited = await debitOwnerDirectBalance(this.models, actor.id, decimal, {
            transaction,
            entry: { type: LEDGER_TYPE.USER_DEPOSIT, userId, note: description ?? 'Deposit' },
          });
          if (!debited) {
            throw insufficientDirectBalance({
              requested: decimal,
              available: await readOwnerDirectBalance(this.models, actor.id, { transaction }),
            });
          }
        } else {
          const debited = await debitStaffFloat(this.models, actor.id, decimal, { transaction, allowCredit: true });
          if (!debited) {
            throw insufficientStaffBalance({
              requested: decimal,
              ...(await readStaffFloat(this.models, actor.id, { transaction })),
            });
          }
        }
        await this.models.Credits.increment({ inr: decimal }, { where: { uid: userId }, transaction });
      } else {
        const [affected] = await this.models.Credits.update(
          { inr: literal(`COALESCE(inr, 0) - ${decimal}`) },
          { where: { uid: userId, inr: { [Op.gte]: decimal } }, transaction }
        );
        if (!affected) {
          throw insufficientPlayerBalance({ requested: decimal, available: money.toDecimalString(previous) });
        }
        if (ownerToDirectUser) {
          await creditOwnerDirectBalance(this.models, actor.id, decimal, {
            transaction,
            entry: { type: LEDGER_TYPE.USER_WITHDRAW, userId, note: description ?? 'Withdraw' },
          });
        }
        else await creditStaffFloat(this.models, actor.id, decimal, { transaction });
      }

      const previousBalance = money.toDecimalString(previous);
      const newBalance = money.toDecimalString(isCredit ? previous + minor : previous - minor);

      // ── 4. Record it, on both sides.
      const transfer = await this.models.StaffTransfers.create(
        {
          from_type: isCredit ? ACCOUNT_TYPE.STAFF : ACCOUNT_TYPE.USER,
          from_id: isCredit ? actor.id : userId,
          to_type: isCredit ? ACCOUNT_TYPE.USER : ACCOUNT_TYPE.STAFF,
          to_id: isCredit ? userId : actor.id,
          amount: decimal,
          direction: isCredit ? 'deposit' : 'withdraw',
          transfer_type: ownerToDirectUser ? TRANSFER_TYPE.DIRECT : TRANSFER_TYPE.ADJUST,
          note: description ?? null,
          created_at: new Date(),
        },
        { transaction }
      );

      // Point ledger: parent ne player ko diya (credit) ya player se liya (debit).
      await addPointEntry(
        this.models,
        {
          child: { type: ACCOUNT_TYPE.USER, id: userId },
          parent: { type: ACCOUNT_TYPE.STAFF, id: actor.id },
          amount: decimal,
          isDeposit: isCredit,
          transferId: transfer.id,
          // Direct user ki history alag naam se, taaki pata rahe Direct User balance se gaya.
          eventType: ownerToDirectUser ? (isCredit ? POINT_EVENT.BANK_DEPOSIT : POINT_EVENT.BANK_WITHDRAW) : undefined,
          remark: description || (isCredit ? 'Deposit' : 'Withdraw'),
        },
        { transaction }
      );

      const ledger = await this.models.CreditsLedger.create(
        {
          user_id: String(userId),
          currency: FLOAT_CURRENCY,
          amount: isCredit ? decimal : `-${decimal}`,
          reason: isCredit ? 'TRANSFER_IN' : 'TRANSFER_OUT',
          description: description || (isCredit ? 'Credited by agent' : 'Debited by agent'),
          balance: newBalance,
          closing: newBalance,
          netamount: 0,
          profit: 0,
          loss: 0,
          commission: 0,
          idempotency_key: idempotencyKey ?? null,
          source_service: 'admin-service',
          meta: {
            refType: 'STAFF_TRANSFER',
            refId: String(transfer.id),
            staffId: String(actor.id),
            previousBalance,
          },
        },
        { transaction }
      );

      await this.models.WalletHistory.create(
        {
          uid: userId,
          username: username || String(userId),
          coin: FLOAT_CURRENCY,
          operation: isCredit ? 'credit' : 'debit',
          amount: decimal,
          previous_balance: previousBalance,
          new_balance: newBalance,
          description: description || (isCredit ? 'Credited by agent' : 'Debited by agent'),
          transaction_time: new Date(),
        },
        { transaction }
      );

      const staffBalance = await readStaffFloat(this.models, actor.id, { transaction });
      // Owner ↔ direct user: kaun sa balance badla, wo bhi bata do.
      const directBalance = ownerToDirectUser
        ? await readOwnerDirectBalance(this.models, actor.id, { transaction })
        : undefined;

      this.logger?.info(
        { actorStaffId: actor.id, userId, amount: decimal, operation, transferId: transfer.id },
        'Agent-tree balance adjustment — moved between the agent float and the player'
      );

      return {
        ledgerId: ledger.id,
        transferId: String(transfer.id),
        userId: Number(userId),
        currency: FLOAT_CURRENCY,
        amount: decimal,
        direction: operation,
        previousBalance,
        newBalance,
        staffBalance,
        ...(directBalance !== undefined ? { directBalance } : {}),
        idempotencyKey: idempotencyKey ?? null,
        replayed: false,
      };
    });
  }

  /** The caller's own float, for the money dialogs. */
  async myFloat({ actor }) {
    return { staffId: Number(actor.id), currency: FLOAT_CURRENCY, ...(await readStaffFloat(this.models, actor.id)) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /lords/transfer/statement */
  async transferStatement({ actor, accountType, accountId, from, to, channel, limit = 50, offset = 0 }) {
    const staffIds = await manageableStaffIds(this.models, actor.id, { logger: this.logger, level: actor.level });

    const scope = accountId
      ? { type: accountType ?? ACCOUNT_TYPE.USER, id: await this.#assertInTree(actor, accountType ?? ACCOUNT_TYPE.USER, accountId) }
      : null;

    const where = scope
      ? {
          [Op.or]: [
            { from_type: scope.type, from_id: scope.id },
            { to_type: scope.type, to_id: scope.id },
          ],
        }
      : {
          [Op.or]: [
            { from_type: ACCOUNT_TYPE.STAFF, from_id: staffIds },
            { to_type: ACCOUNT_TYPE.STAFF, to_id: staffIds },
          ],
        };

    // Direct Users | Agent Users tab: direct = jis transfer me ek taraf direct user (koi parent nahi) hai,
    // agent = baaki sab (staff ↔ staff, staff ↔ agent ka player). Na ho = dono (purana).
    const directSide = `((from_type = 'user' AND from_id IN (SELECT id FROM users WHERE parent_staff_id IS NULL))
      OR (to_type = 'user' AND to_id IN (SELECT id FROM users WHERE parent_staff_id IS NULL)))`;
    const channelWhere = channel ? { [Op.and]: [literal(channel === 'direct' ? directSide : `NOT ${directSide}`)] } : {};

    const { rows, count } = await this.models.StaffTransfers.findAndCountAll({
      where: {
        ...where,
        ...channelWhere,
        ...(from || to
          ? { created_at: { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) } }
          : {}),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    // Two batched lookups for the whole page, so the statement reads as
    // "Ms07 → Sriram" rather than "staff #19 → user #3929649457".
    const idsOfType = (type) => [
      ...new Set(
        rows
          .flatMap((r) => [r.from_type === type ? r.from_id : null, r.to_type === type ? r.to_id : null])
          .filter((id) => id != null)
          .map(String)
      ),
    ];

    const [staffRows, userRows] = await Promise.all([
      idsOfType(ACCOUNT_TYPE.STAFF).length
        ? this.models.Staff.findAll({ where: { id: idsOfType(ACCOUNT_TYPE.STAFF) }, attributes: ['id', 'name'], raw: true })
        : [],
      idsOfType(ACCOUNT_TYPE.USER).length
        ? this.models.Users.findAll({ where: { id: idsOfType(ACCOUNT_TYPE.USER) }, attributes: ['id', 'name'], raw: true })
        : [],
    ]);

    const names = {
      [ACCOUNT_TYPE.STAFF]: new Map(staffRows.map((s) => [String(s.id), s.name ?? null])),
      [ACCOUNT_TYPE.USER]: new Map(userRows.map((u) => [String(u.id), u.name ?? null])),
    };
    // A since-deleted counterparty stays `null`; the transfer still happened.
    const nameFor = (type, id) => names[type]?.get(String(id)) ?? null;

    return {
      total: count,
      rows: rows.map((r) => ({
        id: r.id,
        from: { type: r.from_type, id: r.from_id, name: nameFor(r.from_type, r.from_id) },
        to: { type: r.to_type, id: r.to_id, name: nameFor(r.to_type, r.to_id) },
        amount: money.fromStored(r.amount ?? '0'),
        direction: r.direction,
        transferType: r.transfer_type ?? null,
        note: r.note ?? null,
        createdAt: r.created_at ?? null,
      })),
    };
  }

  /**
   * @legacy GET /lords/users/all-details
   *
   * ONE LEVEL of the tree: the caller's direct sub-agents followed by the
   * caller's own players. `parentId` drills into a sub-agent, which is how the
   * panel walks down — so this is a listing of children, NOT of the whole
   * subtree. An earlier version of this port returned every player anywhere
   * below the caller and no agents at all, which is a different question and
   * gave the panel a downline table with no downline in it.
   *
   * Legacy returned the whole row per player — `password` and `password2`
   * included. Only the operational columns are here.
   *
   * The money and P&L figures leave as NUMBERS rather than decimal strings,
   * because that is the contract the admin panel's `Agent` row is typed
   * against. See the sign note on `#rollupPnl` before touching a P&L field.
   */
  async allDetails({ actor, search, limit = 50, offset = 0, parentId }) {
    const visible = (await manageableStaffIds(this.models, actor.id, { logger: this.logger, level: actor.level })).map(Number);
    const rootId = parentId != null ? Number(parentId) : Number(actor.id);
    if (!visible.includes(rootId)) throw errors.NOT_IN_YOUR_TREE({ accountId: rootId });

    const like = search ? { name: { [Op.iLike]: `%${search}%` } } : {};
    const staffWhere = { parent_id: rootId, ...like };
    const userWhere = { parent_staff_id: rootId, ...like };

    const [staffTotal, userTotal] = await Promise.all([
      this.models.Staff.count({ where: staffWhere }),
      this.models.Users.count({ where: userWhere }),
    ]);

    /**
     * One window over `[...agents, ...players]`.
     *
     * Legacy paged the two halves independently — agents got the real offset,
     * players were always fetched at offset 0 — so every page after the first
     * repeated the same players under a different set of agents. Slicing the
     * concatenation is the same first page and a correct second one.
     */
    const staffLimit = Math.max(0, Math.min(limit, staffTotal - offset));
    const staffRows = staffLimit
      ? await this.models.Staff.findAll({
          where: staffWhere,
          attributes: [
            'id', 'name', 'status', 'bet_status', 'percentage',
            'sports_betlocked', 'casino_locked', 'system_locked',
          ],
          include: [{ model: this.models.Roles, as: 'role', attributes: ['name'], required: false }],
          order: [['id', 'ASC']],
          limit: staffLimit,
          offset,
          raw: true,
          nest: true,
        })
      : [];

    const userLimit = limit - staffRows.length;
    const userRows = userLimit
      ? await this.models.Users.findAll({
          where: userWhere,
          attributes: [
            'id', 'name', 'status', 'bet_status', 'sports_betlocked',
            'casino_locked', 'system_locked', 'exposure_limit', 'gt', 'casino_gt',
          ],
          order: [['id', 'ASC']],
          limit: userLimit,
          offset: Math.max(0, offset - staffTotal),
          raw: true,
        })
      : [];

    const staffIds = staffRows.map((s) => Number(s.id));
    const userIds = userRows.map((u) => Number(u.id));

    const [balances, credits, downline, subtrees] = await Promise.all([
      this.models.StaffCredits.findAll({ where: { staff_id: staffIds }, raw: true }),
      this.models.Credits.findAll({ where: { uid: userIds }, raw: true }),
      this.#hasDownline(staffIds),
      this.#subtreePlayers(staffIds, visible),
    ]);

    const balanceOf = new Map(balances.map((b) => [String(b.staff_id), b]));
    const creditOf = new Map(credits.map((c) => [String(c.uid), c]));

    // Every player whose exposure this page needs: the listed players, plus
    // each agent's whole subtree. One grouped read rather than one per row.
    const exposure = await this.#exposureByUser([
      ...userIds,
      ...subtrees.players.map((p) => Number(p.id)),
    ]);

    const agents = staffRows.map((s) => {
      const id = Number(s.id);
      const players = subtrees.byStaff.get(id) ?? [];
      const locked = Boolean(s.sports_betlocked);
      return {
        id,
        username: s.name,
        role: s.role?.name ?? null,
        status: s.status,
        bet_status: s.bet_status,
        percentage: num(s.percentage),
        // Legacy reported one column under two names and the panel reads both.
        bet_locked: locked,
        sports_locked: locked,
        casino_locked: Boolean(s.casino_locked),
        system_locked: Boolean(s.system_locked),
        balance: stored(balanceOf.get(String(id))?.inr),
        exp_limit: stored(balanceOf.get(String(id))?.exposure_limit),
        credit_limit: stored(balanceOf.get(String(id))?.credit_limit),
        account_type: ACCOUNT_TYPE.STAFF.toUpperCase(),
        has_downline: downline.has(id),
        exposure: players.reduce((sum, p) => sum + (exposure.get(Number(p.id)) ?? 0), 0),
        // An agent has no stored P&L — theirs is always the roll-up over the
        // players beneath them, so it cannot drift from what those players did.
        sports_pnl: housePnl(players.reduce((sum, p) => sum + num(p.gt), 0)),
        casino_pnl: housePnl(players.reduce((sum, p) => sum + num(p.casino_gt), 0)),
      };
    });

    const players = userRows.map((u) => {
      const id = Number(u.id);
      const locked = Boolean(u.sports_betlocked);
      return {
        id,
        username: u.name,
        role: 'User',
        status: u.status,
        bet_status: u.bet_status,
        percentage: 0,
        bet_locked: locked,
        sports_locked: locked,
        casino_locked: Boolean(u.casino_locked),
        system_locked: Boolean(u.system_locked),
        balance: stored(creditOf.get(String(id))?.inr),
        exp_limit: stored(u.exposure_limit),
        // Players never play on credit (migration 068) — always 0.
        credit_limit: 0,
        account_type: ACCOUNT_TYPE.USER.toUpperCase(),
        has_downline: false,
        exposure: exposure.get(id) ?? 0,
        sports_pnl: housePnl(u.gt),
        casino_pnl: housePnl(u.casino_gt),
      };
    });

    return { total: staffTotal + userTotal, rows: [...agents, ...players] };
  }

  /**
   * @legacy GET /lords/net-exposure/sports
   *
   * The platform's sports exposure, from the operator's side.
   *
   * sports-service owns `user_exposures` and computes this correctly — summing
   * each player's WORST outcome per match rather than adding their winning
   * legs to their losing ones. This proxies rather than reimplementing, because
   * a second implementation of that arithmetic is a second chance to get the
   * sign wrong.
   */
  async netExposure({ actor, clients }) {
    const result = await clients.sports.get('/internal/sports/bet-admin/net', {
      query: { staffId: actor.id },
    });
    return result?.data ?? result;
  }

  // ══════════════════════════════════════════════════════════════════════

  /** Which of these agents have anything at all beneath them — an agent or a player. */
  async #hasDownline(staffIds) {
    if (!staffIds.length) return new Set();

    const [agents, players] = await Promise.all([
      this.models.Staff.findAll({
        attributes: ['parent_id'], where: { parent_id: staffIds }, group: ['parent_id'], raw: true,
      }),
      this.models.Users.findAll({
        attributes: ['parent_staff_id'], where: { parent_staff_id: staffIds }, group: ['parent_staff_id'], raw: true,
      }),
    ]);

    return new Set([
      ...agents.map((r) => Number(r.parent_id)),
      ...players.map((r) => Number(r.parent_staff_id)),
    ]);
  }

  /**
   * Every player under each of these agents, keyed by agent.
   *
   * The subtrees are walked IN MEMORY off one `parent_id` read over the
   * caller's visible staff, so a page of 25 agents costs two queries rather
   * than a hierarchy walk each. `visible` already bounds it to the caller's
   * tree, so nothing outside it can be reached from here.
   */
  async #subtreePlayers(staffIds, visible) {
    if (!staffIds.length) return { byStaff: new Map(), players: [] };

    const edges = await this.models.Staff.findAll({
      where: { id: visible },
      attributes: ['id', 'parent_id'],
      raw: true,
    });

    const childrenOf = new Map();
    for (const { id, parent_id: parentId } of edges) {
      if (parentId == null) continue;
      const list = childrenOf.get(Number(parentId)) ?? [];
      list.push(Number(id));
      childrenOf.set(Number(parentId), list);
    }

    // The agent itself is part of its own subtree — its direct players count
    // towards its roll-up, not only its sub-agents'.
    const subtreeOf = new Map();
    for (const root of staffIds) {
      const seen = new Set([root]);
      const queue = [root];
      while (queue.length) {
        for (const child of childrenOf.get(queue.pop()) ?? []) {
          if (seen.has(child)) continue;
          seen.add(child);
          queue.push(child);
        }
      }
      subtreeOf.set(root, seen);
    }

    const owners = [...new Set([...subtreeOf.values()].flatMap((s) => [...s]))];
    const players = await this.models.Users.findAll({
      where: { parent_staff_id: owners },
      attributes: ['id', 'parent_staff_id', 'gt', 'casino_gt'],
      raw: true,
    });

    const byStaff = new Map(
      staffIds.map((id) => [
        id,
        players.filter((p) => subtreeOf.get(id).has(Number(p.parent_staff_id))),
      ])
    );
    return { byStaff, players };
  }

  /** Open exposure per player, as the absolute amount at risk across their bets. */
  async #exposureByUser(userIds) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return new Map();

    const rows = await this.models.UserExposures.findAll({
      attributes: ['user_id', [fn('SUM', fn('ABS', col('exposure_amount'))), 'total']],
      where: { user_id: ids },
      group: ['user_id'],
      raw: true,
    });
    return new Map(rows.map((r) => [Number(r.user_id), num(r.total)]));
  }

  /**
   * The operator's second factor.
   *
   * admin-service owns `staff`, so this reads it directly rather than over the
   * internal API — the same helper `staff-directory` exposes to other services.
   */
  async #assertTransactionPassword(actor, transactionPassword) {
    // No transaction password on the account at all: say so (the same
    // TXN_PASSWORD_NOT_SET wallet adjust and agent money moves return), rather
    // than "not valid" for a password the operator could never have typed.
    if (!(await hasTransactionPassword(this.models, actor.id))) throw txnErrors.NOT_SET();
    if (!transactionPassword) throw errors.TRANSACTION_PASSWORD_REQUIRED();
    const ok = await verifyTransactionPassword(this.models, actor.id, transactionPassword, {
      executiveId: actor.executiveId ?? null,
    });
    if (!ok) throw errors.TRANSACTION_PASSWORD_REQUIRED({ reason: 'not valid' });
  }

  /**
   * Money moves with a player are its DIRECT PARENT's only
   * (`users.parent_staff_id` = the caller) — the addaplay rule, the player
   * twin of `StaffService#assertDirectChildStaff`. A master crediting its
   * agent's player skipped the agent's ledger. The platform owner
   * (`canIssueFunds`) is exempt and reaches any player in scope.
   *
   * Anything else reads as not found (404 NOT_IN_YOUR_TREE), checked BEFORE
   * the transaction password like every other scope check here.
   */
  async #assertMoneyTarget(actor, userId) {
    if (actor.canIssueFunds) {
      // Owner: apne tree ka koi bhi player, ya DIRECT user (jiska koi parent nahi).
      if (await isDirectUser(this.models, userId)) return Number(userId);
      return this.#assertInTree(actor, ACCOUNT_TYPE.USER, userId);
    }

    const player = await this.models.Users.findOne({
      where: { id: userId, parent_staff_id: actor.id },
      attributes: ['id'],
      raw: true,
    });
    if (!player) throw errors.NOT_IN_YOUR_TREE({ accountId: userId, reason: 'not your direct player' });
    return Number(player.id);
  }

  /** A staff target strictly below the caller's own level; an unknown level only for the Super Admin. */
  async #assertBelowActor(actor, staffId) {
    const level = Number(effectiveStaffLevel(actor));
    const row = await this.models.Staff.findByPk(staffId, {
      attributes: ['id'],
      include: [{ model: this.models.Roles, as: 'role', attributes: ['level'], required: false }],
      raw: true,
      nest: true,
    });
    const target = row?.role?.level == null ? NaN : Number(row.role.level);
    if (!Number.isFinite(target)) {
      if (level === STAFF_LEVELS.SUPER_ADMIN) return;
      throw errors.NOT_IN_YOUR_TREE({ accountId: staffId, reason: 'that account has no known level' });
    }
    if (!canActOn(level, target)) {
      throw errors.NOT_IN_YOUR_TREE({ accountId: staffId, reason: 'you can only act on accounts below your own level' });
    }
  }

  /**
   * The target must be the caller's own account, a descendant, or their player.
   *
   * Every method runs this BEFORE the transaction password: out-of-tree is 404
   * NOT_IN_YOUR_TREE with a right, wrong or missing password alike.
   */
  async #assertInTree(actor, accountType, accountId, { excludeSelf = null } = {}) {
    const staffIds = (await manageableStaffIds(this.models, actor.id, { logger: this.logger, level: actor.level })).map(Number);

    if (accountType === ACCOUNT_TYPE.STAFF) {
      // `manageableStaffIds` includes the caller. Settings that would let an
      // account raise its own limits or reset its own password pass a reason
      // here and act only on accounts strictly below.
      if (excludeSelf && Number(accountId) === Number(actor.id)) {
        throw errors.CANNOT_ACT_ON_SELF({ reason: excludeSelf });
      }
      if (!staffIds.includes(Number(accountId))) throw errors.NOT_IN_YOUR_TREE({ accountId });
      return Number(accountId);
    }

    const player = await this.models.Users.findOne({
      where: { id: accountId, parent_staff_id: staffIds },
      attributes: ['id'],
      raw: true,
    });
    if (!player) throw errors.NOT_IN_YOUR_TREE({ accountId });
    return Number(player.id);
  }
}

module.exports = { LordsService };
