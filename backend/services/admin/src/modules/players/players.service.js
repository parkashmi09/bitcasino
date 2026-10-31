'use strict';

const crypto = require('node:crypto');
const { Op, literal } = require('sequelize');
const { money } = require('@ibitplay/common');
const { hashPassword, canIssueFunds } = require('@ibitplay/auth');

const errors = require('./players.errors');
const { PLAYER_ROLE_ID, PASSWORD_ROUNDS, CLOSED_STATUS, WALLET_SEED } = require('./players.constants');
const { visibleStaffIds } = require('../staff-directory/staffDirectory.service');
const { assertTransactionPassword } = require('../staff-auth/transactionPassword');
const { insufficientStaffBalance } = require('../lords/staffFloat');
const { addPointEntry, SPENDABLE_SQL } = require('../lords/pointLedger');

/**
 * Player accounts, from an operator's side.
 */
class PlayersService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  /**
   * @legacy POST /api/staff/players
   *
   * Create a player under the caller, optionally funded.
   *
   * One transaction, and the funding debit is a GUARDED update — see below.
   * Legacy opened a transaction, took three early returns out of it without
   * rolling back, and debited with no floor.
   */
  async create({ actor, username, email, phone, country, password, initialBalance = '0', parentId, transactionPassword }) {
    const anchor = await this.#resolveParent(actor, parentId);

    /**
     * The duplicate check is advisory only.
     *
     * It gives a clean 409 for the common case, but the guarantee is the unique
     * constraint — legacy relied on this SELECT alone, which two simultaneous
     * registrations both pass.
     */
    const clash = await this.models.Users.findOne({
      where: {
        [Op.or]: [
          ...(email ? [{ email: { [Op.iLike]: email } }] : []),
          { name: { [Op.iLike]: username } },
        ],
      },
      attributes: ['id'],
      raw: true,
    });
    if (clash) throw errors.ALREADY_EXISTS();

    const funding = money.toMinor(initialBalance);
    if (funding < 0n) {
      /**
       * A negative opening balance would run the transfer backwards, taking
       * money FROM the new player TO their creator. Legacy guarded the transfer
       * with `if (initial_balance > 0)` — so a negative simply skipped it — but
       * nothing rejected the input, and `initial_balance` came off the body
       * unvalidated. Refused explicitly here; the validator refuses it too.
       */
      throw errors.NOT_PERMITTED({ reason: 'an opening balance may not be negative' });
    }

    /**
     * The second factor for the opening balance.
     *
     * A funded creation moves money out of the caller's own float exactly like
     * `POST /admin/staff/transfer`, so it asks for the transaction password
     * under the SAME policy as `StaffService.transfer`: required for everyone
     * except the platform owner (Super Admin), for whom it is required once
     * set.
     * Checked before the transaction opens, so a refusal moves nothing. An
     * unfunded creation moves no money and needs no second factor.
     */
    if (funding > 0n) {
      /**
       * The opening balance is a money move with the new player, so it is the
       * DIRECT PARENT's only (the addaplay rule, as `LordsService.adjustPlayer`):
       * a player created under a descendant is funded by that descendant, not
       * out of the creator's float past it. The platform owner is exempt.
       */
      if (Number(anchor) !== Number(actor.id) && !canIssueFunds(actor)) {
        throw errors.NOT_PERMITTED({ reason: 'only the account a player reports to can fund it' });
      }
      // Required for everyone, the platform owner too (user, 2026-10-20) — as in `StaffService.transfer`.
      await assertTransactionPassword(this.models, actor.id, transactionPassword, {
        required: true,
        executiveId: actor.executiveId ?? null,
      });
    }

    /**
     * Yahan bana har player kisi staff ke neeche hai (child user), isliye referral code NAHI:
     * affiliate sirf direct users (khud signup, koi parent nahi) ke liye hai
     * (`user/affiliate/referrerResolver.js` aise codes refuse karta hai).
     */
    return this.db.transaction(async (transaction) => {
      const referralCode = null;

      const user = await this.models.Users.create(
        {
          /**
           * `users.id` is not a sequence — it is a random ten-digit number,
           * because a player's id is visible to them and a sequential one leaks
           * how many customers the platform has and in what order they joined.
           * Legacy did the same; see `#allocateId` for what is different.
           */
          id: await this.#allocateId(transaction),
          name: username,
          email: email ?? null,
          // Hash only. Legacy wrote the plaintext into `password2` beside it —
          // the fifth site in this codebase to do so.
          password: await hashPassword(password, PASSWORD_ROUNDS),
          phone: phone ?? null,
          country: country ?? null,
          parent_staff_id: anchor,
          // rainbet: an agent user's upline chose this password; the first sign-in must replace it.
          must_change_password: anchor != null,
          role_id: PLAYER_ROLE_ID,
          friends: 'Support,',
          wallet: WALLET_SEED,
          referalcode: referralCode,
          referral_link: referralCode ? this.#referralLink(referralCode) : null,
          status: 'active',
        },
        { transaction }
      );

      await this.models.Credits.create({ uid: user.id, inr: '0' }, { transaction });

      if (funding > 0n) {
        await this.#fund({ actor, userId: user.id, username: user.name, amount: funding, transaction });
      }

      this.logger?.info(
        // The password is NOT in this line. Legacy logged `req.body` whole.
        { actorStaffId: actor.id, userId: String(user.id), anchor, funded: money.toDecimalString(funding) },
        'Player account created'
      );

      return {
        id: String(user.id),
        name: user.name,
        email: user.email ?? null,
        agentId: anchor,
        referralCode,
        openingBalance: money.toDecimalString(funding),
      };
    });
  }

  /**
   * @legacy PATCH /api/staff/players/:id
   *
   * Edit a player inside the caller's tree.
   */
  async update({ actor, playerId, username, email, phone, country, password }) {
    const player = await this.#assertVisible(actor, playerId);

    const changes = {};
    if (username !== undefined) changes.name = username;
    if (email !== undefined) changes.email = email;
    if (phone !== undefined) changes.phone = phone;
    if (country !== undefined) changes.country = country;

    if (password !== undefined) {
      changes.password = await hashPassword(password, PASSWORD_ROUNDS);
      /**
       * And `password2` is cleared rather than written.
       *
       * Legacy set it to the new plaintext. Every password change through this
       * route added another cleartext password to the table; clearing it here
       * means a player who changes their password stops having one stored.
       */
      changes.password2 = null;
      if (player.parent_staff_id != null) changes.must_change_password = true;
    }

    if (!Object.keys(changes).length) throw errors.NOTHING_TO_UPDATE();

    const [affected] = await this.models.Users.update(changes, { where: { id: player.id } });
    if (!affected) throw errors.NOT_FOUND({ playerId });
    if (password !== undefined && player.parent_staff_id != null) {
      await this.models.AuthSession.update(
        { revoked_at: new Date(), revoked_reason: 'password_reset_by_staff' },
        { where: { user_id: player.id, revoked_at: null } }
      );
    }

    this.logger?.info(
      {
        actorStaffId: actor.id,
        userId: String(player.id),
        // WHICH fields changed, never their values.
        fields: Object.keys(changes),
      },
      'Player account updated'
    );

    return { id: String(player.id), updated: Object.keys(changes) };
  }

  /**
   * @legacy DELETE /api/staff/players/:id
   *
   * ═════════════════════════════════════════════════════════════════════
   * CLOSE AND ANONYMISE — NOT THE INFORMATION_SCHEMA CASCADE
   *
   * See the module header for what legacy did. In short: it read
   * `information_schema.columns` for anything named `user_id`, `userid`,
   * `uid`, `id_user` or `user`, and DELETEd from every one of those tables.
   * On this schema that is every deposit, every withdrawal, every bet and
   * every ledger row the player ever produced.
   *
   * The account is closed and the personal data cleared. The financial record
   * stays, and stays attributable to the id it belongs to — which is what
   * makes the platform's own books add up, and what a regulator asks for.
   *
   * Erasing a customer outright is a retention decision with legal weight. It
   * is deliberately not a button.
   * ═════════════════════════════════════════════════════════════════════
   */
  async close({ actor, playerId, reason }) {
    const player = await this.#assertVisible(actor, playerId);

    if (player.status === CLOSED_STATUS) throw errors.ALREADY_CLOSED({ playerId });

    return this.db.transaction(async (transaction) => {
      /**
       * The remaining balance goes back up to the agent who is closing the
       * account. Legacy deleted the `credits` row, which made the money simply
       * cease to exist — the platform's liabilities dropped by the balance with
       * no corresponding movement anywhere.
       */
      const credits = await this.models.Credits.findOne({
        where: { uid: player.id },
        transaction,
        lock: transaction.LOCK.UPDATE,
        raw: true,
      });

      const remaining = money.toMinorQuantised(credits?.inr ?? '0');

      if (remaining > 0n) {
        await this.models.Credits.update(
          { inr: '0' },
          { where: { uid: player.id }, transaction }
        );

        await this.models.StaffCredits.increment(
          { inr: money.toDecimalString(remaining) },
          { where: { staff_id: actor.id }, transaction }
        );

        const transfer = await this.models.StaffTransfers.create(
          {
            from_type: 'user',
            from_id: player.id,
            to_type: 'staff',
            to_id: actor.id,
            amount: money.toDecimalString(remaining),
            direction: 'withdraw',
            transfer_type: 'transfer',
            note: 'Account closed — balance returned',
            created_at: new Date(),
          },
          { transaction }
        );

        // Point ledger: bacha hua paisa player se wapas parent ke paas.
        await addPointEntry(
          this.models,
          {
            child: { type: 'user', id: player.id },
            parent: { type: 'staff', id: actor.id },
            amount: money.toDecimalString(remaining),
            isDeposit: false,
            transferId: transfer.id,
            remark: 'Account closed',
          },
          { transaction }
        );

        // The player's ledger closes at 0, mirroring the opening balance row.
        await this.models.CreditsLedger.create(
          {
            user_id: String(player.id),
            currency: 'INR',
            amount: `-${money.toDecimalString(remaining)}`,
            reason: 'TRANSFER_OUT',
            description: 'Account closed — balance returned',
            balance: '0',
            closing: '0',
            netamount: 0,
            profit: 0,
            loss: 0,
            commission: 0,
            idempotency_key: null,
            source_service: 'admin-service',
            meta: {
              refType: 'STAFF_TRANSFER',
              refId: String(transfer.id),
              staffId: String(actor.id),
              previousBalance: money.toDecimalString(remaining),
            },
          },
          { transaction }
        );
      }

      /**
       * Anonymise. The id survives so the financial record still joins; the
       * person does not.
       *
       * The name has to stay unique — there is a unique index on it — so the
       * id is folded in rather than using a constant.
       */
      await this.models.Users.update(
        {
          status: CLOSED_STATUS,
          name: `closed-${player.id}`,
          email: null,
          phone: null,
          // A password nobody holds, rather than a null a login path might
          // treat as "no password required".
          password: await hashPassword(crypto.randomBytes(32).toString('hex'), PASSWORD_ROUNDS),
          password2: null,
          referral_link: null,
          last_ip: null,
          is_locked: true,
          system_locked: true,
        },
        { where: { id: player.id }, transaction }
      );

      this.logger?.warn(
        {
          actorStaffId: actor.id,
          userId: String(player.id),
          balanceReturned: money.toDecimalString(remaining),
          reason: reason ?? null,
        },
        'Player account CLOSED and anonymised'
      );

      return {
        id: String(player.id),
        status: CLOSED_STATUS,
        balanceReturned: money.toDecimalString(remaining),
        /**
         * Said explicitly on the response, because an operator clicking
         * "delete" needs to know the records are still there.
         */
        note: 'Personal data cleared. Deposits, withdrawals, bets and ledger rows are retained.',
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Move the opening balance from the creator to the new player.
   *
   * The debit is a GUARDED UPDATE: `WHERE inr >= amount`, and the row count is
   * the answer. Legacy read the balance, compared it in JavaScript and then
   * debited unconditionally — so two concurrent creations both saw enough money
   * and the agent's balance went negative.
   */
  async #fund({ actor, userId, username, amount, transaction }) {
    const decimal = money.toDecimalString(amount);

    const [affected] = await this.models.StaffCredits.update(
      { inr: literal(`inr - ${decimal}`) },
      {
        where: {
          staff_id: actor.id,
          inr: { [Op.gte]: decimal },
          // TENEXCH: settlement points opening credit me nahi ja sakte.
          [Op.and]: [literal(SPENDABLE_SQL.replace(':amount', decimal))],
        },
        transaction,
      }
    );

    if (!affected) throw insufficientStaffBalance({ amount: decimal });

    await this.models.Credits.increment({ inr: decimal }, { where: { uid: userId }, transaction });

    const transfer = await this.models.StaffTransfers.create(
      {
        from_type: 'staff',
        from_id: actor.id,
        to_type: 'user',
        to_id: userId,
        amount: decimal,
        direction: 'deposit',
        transfer_type: 'transfer',
        note: 'Opening balance',
        created_at: new Date(),
      },
      { transaction }
    );

    // Point ledger: parent ne naye player ko opening balance diya.
    await addPointEntry(
      this.models,
      {
        child: { type: 'user', id: userId },
        parent: { type: 'staff', id: actor.id },
        amount: decimal,
        isDeposit: true,
        transferId: transfer.id,
        remark: 'Opening balance',
        // TENEXCH: account ka opening credit 'User creation' / open:<walletId>.
        opening: true,
      },
      { transaction }
    );

    /**
     * The player's side, written like `LordsService.adjustPlayer`: a
     * credits_ledger TRANSFER_IN (so the wallet reconciles against its ledger
     * and the admin Ledger tab shows it) and the wallet_history row. The wallet
     * was created at 0 in this same transaction, so before/after are 0 → amount.
     */
    await this.models.CreditsLedger.create(
      {
        user_id: String(userId),
        currency: 'INR',
        amount: decimal,
        reason: 'TRANSFER_IN',
        description: 'Opening balance',
        balance: decimal,
        closing: decimal,
        netamount: 0,
        profit: 0,
        loss: 0,
        commission: 0,
        idempotency_key: null,
        source_service: 'admin-service',
        meta: {
          refType: 'STAFF_TRANSFER',
          refId: String(transfer.id),
          staffId: String(actor.id),
          previousBalance: '0',
        },
      },
      { transaction }
    );

    await this.models.WalletHistory.create(
      {
        uid: userId,
        username: username || String(userId),
        coin: 'INR',
        operation: 'credit',
        amount: decimal,
        previous_balance: '0',
        new_balance: decimal,
        description: 'Opening balance',
        transaction_time: new Date(),
      },
      { transaction }
    );
  }

  /** The player must be inside the caller's tree. */
  async #assertVisible(actor, playerId) {
    const id = Number(playerId);
    if (!Number.isInteger(id) || id <= 0) throw errors.NOT_FOUND({ playerId });

    const tree = await visibleStaffIds(this.models, actor.id, { logger: this.logger });
    const seesUnassigned = tree.map(Number).includes(1);

    const player = await this.models.Users.findOne({
      where: {
        id,
        ...(seesUnassigned
          ? { [Op.or]: [{ parent_staff_id: tree }, { parent_staff_id: null, is_demo: false }] }
          : { parent_staff_id: tree }),
      },
      attributes: ['id', 'name', 'status', 'parent_staff_id'],
      raw: true,
    });

    if (!player) throw errors.NOT_FOUND({ playerId });
    return player;
  }

  /** A player may be anchored to the caller, or to anyone beneath them. */
  async #resolveParent(actor, parentId) {
    if (parentId == null) return actor.id;

    const tree = await visibleStaffIds(this.models, actor.id, { logger: this.logger });
    if (!tree.map(Number).includes(Number(parentId))) throw errors.CANNOT_REPARENT_OUTSIDE_TREE({ parentId });

    return Number(parentId);
  }

  /**
   * A free player id.
   *
   * ─────────────────────────────────────────────────────────────────────
   * LEGACY'S VERSION COULD NOT TERMINATE, AND COULD COLLIDE ANYWAY
   *
   *     async function generateNumericId() {
   *       while (true) {
   *         const candidate = _.random(1_000_000_000, 9_999_999_999);
   *         const hit = await pg.query("SELECT 1 FROM users WHERE id=$1", [candidate]);
   *         if (!hit.rowCount) return candidate;
   *       }
   *     }
   *
   * `while (true)` with a database round trip inside it, on the single shared
   * connection — and the check is a read, so two concurrent creations can both
   * find the same id free. The PRIMARY KEY is what actually prevents a
   * duplicate; the loop only avoids the common case.
   *
   * Bounded here, and `crypto.randomInt` rather than `_.random` — `Math.random`
   * is what lodash uses, and a predictable player id is a small but free thing
   * to hand an attacker enumerating accounts.
   * ─────────────────────────────────────────────────────────────────────
   */
  async #allocateId(transaction) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = crypto.randomInt(1_000_000_000, 9_999_999_999);
      const taken = await this.models.Users.findOne({
        where: { id: candidate },
        attributes: ['id'],
        transaction,
        raw: true,
      });
      if (!taken) return candidate;
    }

    // Ten collisions in a ten-digit space is not bad luck.
    throw errors.NOT_PERMITTED({ reason: 'could not allocate an account id' });
  }

  #referralLink(code) {
    const base = this.config?.PUBLIC_SITE_URL || '';
    // Legacy hardcoded `https://addaplay.com/referal/` in the handler. From
    // configuration here, and omitted rather than wrong when unset.
    return base ? `${base.replace(/\/$/, '')}/referal/${code}` : null;
  }
}

module.exports = { PlayersService };
