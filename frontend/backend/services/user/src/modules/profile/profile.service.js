'use strict';

const { Op, fn, col, where } = require('@ibitplay/db');

const errors = require('./profile.errors');

/**
 * A player's own profile.
 *
 * Collects four handlers that lived inline in the 236 KB `legacy/index.js`.
 * All four took the uid from the request with no authentication:
 * `PUT /editProfile {"uid": 7, "username": "x"}` renamed any account.
 *
 * `PUT /editProfile` also had no uniqueness check, so two accounts could end up
 * with the same name — and `name` is what the login endpoint matches on, which
 * makes a duplicate a genuine authentication problem rather than a cosmetic one.
 */
class ProfileService {
  constructor({ models, db, config, logger }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
  }

  async get(userId) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: [
        'id', 'name', 'email', 'phone', 'country', 'avatar', 'level',
        'referalcode', 'referral_link', 'status', 'two_fa_status',
        'games_played', 'last_login_at', 'created', 'created_estimated',
      ],
      raw: true,
    });
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    return {
      id: user.id,
      username: user.name,
      email: user.email,
      phone: user.phone,
      country: user.country,
      avatar: user.avatar,
      level: user.level,
      referralCode: user.referalcode,
      referralLink: user.referral_link,
      status: user.status,
      twoFactorEnabled: Boolean(user.two_fa_status),
      gamesPlayed: user.games_played,
      lastLoginAt: user.last_login_at,
      /**
       * `created`, the timestamp — NOT `created_estimated`, which is the
       * BOOLEAN flag saying whether that timestamp is a guess. This returned
       * `joinedAt: false` for every account.
       */
      joinedAt: user.created,
      /** Whether `joinedAt` is an estimate rather than a recorded signup. */
      joinedAtEstimated: Boolean(user.created_estimated),
    };
  }

  /**
   * @legacy PUT /editProfile
   *
   * Legacy updated only `name`, and did so unconditionally. Here the username
   * is checked for uniqueness first — case-insensitively, because `Player` and
   * `player` both resolve at login and would be ambiguous.
   */
  async update(userId, changes) {
    const user = await this.models.Users.findByPk(userId);
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    if (changes.username && changes.username !== user.name) {
      const taken = await this.models.Users.findOne({
        where: {
          [Op.and]: [
            where(fn('LOWER', col('name')), changes.username.toLowerCase()),
            { id: { [Op.ne]: userId } },
          ],
        },
        attributes: ['id'],
        raw: true,
      });
      if (taken) throw errors.USERNAME_TAKEN({ username: changes.username });
    }

    await user.update({
      ...(changes.username !== undefined ? { name: changes.username } : {}),
      ...(changes.country !== undefined ? { country: changes.country } : {}),
      ...(changes.avatar !== undefined ? { avatar: changes.avatar } : {}),
    });

    this.logger?.info({ userId, changed: Object.keys(changes) }, 'Profile updated');
    return this.get(userId);
  }

  /**
   * Change the address on the account, having proved it can receive mail.
   *
   * @legacy SOCKET ca6e08ddde39ee9f965270b7d8175d17 (C.EDIT_ACCOUNT)
   *
   * ═════════════════════════════════════════════════════════════════════
   * LEGACY WROTE THE NEW ADDRESS STRAIGHT IN
   *
   *     Rule.getUserInfoByEmail(email, (result) => {
   *       result = _.toArray(result);
   *       if (result.length > 1) return callback({error: "Email already was taken."});
   *       else pg.query("UPDATE users SET email = $1 WHERE id = $2", [email, id], ...)
   *
   * Two things wrong, and they compound.
   *
   *   THE UNIQUENESS CHECK IS OFF BY ONE. One account already on that address
   *   gives `length === 1`, which is not `> 1`, so the update runs anyway. Two
   *   accounts, one address.
   *
   *   NOTHING PROVED THE ADDRESS WAS REACHABLE. `users.email` is where password
   *   reset delivers. Setting it to an unverified string hands the recovery
   *   path to whoever reads that mailbox — and a typo locks the player out of
   *   their own account recovery with no way back.
   *
   * Combined: an attacker holding a session (which the leaked JWT secret gave
   * anyone — see docs/ROTATION.md) changes the address and owns the reset path
   * permanently, without ever knowing the password.
   *
   * A verified code for `change-email` on the NEW address is required here, and
   * it is spent — so one verification authorises exactly one change.
   * ═════════════════════════════════════════════════════════════════════
   *
   * @param proveEmail an async `({email, purpose}) => boolean` that spends a
   *   recent verification. Injected rather than imported so this module does
   *   not depend on the email module's construction — the caller passes
   *   `EmailService.spendProof`.
   */
  async changeEmail(userId, { email, proveEmail }) {
    const user = await this.models.Users.findByPk(userId);
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    const address = String(email ?? '').trim().toLowerCase();

    if (address && user.email && address === String(user.email).toLowerCase()) {
      throw errors.EMAIL_UNCHANGED({ email: address });
    }

    /**
     * `>= 1`, not `> 1`. Case-insensitive, because addresses are — legacy
     * compared the escaped, normalised string against the column directly, so
     * `A@b.com` and `a@b.com` were two different accounts to it.
     */
    const taken = await this.models.Users.findOne({
      where: {
        [Op.and]: [where(fn('LOWER', col('email')), address), { id: { [Op.ne]: userId } }],
      },
      attributes: ['id'],
      raw: true,
    });
    if (taken) throw errors.EMAIL_TAKEN({ email: address });

    const proved = await proveEmail({ email: address });
    if (!proved) throw errors.EMAIL_NOT_VERIFIED({ email: address });

    await user.update({ email: address });

    this.logger?.warn({ userId, email: address }, 'Account email changed');
    return this.get(userId);
  }

  /** @legacy GET /get-referral-code/:uid */
  async getReferral(userId) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['referalcode', 'referral_link'],
      raw: true,
    });
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    // Legacy returned the strings "No Code" / "No Link" when these were null,
    // which a client cannot distinguish from a real code. Null is null.
    return {
      referralCode: user.referalcode ?? null,
      referralLink: user.referral_link ?? null,
    };
  }

  /**
   * @legacy GET /verify-referral-code/:referralCode
   *
   * Deliberately returns only `{ valid }` — never who the code belongs to.
   * This runs unauthenticated on the signup form, so anything more would let a
   * stranger map codes to accounts.
   */
  async verifyReferralCode(referralCode) {
    const owner = await this.models.Users.findOne({
      where: { referalcode: referralCode },
      attributes: ['id'],
      raw: true,
    });
    return { valid: Boolean(owner) };
  }
}

module.exports = { ProfileService };
