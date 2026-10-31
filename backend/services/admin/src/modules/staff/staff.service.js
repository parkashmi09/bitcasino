'use strict';

const { randomInt } = require('crypto');
const { Op, QueryTypes, literal } = require('sequelize');
const {
  hashPassword,
  verifyPassword,
  canActOn,
  canCreateLevel,
  isLoginPasswordMode,
  STAFF_LEVELS,
} = require('@ibitplay/auth');
const { money, withdrawBlock } = require('@ibitplay/common');

const errors = require('./staff.errors');
const { TRANSFER_DIRECTION, TARGET_TYPE, BALANCE_CURRENCY, PASSWORD_ROUNDS } = require('./staff.constants');
const { manageableStaffIds } = require('../staff-directory/staffDirectory.service');
const { debitStaffFloat, insufficientStaffBalance, insufficientFunds } = require('../lords/staffFloat');
const { addPointEntry, SPENDABLE_SQL } = require('../lords/pointLedger');
const { assertTransactionPassword } = require('../staff-auth/transactionPassword');

/**
 * Staff accounts, the players beneath them, and transfers down the tree.
 *
 * The hierarchy is a closure table (`staff_hierarchy`), so "everyone under me"
 * is one indexed read rather than a recursive query per request — legacy got
 * that part right and it is kept.
 */
