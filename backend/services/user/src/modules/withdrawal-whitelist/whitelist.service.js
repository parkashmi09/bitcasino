'use strict';

const { Op } = require('sequelize');
const { verifyPassword } = require('@ibitplay/auth');

const errors = require('./whitelist.errors');
const { TwoFactorService } = require('../twofa/twofa.service');

/** One account cannot fill the table. Generous — a player with real payout
 *  habits has a handful, not fifty. */
const MAX_ADDRESSES = 50;

/** A new address, and a switch-off, take effect this long after they are asked for. */
const COOL_OFF_MS = 24 * 60 * 60 * 1000;

/** Enforcement as it stands now: on, and not past a pending switch-off. */
const enforced = (user, now = new Date()) =>
  Boolean(user?.withdraw_whitelist_only) && !(user.withdraw_whitelist_off_at && new Date(user.withdraw_whitelist_off_at) <= now);

/**
 * The addresses a player has approved, and the switch that makes them binding.
 *
 * Every method takes the id from the CALLER — the controller passes
 * `req.user.id`. There is no route here that takes a player id, which is the
 * point: this is the resource an attacker holding a session would most want to
 * write, because adding an address is how stolen funds leave.
 */
class WhitelistService {
  constructor(deps) {
    this.models = deps.models;
    this.logger = deps.logger;
    this.deps = deps;
  }

  /**
   * Step-up for the writes that loosen the list: the account password, and the 2FA code when
   * 2FA is on. The same checks and codes as `TwoFactorService.disable` (PASSWORD_REQUIRED,
   * TWOFA_INVALID_CODE), so a stolen session alone cannot add an address or switch enforcement off.
   */
  async #reauth(userId, { password, code } = {}) {
    const user = await this.models.Users.findByPk(userId, { attributes: ['id', 'password'], raw: true });
    const ok = user?.password ? await verifyPassword(String(password ?? ''), user.password) : false;
    if (!ok) throw errors.PASSWORD_REQUIRED();

