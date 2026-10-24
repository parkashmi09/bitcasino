'use strict';

const errors = require('./whitelist.errors');

/** One account cannot fill the table. Generous — a player with real payout
 *  habits has a handful, not fifty. */
const MAX_ADDRESSES = 50;

/**
 * The addresses a player has approved, and the switch that makes them binding.
 *
 * Every method takes the id from the CALLER — the controller passes
 * `req.user.id`. There is no route here that takes a player id, which is the
 * point: this is the resource an attacker holding a session would most want to
 * write, because adding an address is how stolen funds leave.
 */
class WhitelistService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
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
      this.models.Users.findByPk(userId, { attributes: ['withdraw_whitelist_only'], raw: true }),
    ]);

    return {
      whitelistOnly: Boolean(user?.withdraw_whitelist_only),
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
  async add(userId, { label, currency, network, address, memo }) {
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
   * REMOVING THE LAST ADDRESS ALSO TURNS THE SWITCH OFF, in the same
   * transaction-free pair, because the alternative is the lockout state
   * `EMPTY_WHITELIST` exists to prevent, arrived at from the other direction.
   */
  async remove(userId, id) {
    const affected = await this.models.UserWithdrawalWhitelist.destroy({
      where: { id, user_id: userId },
    });
    if (!affected) throw errors.ADDRESS_NOT_FOUND({ id: String(id) });

    const left = await this.models.UserWithdrawalWhitelist.count({ where: { user_id: userId } });
    if (left === 0) {
      await this.models.Users.update({ withdraw_whitelist_only: false }, { where: { id: userId } });
    }

    return { removed: true, remaining: left, whitelistOnly: left > 0 ? undefined : false };
  }

  /**
   * The master switch.
   *
   * Turning it ON against an empty list is refused — see `EMPTY_WHITELIST`.
   * Turning it OFF is always allowed: a player must never need permission to
   * restore their own access.
   */
  async setEnforcement(userId, enabled) {
    if (enabled) {
      const count = await this.models.UserWithdrawalWhitelist.count({ where: { user_id: userId } });
      if (count === 0) throw errors.EMPTY_WHITELIST();
    }

    await this.models.Users.update({ withdraw_whitelist_only: enabled }, { where: { id: userId } });

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
    const row = await this.models.Users.findByPk(userId, {
      attributes: ['withdraw_whitelist_only'],
      raw: true,
    });

    this.logger?.info({ userId: String(userId), enabled }, 'Withdrawal whitelist enforcement changed');
    return { whitelistOnly: Boolean(row?.withdraw_whitelist_only) };
  }

  /**
   * Is this destination allowed?
   *
   * The one method meant for OTHER modules — the withdraw rails call it before
   * they accept a destination. It answers `true` when enforcement is off, so a
   * caller needs no branch of its own.
   *
   * NOT WIRED INTO A WITHDRAW PATH YET, and that is stated rather than hidden:
   * `crypto-withdraw` builds its request from a provider that is unconfigured
   * on this delivery, so there is no reachable flow to enforce against and
   * wiring it would be untestable. The check is here, correct and covered, for
   * the rail to call when a provider exists.
   */
  async isAllowed(userId, { currency, address }) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['withdraw_whitelist_only'],
      raw: true,
    });
    if (!user?.withdraw_whitelist_only) return true;

    const match = await this.models.UserWithdrawalWhitelist.count({
      where: { user_id: userId, currency: String(currency).toUpperCase(), address },
    });
    return match > 0;
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
    };
  }
}

module.exports = { WhitelistService, MAX_ADDRESSES };
