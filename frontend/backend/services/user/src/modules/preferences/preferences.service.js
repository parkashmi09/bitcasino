'use strict';

const errors = require('./preferences.errors');
const { DEFAULTS, THEMES, LANGUAGES } = require('./preferences.constants');

/**
 * A player's own settings — `userconfig`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE TWO SOCKET EVENTS THIS REPLACES TOOK THE PLAYER ID FROM THE MESSAGE
 *
 * `legacy/siteconfig/sockets/configSocket.js`:
 *
 *     socket.on("identify", async (raw, ack) => {
 *       const uid = Number(raw);
 *       if (!uid || isNaN(uid)) { socket.emit("identify-error", ...); return; }
 *       socket.userid = uid;
 *       socket.join(ROOM.u(uid));
 *       const cfg = await userModel.get(uid);
 *       socket.emit("userConfigUpdated", cfg);
 *     });
 *
 * The ONLY validation is that the number parses. Send `identify(7)` and you
 * are player 7: you receive their settings immediately, and you stay joined to
 * their room, so every later push meant for them arrives at your socket. No
 * token is involved at any point.
 *
 * The second one does not even read a config — it just joins:
 *
 *     socket.on('subscribeUserConfig', id => socket.join(ROOM.u(id)));
 *
 * One line, no check, no reply. A comment above it says "optional: allow
 * re-subscribing to another uid (admin preview)", which is what it is for —
 * but nothing in it is limited to an admin.
 *
 * ── AND THE FILE REGISTERED ITSELF ONCE PER CONNECTION ───────────────────
 *
 * `legacy/index.js` calls `setupSiteConfigSocket(io)` INSIDE its connection
 * handler, and that function's body is `io.on('connection', …)`. Connection #2
 * added a second global listener, #3 a third. Connection N fired N handlers,
 * each running two queries and emitting two payloads — a service that gets
 * slower the longer it stays up. See `docs/SOCKETS.md` §4.
 *
 * The identity comes from the token here, so `identify` has nothing to
 * identify AS, and the admin preview is a staff-only event.
 * ═════════════════════════════════════════════════════════════════════════
 */
class PreferencesService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  /**
   * The caller's own settings.
   *
   * Legacy's `userModel.get` returned `rows[0] || { uid }` — a bare object with
   * nothing else in it, so a player who had never saved a setting got a config
   * with no `theme`, no `language` and no notification flags, and every client
   * reading `cfg.theme` got `undefined`. The defaults are named here.
   */
  async get({ userId }) {
    const row = await this.models.Userconfig.findOne({ where: { uid: userId }, raw: true });
    return this.#describe(row, userId);
  }

  /**
   * Change them.
   *
   * Legacy's `update` built its SET clause with `buildUpdate(f)` from whatever
   * object it was handed and interpolated the result:
   *
   *     UPDATE userconfig SET ${clause}, updatedat=now() WHERE uid=$n
   *
   * The route feeding it is not reachable today, but the column list comes from
   * the caller's object keys — one careless call site from column-name
   * injection. The fields are named explicitly here.
   *
   * The provably-fair seed columns live in this table too and are NOT settable
   * from here: rotating a seed is what makes a past round verifiable, and it
   * belongs to the fairness path, not to a settings screen.
   */
  async update({ userId, theme, language, emailNotifications, pushNotifications, hideBalance }) {
    if (theme !== undefined && !THEMES.includes(theme)) throw errors.UNKNOWN_THEME({ theme });
    if (language !== undefined && !LANGUAGES.includes(language)) throw errors.UNKNOWN_LANGUAGE({ language });

    const changes = {};
    if (theme !== undefined) changes.theme = theme;
    if (language !== undefined) changes.language = language;
    if (emailNotifications !== undefined) changes.email_notifications = Boolean(emailNotifications);
    if (pushNotifications !== undefined) changes.push_notifications = Boolean(pushNotifications);
    if (hideBalance !== undefined) changes.hide_balance = Boolean(hideBalance);

    if (!Object.keys(changes).length) throw errors.NOTHING_TO_UPDATE();

    /**
     * Upsert, because a player who has never saved a setting has no row —
     * legacy's UPDATE matched nothing and returned `rows[0]` as `undefined`,
     * which the handler returned as the new config.
     */
    const [row] = await this.models.Userconfig.upsert(
      { uid: userId, ...changes, updatedat: new Date() },
      { returning: true }
    );

    this.logger?.info({ userId: String(userId), changed: Object.keys(changes) }, 'Player settings updated');

    return this.#describe(row?.get ? row.get({ plain: true }) : row, userId);
  }

  #describe(row, userId) {
    return {
      uid: String(userId),
      theme: row?.theme ?? DEFAULTS.theme,
      language: row?.language ?? DEFAULTS.language,
      emailNotifications: row?.email_notifications ?? DEFAULTS.emailNotifications,
      pushNotifications: row?.push_notifications ?? DEFAULTS.pushNotifications,
      hideBalance: row?.hide_balance ?? DEFAULTS.hideBalance,
      updatedAt: row?.updatedat ?? null,
      /**
       * Deliberately absent: `fair_server_seed`, `fair_server_seed_hash`,
       * `fair_client_seed`, `fair_nonce`.
       *
       * Those columns were added to this table by THIS port, not by legacy, so
       * legacy's `SELECT * FROM userconfig` never returned them. It would now —
       * which is exactly why this shape is an explicit field list rather than
       * the row. The server seed of an unrevealed round is the one value that
       * must stay secret until the round is over: knowing it means knowing the
       * outcome in advance.
       */
    };
  }
}

module.exports = { PreferencesService };