class StaffService {
  constructor({ models, db, logger, config, clients }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.clients = clients;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /api/staff/:id */
  async getById({ actor, staffId }) {
    await this.#assertVisible(actor, staffId);

    const row = await this.models.Staff.findByPk(staffId, {
      attributes: [
        'id', 'name', 'email', 'phone', 'country', 'parent_id', 'role_id', 'status', 'percentage',
        'system_locked', 'casino_locked', 'sports_betlocked', 'withdraw_locked', 'originals_locked',
      ],
      raw: true,
    });
    if (!row) throw errors.NOT_FOUND({ staffId });

    const balance = await this.models.StaffCredits.findOne({ where: { staff_id: staffId }, raw: true });
    return {
      ...this.#shapeStaff(row),
      balance: this.#shapeBalance(balance),
      // The lock columns `POST /admin/locks` sets, so the detail screen shows the current state.
      locks: {
        system: Boolean(row.system_locked),
        casino: Boolean(row.casino_locked),
        sports: Boolean(row.sports_betlocked),
        withdraw: Boolean(row.withdraw_locked),
        originals: Boolean(row.originals_locked),
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Money
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/staff/transfer
   *
   * Move INR between an account and someone beneath it.
   *
   * ─────────────────────────────────────────────────────────────────────
   * WHAT THE LEGACY VERSION DID
   *
   *     await pg.query("BEGIN");                    ← on the ONE shared client
   *     const bal = (await pg.query("SELECT inr FROM staff_balances ...")).rows[0]?.inr || 0;
   *     if (amount > bal) return res.status(400)    ← no ROLLBACK, and the read
   *     await transferInr(...)                        was never locked
   *
   * and `transferInr` debits with `SET inr = inr - $1` and no `WHERE inr >= $1`.
   * So: the debit, the credit and the history row were not atomic; the balance
   * check was an unlocked read two concurrent transfers both passed; and the
   * debit itself had no floor, so the account went negative.
   *
   * Here it is one database transaction, the debit is a GUARDED update whose
   * row count decides the outcome, and the history row is written inside it.
   * ─────────────────────────────────────────────────────────────────────
   */
  async transfer({ actor, toType, toId, amount, direction, transactionPassword, opening = false }, { transaction: outer } = {}) {
    /**
     * Sports Exchange ka EK deposit / withdraw API (TENEXCH `/admin/wallet/deposit/add` aur
     * `/withdraw` jaisa): owner ho ya koi bhi staff, apne DIRECT child — staff ya player — ke saath.
     *
     *   the Super Admin (`canIssueFunds`, holding `wallet:adjust`) — paid from the owner's own wallet.
     *   everyone else, Admin and Sub Admin included — out of its own float, and needs the
     *     `wallet:credit` / `wallet:debit` grant (`#assertParentFunding`).
     *
     * Grandchild / kisi aur ka account: nahi (system tracker ka rule bhi — Credit / Debit
     * hamesha direct parent ke saath). `opening`: Create Account ka opening credit
     * ('User creation' entry). `outer`: Create Account apne transaction me bulata hai.
     */
    const parentFunding = !(actor.canAdjustWallets && actor.canIssueFunds);
    if (parentFunding) this.#assertParentFunding(actor, toType, toId, direction);

    // The second factor: every staff member moving balance gives it, the owner too (user, 2026-10-20).
    await assertTransactionPassword(this.models, actor.id, transactionPassword, {
      required: true,
      executiveId: actor.executiveId ?? null,
    });
    const target = await this.#assertDirectChild(actor, toType, toId, outer);

    // Who pays and who receives. A `withdraw` pulls money UP from the target;
    // a `deposit` pushes it DOWN from the actor.
    const isWithdraw = direction === TRANSFER_DIRECTION.WITHDRAW;
    const source = isWithdraw
      ? { type: toType, id: target }
      : { type: TARGET_TYPE.STAFF, id: actor.id };
    const destination = isWithdraw
      ? { type: TARGET_TYPE.STAFF, id: actor.id }
      : { type: toType, id: target };

    if (source.type === destination.type && String(source.id) === String(destination.id)) {
      throw errors.CANNOT_TRANSFER_TO_SELF();
    }

    // Pulling money UP out of an account is that account's cash-out: the withdrawal block
    // (migration 091) on the paying account refuses it before anything moves.
    if (isWithdraw) {
      await withdrawBlock.assertWithdrawAllowed(
        this.models,
        source.type === TARGET_TYPE.USER ? { userId: source.id } : { staffId: source.id },
        { transaction: outer }
      );
    }

    const run = (fn) => (outer ? fn(outer) : this.db.transaction(fn));
    return run(async (transaction) => {
      // An agent funding a PLAYER may draw on its credit line; a transfer to
      // another staff account never does. See `lords/staffFloat.js`.
      const allowCredit = source.type === TARGET_TYPE.STAFF && destination.type === TARGET_TYPE.USER;
      await this.#debit(source, amount, { actor, transaction, allowCredit });
      await this.#credit(destination, amount, { transaction });

      const row = await this.models.StaffTransfers.create(
        {
          from_type: source.type,
          from_id: source.id,
          to_type: destination.type,
          to_id: destination.id,
          amount,
          direction,
          transfer_type: 'transfer',
          created_at: new Date(),
        },
        { transaction }
      );

      // Point ledger (zip jaisa): child ke wallet me entry — deposit pe +, withdraw pe −.
      await addPointEntry(
        this.models,
        {
          child: { type: toType, id: target },
          parent: { type: TARGET_TYPE.STAFF, id: actor.id },
          amount,
          isDeposit: !isWithdraw,
          transferId: row.id,
          remark: opening ? 'Opening balance' : isWithdraw ? 'Withdraw' : 'Deposit',
          opening,
        },
        { transaction }
      );

      // The PLAYER side of the movement gets its ledger + history rows, as the
      // opening balance and account close already do (players.service): a
      // player wallet changed here without them drifted from its ledger and
      // reconcile reported `balanced: false`.
      if (source.type === TARGET_TYPE.USER || destination.type === TARGET_TYPE.USER) {
        const isCredit = destination.type === TARGET_TYPE.USER;
        await this.#playerLedger(
          { userId: isCredit ? destination.id : source.id, amount, isCredit, transferId: row.id, actor },
          transaction
        );
      }

      this.logger?.info(
        { actorStaffId: actor.id, from: source, to: destination, amount, direction, transferId: row.id },
        'Staff transfer'
      );

      return this.#shapeTransfer(row.get({ plain: true }));
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Writes
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/staff
   *
   * Create an account BELOW the caller.
   *
   * ── THE HIERARCHY RULE ──────────────────────────────────────────────
   * The new account's level must be strictly below (a higher number than)
   * the caller's own, and strictly below its parent's. The parent is the
   * caller or one of the caller's own descendants — never someone outside
   * that subtree. Without this an Admin could create a Super Admin: the role
   * was taken from the body and never compared with anything.
   */
  async create({ actor, name, email, password, phone, country, roleId, percentage, parentId }, { transaction: outer } = {}) {
    const level = await this.#roleLevel(roleId);
    if (level === null) throw errors.UNKNOWN_ROLE({ roleId });
    this.#assertCreatableLevel(actor, level);

    const parent = parentId == null ? Number(actor.id) : await this.#assertVisible(actor, parentId);
    if (parent !== Number(actor.id)) {
      // The account is created under a descendant: it must sit below THAT
      // account too, or the tree would hold a master beneath an agent.
      const parentLevel = await this.#staffLevel(parent);
      this.#assertLevelBelow(parentLevel, level, 'below the account it reports to');
    }

    const existing = await this.models.Staff.findOne({ where: { email }, raw: true, transaction: outer });
    if (existing) throw errors.NOT_PERMITTED({ reason: 'that email is already in use' });

    const run = (fn) => (outer ? fn(outer) : this.db.transaction(fn));
    return run(async (transaction) => {
      const row = await this.models.Staff.create(
        {
          name,
          email,
          // Hash only. Legacy wrote the plaintext to `password2` beside it.
          password: await hashPassword(password, PASSWORD_ROUNDS),
          phone: phone ?? null,
          country: country ?? null,
          role_id: roleId,
          parent_id: parent,
          percentage: percentage ?? null,
          status: 'active',
          // The creator knows this password: the first sign-in must replace it,
          // and that change issues the transaction password (`changePassword`).
          must_change_password: true,
          first_login: true,
        },
        { transaction }
      );

      /**
       * The closure table.
       *
       * Every ancestor of the parent becomes an ancestor of the new account,
       * one level deeper, plus a self-row at depth 0. Legacy wrote these too;
       * doing it inside the same transaction as the insert is the difference —
       * a failure between the two left an account with no place in the tree,
       * invisible to every scoped query including the one that would find it.
       */
      const ancestors = await this.models.StaffHierarchy.findAll({
        where: { descendant_id: parent },
        attributes: ['ancestor_id', 'depth'],
        transaction,
        raw: true,
      });

      await this.models.StaffHierarchy.bulkCreate(
        [
          { ancestor_id: row.id, descendant_id: row.id, depth: 0 },
          ...ancestors.map((a) => ({
            ancestor_id: a.ancestor_id,
            descendant_id: row.id,
            depth: Number(a.depth) + 1,
          })),
        ],
        { transaction, ignoreDuplicates: true }
      );

      await this.models.StaffCredits.findOrCreate({
        where: { staff_id: row.id },
        defaults: { staff_id: row.id, inr: '0' },
        transaction,
      });

      this.logger?.info({ actorStaffId: actor.id, staffId: row.id, roleId, level, parentId: parent }, 'Staff account created');
      return this.#shapeStaff(row.get({ plain: true }));
    });
  }

  /**
   * @legacy PATCH /api/staff/password
   *
   * Change a password — your own, or a descendant's if your role allows it.
   *
   *   LEGACY STORED THE PLAINTEXT: `UPDATE staff SET password=$1, password2=$2`.
   *   `password2` is a column, so every staff password ever changed through
   *   that endpoint is readable by anyone with SELECT on the table. Only the
   *   hash is written here.
   */
  async changePassword({ actor, targetId, oldPassword, newPassword, transactionPassword: chosenTransactionPassword }) {
    const self = !targetId || Number(targetId) === Number(actor.id);
    const target = self ? actor.id : Number(targetId);
    let transactionPassword = null;

    if (!self) {
      // A session still on a password somebody else chose may only change its own.
      if (actor.mustChangePassword) throw errors.PASSWORD_CHANGE_REQUIRED();
      await this.#assertAuthorityOver(actor, target);
      // Legacy gated this on `req.staff.level !== 0` — a hardcoded level check
      // in the controller. It is a permission on the route here.
      if (!actor.canResetOthers) throw errors.NOT_PERMITTED({ reason: 'you may not reset another account' });
    } else {
      const row = await this.models.Staff.findByPk(target, {
        attributes: ['password', 'must_change_password'],
        raw: true,
      });
      if (!row) throw errors.NOT_FOUND({ staffId: target });
      // rainbet: an executive never changes its parent's password; below the Super Admin only the
      // forced change is open.
      if (actor.executiveId || (Number(actor.level) !== STAFF_LEVELS.SUPER_ADMIN && !row.must_change_password)) {
        throw errors.OWN_PASSWORD_LOCKED();
      }
      if (!(await verifyPassword(oldPassword ?? '', row.password ?? ''))) {
        throw errors.OLD_PASSWORD_WRONG();
      }
      // A forced change — first sign-in, or the next one after a superior's reset (TENEXCH flow) —
      // issues a fresh 6-digit transaction password, returned once; the old one stops working.
      // Never to an executive: it acts for this account but does not own its secrets.
      // A whitelabel company chooses its own instead of being issued one.
      if (row.must_change_password && !actor.executiveId && !isLoginPasswordMode()) {
        // rainbet: only a Super Admin (a whitelabel company) may choose its own; everyone else is issued one.
        const mayChoose = Number(actor.level) === STAFF_LEVELS.SUPER_ADMIN;
        transactionPassword = (mayChoose && chosenTransactionPassword) || String(randomInt(100000, 1000000));
      }
    }

    await this.models.Staff.update(
      {
        password: await hashPassword(newPassword, PASSWORD_ROUNDS),
        // Your own change clears the flag. A reset by someone above you sets
        // it: they know the password now, so you must replace it.
        must_change_password: !self,
        ...(self ? { first_login: false } : {}),
        ...(transactionPassword ? { transaction_password: await hashPassword(transactionPassword, PASSWORD_ROUNDS) } : {}),
        // Ends every session of the target — the caller's own too on a self change — so a
        // token stolen before the change stops working now, not in 8 h.
        token_version: literal('token_version + 1'),
      },
      { where: { id: target } }
    );

    this.logger?.warn({ actorStaffId: actor.id, targetStaffId: target, self, transactionPasswordIssued: Boolean(transactionPassword) }, 'Staff password changed');
    // A chosen one is not echoed back: its owner just typed it.
    const issued = transactionPassword && transactionPassword !== chosenTransactionPassword;
    return { staffId: target, changed: true, ...(issued ? { transactionPassword } : {}), ...(transactionPassword && !issued && chosenTransactionPassword ? { transactionPasswordSet: true } : {}) };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Take money, or refuse.
   *
   * The guarded UPDATE is the whole point: `WHERE inr >= :amount` means
   * Postgres decides, under its own row lock, and the row count tells us what
   * happened. Legacy read the balance, compared it in JavaScript, and then
   * debited unconditionally — so two transfers issued at once both passed the
   * comparison and the account went negative.
   */
  /** credits_ledger TRANSFER_IN/OUT + wallet_history for a player in a staff transfer (INR). */
  async #playerLedger({ userId, amount, isCredit, transferId, actor }, transaction) {
    const moved = money.toMinor(String(amount));
    const wallet = await this.models.Credits.findOne({ where: { uid: userId }, attributes: ['inr'], transaction, raw: true });
    const after = money.fromStored(wallet?.inr ?? '0');
    const previous = money.toDecimalString(money.toMinor(after) + (isCredit ? -moved : moved));
    const player = await this.models.Users.findOne({ where: { id: userId }, attributes: ['name'], transaction, raw: true });
    const description = isCredit ? 'Funded by staff transfer' : 'Withdrawn by staff transfer';

    await this.models.CreditsLedger.create(
      {
        user_id: String(userId),
        currency: 'INR',
        amount: money.toDecimalString(isCredit ? moved : -moved),
        reason: isCredit ? 'TRANSFER_IN' : 'TRANSFER_OUT',
        description,
        balance: after,
        closing: after,
        netamount: 0,
        profit: 0,
        loss: 0,
        commission: 0,
        idempotency_key: null,
        source_service: 'admin-service',
        meta: { refType: 'STAFF_TRANSFER', refId: String(transferId), staffId: String(actor.id), previousBalance: previous },
      },
      { transaction }
    );
    await this.models.WalletHistory.create(
      {
        uid: userId,
        username: player?.name || String(userId),
        coin: 'INR',
        operation: isCredit ? 'credit' : 'debit',
        amount: money.toDecimalString(moved),
        previous_balance: previous,
        new_balance: after,
        description,
        transaction_time: new Date(),
      },
      { transaction }
    );
  }

  async #debit(party, amount, { actor, transaction, allowCredit = false }) {
    // TENEXCH: settlement points (`upper_point + down_point`) aage nahi jaate — staff ka deposit /
    // child staff ka withdraw `inr − settlement points` tak. Agent ka credit line (player ko dena) alag.
    if (party.type === TARGET_TYPE.STAFF && !allowCredit) {
      const [ok] = await this.models.StaffCredits.sequelize.query(
        `SELECT 1 FROM credits WHERE staff_id = :id AND ${SPENDABLE_SQL}`,
        { replacements: { id: party.id, amount: money.toDecimalString(money.toMinor(amount)) }, type: QueryTypes.SELECT, transaction }
      );
      if (!ok) {
        if (Number(party.id) === Number(actor.id)) throw insufficientStaffBalance({ staffId: party.id, amount });
        throw insufficientFunds({ party: party.type, id: party.id, amount });
      }
    }

    /**
     * Owner bhi apne wallet se deta hai (migration 099). Pehle owner yahan se
     * bina kate paisa bana deta tha; ab owner pehle "Add balance" se apne
     * credits me paisa daalta hai, aur har transfer usi se katta hai.
     */
    const [affected] = party.type === TARGET_TYPE.STAFF
      ? [Number(await debitStaffFloat(this.models, party.id, amount, { transaction, allowCredit }))]
      : await this.models.Credits.update(
          { inr: literal(`inr - ${money.toDecimalString(money.toMinor(amount))}`) },
          {
            where: {
              uid: party.id,
              inr: { [Op.gte]: amount },
              // TENEXCH: player sirf `credit` (diya − liya) tak nikal sakta hai; profit settlement se.
              credit: { [Op.gte]: amount },
            },
            transaction,
          }
        );

    if (!affected) {
      // One overdraw error everywhere: 422 INSUFFICIENT_FUNDS (`staffFloat.js`).
      if (party.type === TARGET_TYPE.STAFF && Number(party.id) === Number(actor.id)) {
        throw insufficientStaffBalance({ staffId: party.id, amount });
      }
      throw insufficientFunds({ party: party.type, id: party.id, amount });
    }
  }

  async #credit(party, amount, { transaction }) {
    const model = party.type === TARGET_TYPE.STAFF ? this.models.StaffCredits : this.models.Credits;
    const key = party.type === TARGET_TYPE.STAFF ? 'staff_id' : 'uid';

    const [, created] = await model.findOrCreate({
      where: { [key]: party.id },
      defaults: { [key]: party.id, inr: amount },
      transaction,
    });

    if (!created) {
      await model.increment(
        { inr: money.toDecimalString(money.toMinor(amount)) },
        { where: { [key]: party.id }, transaction }
      );
    }
  }

  /** Self plus every descendant — or every staff tree on the site for a Super Admin. */
  async #visibleStaffIds(actor) {
    return manageableStaffIds(this.models, actor.id, { logger: this.logger, level: actor.level });
  }

  async #assertVisible(actor, staffId) {
    const ids = (await this.#visibleStaffIds(actor)).map(Number);
    if (!ids.includes(Number(staffId))) throw errors.NOT_IN_YOUR_TREE({ staffId });
    return Number(staffId);
  }

  /** In the caller's subtree, and strictly below the caller's level. */
  async #assertAuthorityOver(actor, staffId) {
    const id = await this.#assertVisible(actor, staffId);
    this.#assertCanActOn(actor, await this.#staffLevel(id), id);
    return id;
  }

  /**
   * An account whose level cannot be read (no role row) is treated as acted on
   * only by the Super Admin — failing closed for everyone else.
   */
  #assertCanActOn(actor, targetLevel, staffId) {
    if (targetLevel === null) {
      if (Number(actor.level) === STAFF_LEVELS.SUPER_ADMIN) return;
      throw errors.LEVEL_NOT_BELOW({ staffId, reason: 'that account has no known level' });
    }
    if (!canActOn(Number(actor.level), targetLevel)) {
      throw errors.LEVEL_NOT_BELOW({ staffId, reason: 'you can only act on accounts below your own level' });
    }
  }

  /**
   * TENEXCH's rule (`CHILD_LEVELS` in `@ibitplay/auth`): a creator makes any
   * staff level below its own — a Sub Admin a Super Master, a Master or an
   * Agent; an Agent makes players only.
   *
   * EXECUTIVE (7) is never a staff row made here, by anyone: executives are
   * sub-logins and are made through `/admin/access/executives`.
   */
  #assertCreatableLevel(actor, level) {
    if (Number(level) === STAFF_LEVELS.EXECUTIVE) {
      throw errors.NOT_PERMITTED({ reason: 'executives are created from the executives screen, not as staff' });
    }
    this.#assertLevelBelow(actor.level, level);
    // Below the caller but no staff level at all (an odd role level): fails closed.
    if (!canCreateLevel(actor.level, level)) {
      throw errors.LEVEL_NOT_BELOW({ level, reason: 'not a staff level you can create' });
    }
  }

