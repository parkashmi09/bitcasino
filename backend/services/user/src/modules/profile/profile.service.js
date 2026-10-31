'use strict';

const { Op, fn, col, where } = require('@ibitplay/db');

const errors = require('./profile.errors');
const avatarErrors = require('./avatar.errors');
const { resolveVipLadder } = require('@ibitplay/common');
const { resolveReferrerOwner, referralLinkFor } = require('../affiliate/referrerResolver');

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
  constructor({ models, db, config, logger, clients }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    /* `publicProfile` asks casino-service for the bet counts; nothing else
       here leaves this service. */
    this.clients = clients;
  }

  /**
   * Another player's profile — gap 17.
   *
   * `get()` above answers the CALLER's own and takes no id; there was no route
   * that took one, so clicking a name in chat or on a leaderboard had nowhere
   * to go.
   *
   * ── WHAT IS PUBLIC, AND WHY THAT LIST AND NOT A LONGER ONE ────────────
   *
   * Username, avatar, VIP level, join date and the bet/win counts. NOT email,
   * phone, country, balance, referral code or status — `get()` returns several
   * of those and every one of them is either a contact detail, a location, or
   * money. The test applied was "would this appear next to a name in chat on
   * the site being ported", and nothing outside that list would.
   *
   * `level` is the COMPUTED VIP level, not `users.level`. The two disagree —
   * `users.level` is a column an operator sets and the computed one is derived
   * from lifetime wager — and the platform's own eligibility checks compare
   * against the computed one, so publishing the stored column would show a
   * number the rest of the system does not act on.
   *
   * ── THERE IS NO PRIVACY SETTING TO HONOUR, AND THAT IS A GAP ──────────
   *
   * `userconfig` has `hide_balance` and nothing else; there is no "hide my
   * stats" flag anywhere in the schema, so a player cannot opt out of the
   * counts below. The front-end has a `hideGameData` field in its own shape
   * with nothing behind it. Recorded rather than invented: adding a column
   * here would be this port inventing a product decision.
   */
  async publicProfile(userId) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'avatar', 'created', 'games_played'],
      raw: true,
    });

    // The same 404 as `get()` — an id that is not a player and one that does
    // not exist are the same answer.
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    const [wagerRow, ladder] = await Promise.all([
      this.models.Userwager.findOne({ where: { uid: userId }, raw: true }),
      resolveVipLadder(this.models, { logger: this.logger }),
    ]);
    const cleaned = String(wagerRow?.wager ?? '0').replace(/,/g, '').trim();
    const wager = /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : '0';
    const vip = ladder.levelFor(wager);

    /**
     * The counts come from casino-service, which owns `bets`. A failure there
     * must not 500 a profile — the identity half is the part that matters and
     * it is already in hand — so the counts degrade to null and the client can
     * tell "none yet" (0) from "could not read" (null).
     */
    let stats = null;
    try {
      /* `playerStats` answers `{ ...totals, bySource }` — bets and wins are at
         the TOP level, not under a `totals` key. An earlier version read
         `.totals` and got `undefined`, which the `?? null` below then made
         indistinguishable from a failed call. */
      const answer = await this.clients.casino.get(`/internal/casino/bet-history/player/${userId}/stats`);
      stats = answer && typeof answer.bets === 'number' ? { bets: answer.bets, wins: answer.wins } : null;
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId) }, 'public profile stats unavailable');
    }
    // Sports bets count too (sportsbook's own profile-stats, per currency); a sports outage leaves the casino counts.
    if (stats && this.clients.sports) {
      try {
        const sports = await this.clients.sports.get(`/internal/sports/wager/player/${userId}/profile-stats`);
        for (const row of sports?.byCurrency ?? []) {
          stats.bets += Number(row.bets) || 0;
          stats.wins += Number(row.wins) || 0;
        }
      } catch (error) {
        this.logger?.warn({ err: error, userId: String(userId) }, 'public profile sports stats unavailable');
      }
    }

    // Either switch hides the counts: rainbet's "Display Statistics on Profile" (show_statistics, migration 169)
    // or hash's "Hide my gaming data on profile" (hide_gaming_data, migration 177). No counts leave the server.
    const prefs = await this.models.Userconfig.findOne({ where: { uid: userId }, attributes: ['show_statistics', 'hide_gaming_data'], raw: true })
      .catch(() => null);
    const hidden = prefs?.show_statistics === false || Boolean(prefs?.hide_gaming_data);

    return {
      userId: String(user.id),
      username: user.name,
      avatar: user.avatar,
      joinedAt: user.created,
      gamingDataHidden: hidden,
      /* The COMPUTED level — see above. `card` is the tier name the VIP page
         shows beside it. */
      level: vip.level,
      card: vip.card,
      // The admin's name for the level and its card badge (VIP branding, migration 120).
      levelName: vip.name,
      badgeUrl: vip.badgeUrl ?? null,
      gamesPlayed: hidden ? null : user.games_played,
      statisticsHidden: hidden,
      bets: hidden ? null : stats?.bets ?? null,
      wins: hidden ? null : stats?.wins ?? null,
    };
  }

  /** The player's COMPUTED VIP level (lifetime wager on the ladder) — what avatars unlock from. */
  async vipLevel(userId) {
    const [wagerRow, ladder] = await Promise.all([
      this.models.Userwager.findOne({ where: { uid: userId }, raw: true }),
      resolveVipLadder(this.models, { logger: this.logger }),
    ]);
    const cleaned = String(wagerRow?.wager ?? '0').replace(/,/g, '').trim();
    return ladder.levelFor(/^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : '0');
  }

  /**
   * Pick an avatar from the operator's set (Admin → Avatars, migration 115). Refused when it is
   * missing or switched off (404 `AVATAR_NOT_FOUND`) or unlocks above the player's computed VIP
   * level (403 `AVATAR_LOCKED`). Stores the avatar's image URL in `users.avatar`.
   */
  async setAvatar(userId, avatarId) {
    let avatar;
    try {
      avatar = await this.clients.admin.get(`/internal/admin/avatars/${Number(avatarId)}`);
    } catch (error) {
      if (error?.status === 404) throw avatarErrors.NOT_FOUND({ avatarId });
      throw error;
    }
    if (!avatar || avatar.enabled === false) throw avatarErrors.NOT_FOUND({ avatarId });

    const vip = await this.vipLevel(userId);
    if (vip.level < avatar.minLevel) throw avatarErrors.LOCKED({ minLevel: avatar.minLevel, level: vip.level });

    const [affected] = await this.models.Users.update({ avatar: avatar.url }, { where: { id: userId } });
    if (!affected) throw errors.USER_NOT_FOUND({ userId });
    return this.get(userId);
  }

  async get(userId) {
    const [user, vip] = await Promise.all([
      this.models.Users.findByPk(userId, {
        attributes: [
          'id', 'name', 'email', 'phone', 'country', 'avatar', 'level',
          'referalcode', 'referral_link', 'status', 'two_fa_status',
          'games_played', 'last_login_at', 'created', 'created_estimated', 'email_verified_at',
        ],
        raw: true,
      }),
      this.vipLevel(userId),
    ]);
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    return {
      id: user.id,
      username: user.name,
      email: user.email,
      /** Migration 180: the player proved this address (the owner's deposit_email_verification reads it). */
      emailVerified: Boolean(user.email_verified_at),
      phone: user.phone,
      country: user.country,
      avatar: user.avatar,
      /** `users.level`, the operator-set column — NOT the VIP level. */
      level: user.level,
      /** The COMPUTED VIP level (lifetime wager on the ladder): what avatars unlock from. */
      vipLevel: vip.level,
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

    // The spent `change-email` code proved the new address, so it counts as verified.
    await user.update({ email: address, email_verified_at: new Date() });

    this.logger?.warn({ userId, email: address }, 'Account email changed');
    return this.get(userId);
  }

  /** @legacy GET /get-referral-code/:uid */
  async getReferral(userId) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['referalcode'],
      raw: true,
    });
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    // Legacy returned the strings "No Code" / "No Link" when these were null,
    // which a client cannot distinguish from a real code. Null is null.
    //
    // The link is BUILT, exactly as `GET /user/affiliate` builds it, not read
    // from `users.referral_link`: registration never writes that column, so
    // every account created here answered `referralLink: null` while the
    // affiliate page showed a working link for the same code.
    return {
      referralCode: user.referalcode ?? null,
      referralLink: referralLinkFor(this.config, user.referalcode),
    };
  }

  /**
   * @legacy GET /verify-referral-code/:referralCode
   *
   * Uses the SAME resolver as signup (`affiliate/referrerResolver.js`): exact
   * code, then the code in another case, then a username. It used to be an
   * exact, case-sensitive code match, so the form said "invalid" for codes
   * signup would have accepted.
   *
   * Deliberately returns only `{ valid }` — never who the code belongs to.
   * This runs unauthenticated on the signup form, so anything more would let a
   * stranger map codes to accounts.
   */
  async verifyReferralCode(referralCode) {
    const owner = await resolveReferrerOwner(this.models, referralCode);
    return { valid: Boolean(owner) };
  }
}

module.exports = { ProfileService };