    const twoFa = await this.models.User2fa.findOne({ where: { uid: String(userId), is_enabled: true }, attributes: ['uid'], raw: true });
    // Built only here: its secret box needs JWT config that other callers of this service lack.
    if (twoFa) await new TwoFactorService(this.deps).verify(userId, { code: String(code ?? '') });
  }

  async #switch(userId) {
    return this.models.Users.findByPk(userId, {
      attributes: ['withdraw_whitelist_only', 'withdraw_whitelist_off_at'],
      raw: true,
    });
  }

  /** The switch as the pane shows it: on now, and when a pending switch-off lands (null if none). */
  #presentSwitch(user) {
    const on = enforced(user);
    return { whitelistOnly: on, offAt: on && user?.withdraw_whitelist_off_at ? new Date(user.withdraw_whitelist_off_at).toISOString() : null };
  }

  /**
   * The list, plus whether it is being enforced.
   *
   * Both in one read because the pane renders them together and they are only
   * meaningful together: five addresses with the switch off is a bookmark
   * list, and the same five with it on is a security control.
   */
  async list(userId) {
    const [rows, user] = await Promise.all([
      this.models.UserWithdrawalWhitelist.findAll({
        where: { user_id: userId },
        order: [['created_at', 'DESC']],
        raw: true,
      }),
      this.#switch(userId),
    ]);

    return {
      ...this.#presentSwitch(user),
      addresses: rows.map((r) => this.#present(r)),
    };
  }

  /**
   * Save an address.
   *
   * ── THE ADDRESS IS STORED AS TYPED ───────────────────────────────────
   *
   * No checksum and no per-network format rule — see migration 039 for why.
   * What IS enforced is the shape of the string: a length cap and a character
   * class, so nothing that could not be an address on any chain is storable.
   * `trim` but no case change: several chains are case-sensitive and one is
   * case-CHECKSUMMED, so lower-casing an address can invalidate it.
   */
  async add(userId, { label, currency, network, address, memo, password, code }) {
    await this.#reauth(userId, { password, code });
    const count = await this.models.UserWithdrawalWhitelist.count({ where: { user_id: userId } });
    if (count >= MAX_ADDRESSES) throw errors.TOO_MANY_ADDRESSES({ max: MAX_ADDRESSES });

    const now = new Date();
    try {
      const row = await this.models.UserWithdrawalWhitelist.create({
        user_id: userId,
        label,
        currency: String(currency).toUpperCase(),
        network: network || null,
        address,
        memo: memo || null,
        created_at: now,
        updated_at: now,
        // Usable only after the cool-off: a hijacked account cannot add its own address and withdraw.
        active_at: new Date(now.getTime() + COOL_OFF_MS),
      });
      return this.#present(row.get({ plain: true }));
    } catch (error) {
      /* The unique index is the guarantee; this is the shape it surfaces as.
         Checked on the error rather than with a read-then-insert, which two
         simultaneous saves would both pass. */
      if (error?.name === 'SequelizeUniqueConstraintError') {
        throw errors.ALREADY_WHITELISTED({ currency, address });
      }
      throw error;
    }
  }

  /**
   * Rename one. ONLY the label.
   *
   * The address, currency and network are deliberately immutable: editing an
   * address in place is indistinguishable from adding an attacker's and would
   * bypass whatever review or cool-off an operator later puts on `add`.
   * Changing where money goes means deleting and adding, which is two
   * deliberate acts and leaves the old row's absence visible.
   */
  async rename(userId, id, { label }) {
    const [affected] = await this.models.UserWithdrawalWhitelist.update(
      { label, updated_at: new Date() },
      { where: { id, user_id: userId } }
    );
    if (!affected) throw errors.ADDRESS_NOT_FOUND({ id: String(id) });
    return this.get(userId, id);
  }

  async get(userId, id) {
    const row = await this.models.UserWithdrawalWhitelist.findOne({
      where: { id, user_id: userId },
      raw: true,
    });
    if (!row) throw errors.ADDRESS_NOT_FOUND({ id: String(id) });
    return this.#present(row);
  }

  /**
   * Remove one.
   *
   * A 404 when it is not there, unlike the favourites DELETE which answers 200
   * for an already-absent row. The two are different acts: un-starring
   * something already gone is the state the caller asked for, whereas a
   * whitelist entry the caller believes exists and does not is worth being
   * told about — it may mean somebody else removed it.
   *
   * REMOVING THE LAST ADDRESS ALSO SCHEDULES THE SWITCH OFF (24 h, like
   * asking for it), because the alternative is the lockout state
   * `EMPTY_WHITELIST` exists to prevent, arrived at from the other direction.
   * Needs the password (and 2FA code), as every loosening write does.
   */
  async remove(userId, id, { password, code } = {}) {
    await this.#reauth(userId, { password, code });
    const affected = await this.models.UserWithdrawalWhitelist.destroy({
      where: { id, user_id: userId },
    });
    if (!affected) throw errors.ADDRESS_NOT_FOUND({ id: String(id) });

    /* The last address gone: enforcement goes off on the same 24 h delay as asking for it,
       so removing every address is not a faster way to turn it off. */
    const left = await this.models.UserWithdrawalWhitelist.count({ where: { user_id: userId } });
    if (left === 0) await this.#scheduleOff(userId);

    return { removed: true, remaining: left, ...this.#presentSwitch(await this.#switch(userId)) };
  }

  /**
   * The master switch.
   *
   * Turning it ON against an empty list is refused — see `EMPTY_WHITELIST`.
   * Turning it OFF is always allowed, but needs the password (and 2FA code)
   * and lands 24 h later (`offAt`), so a hijacked session cannot switch it off
   * and withdraw at once. Turning it ON again cancels a pending switch-off.
   */
  async setEnforcement(userId, enabled, { password, code } = {}) {
    if (enabled) {
      const count = await this.models.UserWithdrawalWhitelist.count({ where: { user_id: userId } });
      if (count === 0) throw errors.EMPTY_WHITELIST();
      // On at once, and any pending switch-off is cancelled.
      await this.models.Users.update({ withdraw_whitelist_only: true, withdraw_whitelist_off_at: null }, { where: { id: userId } });
    } else {
      await this.#reauth(userId, { password, code });
      await this.#scheduleOff(userId);
    }

    /**
     * READ BACK rather than echo the argument.
     *
     * The first version returned `{ whitelistOnly: enabled }` — the input — and
     * that is how this shipped broken for one test run: the column was not
     * declared on the generated `Users` model, so Sequelize silently dropped
     * it from the UPDATE, the route answered `true`, and the next GET answered
     * `false`. Echoing an argument is not a result. It is declared in
     * `packages/db/src/models/extensions.js` now, and this reads the row so the
     * two can never disagree again.
     */
    const row = await this.#switch(userId);

    this.logger?.info({ userId: String(userId), enabled }, 'Withdrawal whitelist enforcement changed');
    return this.#presentSwitch(row);
  }

  /** Off in 24 h, if it is on and no switch-off is already pending (an earlier one is kept). */
  async #scheduleOff(userId) {
    await this.models.Users.update(
      { withdraw_whitelist_off_at: new Date(Date.now() + COOL_OFF_MS) },
      { where: { id: userId, withdraw_whitelist_only: true, withdraw_whitelist_off_at: null } }
    );
  }

  /**
   * Is this destination allowed?
   *
   * The one method meant for OTHER modules — the withdraw rails call it before
   * they accept a destination. It answers `true` when enforcement is off, so a
   * caller needs no branch of its own.
   *
   * Wired into `CryptoWithdrawService.request`, inside its transaction: the
   * matching row is read FOR SHARE, so deleting that address waits for the
   * withdrawal to commit instead of racing it. The fiat rail pays bank/UPI
   * details, not addresses, so it has nothing to check.
   */
  async isAllowed(userId, { currency, address }, { transaction } = {}) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['withdraw_whitelist_only', 'withdraw_whitelist_off_at'],
      raw: true,
      transaction,
    });
    if (!enforced(user)) return true;

    // Only an address past its 24 h cool-off counts.
    const match = await this.models.UserWithdrawalWhitelist.findOne({
      attributes: ['id'],
      where: { user_id: userId, currency: String(currency).toUpperCase(), address, active_at: { [Op.lte]: new Date() } },
      transaction,
      ...(transaction ? { lock: transaction.LOCK.SHARE } : {}),
    });
    return Boolean(match);
  }

  #present(row) {
    return {
      id: String(row.id),
      label: row.label,
      currency: row.currency,
      network: row.network,
      address: row.address,
      memo: row.memo,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      activeAt: row.active_at,
    };
  }
}

module.exports = { WhitelistService, MAX_ADDRESSES, COOL_OFF_MS };