  /** `level` must be strictly below (a higher number than) `aboveLevel`. */
  #assertLevelBelow(aboveLevel, level, where = 'below your own') {
    if (!canActOn(Number(aboveLevel), Number(level))) {
      throw errors.LEVEL_NOT_BELOW({ level, reason: `the new account's level must be ${where}` });
    }
  }

  async #roleLevel(roleId) {
    if (roleId == null) return null;
    const role = await this.models.Roles.findByPk(roleId, { attributes: ['id', 'level'], raw: true });
    const level = Number(role?.level);
    return role && Number.isFinite(level) ? level : null;
  }

  async #staffLevel(staffId) {
    const row = await this.models.Staff.findByPk(staffId, { attributes: ['id', 'role_id'], raw: true });
    return row ? this.#roleLevel(row.role_id) : null;
  }

  /**
   * The non-`wallet:adjust` path: a parent and its DIRECT CHILD STAFF account.
   *
   * Players keep their own route (`admin/user/wallet/adjust`, forwarded to
   * `lords.adjustPlayer`), so a player target is refused here as before. A
   * deposit needs `wallet:credit`, a withdrawal `wallet:debit` — the same
   * grants the player money dialogs use.
   */
  #assertParentFunding(actor, toType, toId, direction) {
    const isWithdraw = direction === TRANSFER_DIRECTION.WITHDRAW;
    if (isWithdraw ? !actor.canDebit : !actor.canCredit) {
      throw errors.NOT_PERMITTED({ reason: `your role cannot ${isWithdraw ? 'withdraw from' : 'deposit to'} an account` });
    }
    if (Number(toId) === Number(actor.id)) throw errors.CANNOT_TRANSFER_TO_SELF();
  }

  /**
   * One level only — `staff.parent_id` must be the caller. A grandchild is
   * settled by its own parent, so every ledger in the chain stays complete
   * (addaplay's `assertDirectChild`). Anything else reads as not found.
   */
  async #assertDirectChildStaff(actor, toId, transaction) {
    const child = await this.models.Staff.findOne({
      where: { id: toId, parent_id: actor.id },
      attributes: ['id', 'role_id'],
      raw: true,
      transaction,
    });
    if (!child) throw errors.NOT_IN_YOUR_TREE({ staffId: toId });
    this.#assertCanActOn(actor, await this.#roleLevel(child.role_id), child.id);
    return Number(child.id);
  }

  /** Target = caller ka DIRECT child: staff (`parent_id`) ya player (`parent_staff_id`). */
  async #assertDirectChild(actor, toType, toId, transaction) {
    if (toType === TARGET_TYPE.STAFF) return this.#assertDirectChildStaff(actor, toId, transaction);

    const player = await this.models.Users.findOne({
      where: { id: toId, parent_staff_id: actor.id },
      attributes: ['id'],
      raw: true,
      transaction,
    });
    if (!player) throw errors.PLAYER_NOT_IN_YOUR_TREE({ toId });
    return Number(player.id);
  }

  #shapeStaff(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone ?? null,
      country: row.country ?? null,
      parentId: row.parent_id ?? null,
      roleId: row.role_id,
      status: row.status,
      percentage: this.#percent(row.percentage),
      // Never the password, and never `password2` — see the module note.
    };
  }

  /**
   * ── `fromStored`, NOT `toMinor` ───────────────────────────────────────
   *
   * Every money column here is bare `numeric` in the baseline —
   * the staff `credits` row (`inr`, `credit_limit`, `exposure_limit`) and
   * `staff_transfers.amount` — so Postgres has always accepted whatever
   * precision legacy's float arithmetic produced, and real rows carry well
   * past eight decimal places.
   *
   * `toMinor` refuses those by design: it validates INPUT, and a write with
   * more precision than the platform can represent is a bug. But these are
   * READS of rows that already exist, and every read path in the module went
   * through here — so a single over-precise row 400'd the account page, the
   * transfer list, the rollup and the summary with
   * "amount supports at most 8 decimal places". `fromStored` quantises to the
   * canonical scale instead. Input validation still uses `toMinor`.
   */
  #shapeBalance(row) {
    return {
      inr: money.fromStored(row?.inr ?? '0', { field: 'inr' }),
      creditLimit: money.fromStored(row?.credit_limit ?? '0', { field: 'creditLimit' }),
      exposureLimit: money.fromStored(row?.exposure_limit ?? '0', { field: 'exposureLimit' }),
      currency: BALANCE_CURRENCY,
    };
  }

  /**
   * `names` is optional: the list paths resolve them in one batch per page
   *, while the single-transfer write path has
   * no page to batch over and reports `null`.
   */
  #shapeTransfer(row, names = {}) {
    return {
      id: row.id,
      from: { type: row.from_type, id: row.from_id, name: names.from ?? null },
      to: { type: row.to_type, id: row.to_id, name: names.to ?? null },
      amount: money.fromStored(row.amount ?? '0', { field: 'amount' }),
      direction: row.direction,
      transferType: row.transfer_type ?? null,
      createdAt: row.created_at ?? null,
    };
  }

  #percent(value) {
    return value != null ? String(value) : null;
  }
}

module.exports = { StaffService };
