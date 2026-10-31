'use strict';

const { money, Mailer } = require('@ibitplay/common');

const errors = require('./siteConfig.errors');
const { descendantIds } = require('../staff-directory/staffDirectory.service');

/**
 * The affiliate programme's payout rates, as stored on `siteconfig`.
 *
 * Mapping the API's names to the column names in one place. The columns are
 * spelled as they are in the database — `comissionpercent` is missing an `m`,
 * and correcting it in the schema would break every legacy reader that has not
 * been ported yet. It is corrected in the API instead.
 */
const AFFILIATE_FIELDS = Object.freeze({
  affiliateBonus: 'affiliatebonus',
  commissionPercent: 'comissionpercent',
  registerBonus: 'registerbonus',
});

/**
 * The boolean columns a browser may read — see `publicSettings()`.
 *
 * Every one of these decides whether a section of the site renders. None of
 * them names a player, and none is a credential. `gmailuser`,
 * `gmailapppassword` and `apaynotificationemail` are the three that must never
 * appear in this list.
 *
 * `sports` is NOT here — not because the column is missing (migration 034 added
 * it) but because it is a KILL SWITCH with its own route, its own audit line
 * and its own internal reader in sports-service. It belongs to
 * `OPERATOR_FLAGS`, which the staff screen writes, not to what a signed-out
 * browser reads to decide whether to draw a tab.
 */
const PUBLIC_FLAGS = Object.freeze([
  // top-level features
  'casino', 'lotto', 'vipclub', 'clubmembership', 'bonus', 'affiliate',
  'giftcards', 'welcomepack', 'wheelspin', 'provablyfair',
  // game categories
  'crash', 'originals', 'livegames', 'slotsgames', 'alllivegames', 'allslotsgames',
  'lotterygames', 'indiangames', 'cards', 'instantgames',
  // providers
  'spribe', 'evolution', 'pragmaticslots', 'pragmaticlive', 'ideal', 'microgaming',
  'pgsoft', 'hacksawgaming', 'jili', 'jilli', 'netent',
  // currencies offered
  'inr', 'mvr', 'aed', 'pkr', 'bdt', 'npr', 'cryptocoin',
  'btc', 'eth', 'ltc', 'bch', 'usdt', 'trx', 'doge', 'ada', 'xrp', 'bnb',
  'usdp', 'nexo', 'mkr', 'tusd', 'usdc', 'busd', 'shib', 'matic', 'nc', 'sc', 'bjb',
  // home page sections
  'home_heroSection', 'home_welcomebanner', 'home_latestwins', 'home_livecasino',
  'home_gamingcards', 'home_popularslots', 'home_bonus500banner', 'home_crashgames',
  'home_paymentbanner', 'home_leaderboard', 'home_promocards',
]);

/**
 * The numeric settings a browser may read.
 *
 * These are advertised rates — what the site promises a new player and a
 * referrer — so they are public by intent. They are exact decimal strings, not
 * floats, for the same reason every other amount on the platform is.
 */
const PUBLIC_AMOUNTS = Object.freeze([
  'registerbonus', 'affiliatebonus', 'comissionpercent', 'clubrake',
]);

/**
 * The flags an OPERATOR may toggle — `GET`/`PUT /site-config/global`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY AN ALLOW-LIST AND NOT `req.body`
 *
 * Legacy built its SET clause from whatever keys the body carried:
 *
 *     function buildUpdate(obj, start=1){
 *       const k = Object.keys(obj);
 *       return { clause: k.map((c,i) => `"${c}"=$${i+start}`).join(','), … };
 *     }
 *     await pg.query(`UPDATE siteconfig SET ${clause}, updatedat=now() RETURNING *`)
 *
 * Two things follow. Any column on the table was writable by naming it, so
 * `PUT /api/admin/config/global {"gmailapppassword":"…"}` replaced the SMTP
 * credential from the feature-flag screen. And the UPDATE HAD NO WHERE CLAUSE,
 * so it rewrote every row in the table and reported an arbitrary one back.
 *
 * This is the public flag set plus `sports`: everything that decides whether a
 * section renders, and nothing that is a credential or a rate. Rates keep
 * their own validated endpoint (`/site-config/affiliate`) because they are
 * decimals, not booleans, and a `parseFloat` on this path is how legacy stored
 * a commission of a billion percent.
 * ═════════════════════════════════════════════════════════════════════════
 */
const OPERATOR_FLAGS = Object.freeze([...PUBLIC_FLAGS, 'sports', 'home_livesports']);

/**
 * A player's own preferences — `GET`/`PUT /site-config/user/:userId`.
 *
 * `userconfig` is UI state, not authority: it cannot lock an account or change
 * a limit. It is allow-listed for the same reason as above — legacy shared one
 * `buildUpdate` between both tables, so the per-user endpoint could write any
 * column of `userconfig` too.
 */
const USER_PREFS = Object.freeze([
  'email_notifications', 'push_notifications', 'theme', 'language', 'hide_balance',
]);

/** The column defaults, so an unconfigured player reads the same either way. */
const DEFAULT_USER_PREFS = Object.freeze({
  email_notifications: true,
  push_notifications: true,
  theme: 'dark',
  language: 'en',
  hide_balance: false,
});

/**
 * Platform settings.
 *
 * Every method here addresses the config row by its primary key, read in a
 * defined order. That sounds like a formality and is not: `siteconfig` had no
 * primary key at all until migration 021, and legacy's read (`LIMIT 1`, no
 * ORDER BY) and write (`UPDATE`, no WHERE) were both undefined against a table
 * holding more than one row — which nothing prevented.
 */
class SiteConfigService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  /**
   * @legacy GET /affiliateAdmin/settings
   *
   * The three numbers that decide what the referral programme costs.
   */
  async affiliateSettings() {
    const row = await this.#configRow(['id', ...Object.values(AFFILIATE_FIELDS)]);

    // No config row is a real state on a fresh install, and legacy reported
    // zeros for it rather than erroring. Kept, so the screen renders.
    return {
      affiliateBonus: this.#amount(row?.affiliatebonus),
      commissionPercent: this.#amount(row?.comissionpercent),
      registerBonus: this.#amount(row?.registerbonus),
      configured: Boolean(row),
    };
  }

  /**
   * @legacy PUT /affiliateAdmin/settings
   *
   * Change one or more of them.
   *
   * The write is scoped to the id this service reads from, so "update the
   * settings" cannot touch a second row that should not exist. Legacy's
   * statement had no WHERE clause at all.
   */
  async updateAffiliateSettings({ staffId = null, ...input }) {
    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    const patch = { updatedat: new Date() };
    for (const [name, column] of Object.entries(AFFILIATE_FIELDS)) {
      if (input[name] !== undefined) patch[column] = input[name];
    }

    await this.models.Siteconfig.update(patch, { where: { id: row.id } });

    this.logger?.info(
      { staffId, configId: row.id, changed: Object.keys(patch).filter((k) => k !== 'updatedat') },
      'Affiliate programme settings changed'
    );

    return this.affiliateSettings();
  }

  /**
   * @legacy GET /sportsCheck
   *
   * Whether sports betting is switched on platform-wide.
   *
   * Read by sports-service in front of every feed endpoint. It lives here
   * because `siteconfig` is admin-owned, and sports-service asks over the
   * internal API rather than loading the whole admin model domain to reach one
   * boolean.
   *
   * Legacy served this at `/sportsCheck` AND ran the identical
   * `SELECT sports FROM siteconfig LIMIT 1` inside `sportsmiddleware.js` on
   * every single sports request — a query per request for a value that changes
   * a few times a year.
   */
  async sportsEnabled() {
    const row = await this.#configRow(['id', 'sports']);
    return {
      // Absent config reads as ON. The board being up is the normal state, and
      // a missing row is a deployment that has not been configured yet rather
      // than an operator switching sports off.
      sportsEnabled: row ? Boolean(row.sports) : true,
      configured: Boolean(row),
    };
  }

  /** Turn the whole sports board on or off. */
  async setSportsEnabled({ enabled, staffId = null }) {
    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    await this.models.Siteconfig.update(
      { sports: enabled, updatedat: new Date() },
      { where: { id: row.id } }
    );

    this.logger?.warn(
      { staffId, enabled, configId: row.id },
      enabled ? 'Sports betting switched ON platform-wide' : 'Sports betting switched OFF platform-wide'
    );

    return this.sportsEnabled();
  }

  /**
   * The feature flags a browser is allowed to read.
   *
   * ── WHY THIS EXISTS ───────────────────────────────────────────────────
   *
   * `siteconfig` is what decides whether the casino tab, the spin wheel, the
   * VIP club, gift cards and eleven home-page sections render at all. The
   * player app has always needed it, and legacy pushed it down the socket as
   * `siteConfigUpdated` — from a handler that read the whole row. The whole row
   * includes `gmailapppassword`.
   *
   * So it is an ALLOW-LIST, not the row with a few things removed. A column
   * added to `siteconfig` later is invisible here until somebody names it,
   * which is the direction the mistake should fail in: a new flag that does not
   * reach the client is a missing feature, a new credential that does is a
   * leak.
   *
   * No authentication, deliberately — a signed-out visitor deciding whether to
   * sign up is exactly who needs to see which sections exist. Nothing here
   * names a player or moves anything.
   */
  async publicSettings() {
    const row = await this.#configRow(['id', ...PUBLIC_FLAGS, ...PUBLIC_AMOUNTS]);

    // Absent config reads as ON, matching `sportsEnabled()`: a missing row is
    // an unconfigured deployment, not an operator switching the site off. The
    // client defaults the same way, so first paint does not flicker.
    const flags = Object.fromEntries(
      PUBLIC_FLAGS.map((name) => [name, row ? Boolean(row[name]) : true])
    );

    const amounts = Object.fromEntries(
      PUBLIC_AMOUNTS.map((name) => [name, this.#amount(row?.[name])])
    );

    return { ...flags, ...amounts, configured: Boolean(row) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Feature flags, for the operator
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/config/global
   *
   * The same flags `publicSettings()` exposes, plus `sports`, and without the
   * advertised rates — this is the toggle screen, not the shop window.
   */
  async globalSettings() {
    const row = await this.#configRow(['id', ...OPERATOR_FLAGS]);

    // A missing row reads as ON, as everywhere else here: an unconfigured
    // deployment is not an operator who switched the site off.
    return Object.fromEntries(
      OPERATOR_FLAGS.map((name) => [name, row ? Boolean(row[name]) : true])
    );
  }

  /**
   * @legacy PUT /api/admin/config/global
   *
   * Only the named flags change. See `OPERATOR_FLAGS` for what legacy allowed
   * instead, and `#configRow` for why this addresses one row by primary key.
   */
  async updateGlobalSettings({ staffId = null, ...flags }) {
    const patch = Object.fromEntries(
      Object.entries(flags).filter(([name]) => OPERATOR_FLAGS.includes(name))
    );
    if (!Object.keys(patch).length) throw errors.NOTHING_TO_UPDATE();

    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    await this.models.Siteconfig.update(
      { ...patch, updatedat: new Date() },
      { where: { id: row.id } }
    );

    this.logger?.warn({ staffId, flags: Object.keys(patch) }, 'Site feature flags changed');
    return this.globalSettings();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  One player's preferences
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/config/user/:uid
   *
   * ── THE SCOPE CHECK LEGACY WROTE ──────────────────────────────────────
   *
   *     const ids = await permittedIds(req.staff.id, req.staff.level);
   *     if (!ids.includes(req.staff.level === 0 ? uid : req.staff.id) &&
   *         !ids.includes(req.staff.level === 0 ? null : uid))
   *       return res.sendStatus(403);
   *
   * `ids` is a list of STAFF ids and `uid` is a PLAYER id, so the two branches
   * compare values from different tables. For the platform owner it asked
   * whether a staff list contains a player id (no) or contains `null` (no);
   * for everyone else, whether it contains their own id (yes, always) — so the
   * check passed unconditionally for every non-owner and failed for the owner.
   *
   * The question it meant to ask is the one asked here: is this player beneath
   * the caller in the tree.
   */
  async userSettings({ actor, userId }) {
    await this.#assertPlayerVisible(actor, userId);

    const row = await this.models.Userconfig.findOne({
      where: { uid: userId },
      attributes: ['uid', ...USER_PREFS],
      raw: true,
    });

    // A player who has never changed a setting has no row. Legacy returned a
    // bare `{uid}` here and the screen rendered every toggle as off — which is
    // the opposite of what an unset notification preference means.
    const prefs = Object.fromEntries(
      USER_PREFS.map((name) => [name, row?.[name] ?? DEFAULT_USER_PREFS[name]])
    );

    return { userId: Number(userId), ...prefs, configured: Boolean(row) };
  }

  /**
   * @legacy PUT /api/admin/config/user/:uid
   *
   * Legacy's `UPDATE … WHERE uid=$n RETURNING *` matched no row for a player
   * who had never been configured, so the write silently did nothing and the
   * handler returned `undefined`. This upserts.
   */
  async updateUserSettings({ actor, userId, staffId = null, ...prefs }) {
    await this.#assertPlayerVisible(actor, userId);

    const patch = Object.fromEntries(
      Object.entries(prefs).filter(([name]) => USER_PREFS.includes(name))
    );
    if (!Object.keys(patch).length) throw errors.NOTHING_TO_UPDATE();

    await this.models.Userconfig.upsert({
      uid: userId,
      ...DEFAULT_USER_PREFS,
      ...patch,
      updatedat: new Date(),
    });

    this.logger?.info({ staffId, userId, prefs: Object.keys(patch) }, 'Player preferences changed');
    return this.userSettings({ actor, userId });
  }

  /** A player is addressable only from inside the tree that owns them. */
  async #assertPlayerVisible(actor, userId) {
    const staffIds = await descendantIds(this.models, actor.id, { logger: this.logger });

    const player = await this.models.Users.findOne({
      where: { id: userId, parent_staff_id: staffIds },
      attributes: ['id'],
      raw: true,
    });
    if (!player) throw errors.PLAYER_NOT_IN_YOUR_TREE({ userId });

    return Number(player.id);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Outbound mail
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /email/settings
   *
   * The mailbox the platform sends FROM and the inbox alerts arrive at.
   *
   * The app password is never returned — only whether one is set. Legacy got
   * that right and it is kept: a settings screen that echoes a credential back
   * puts it in the browser, in any proxy cache, and in whatever captured the
   * response.
   */
  async emailSettings() {
    const row = await this.#configRow(['id', 'gmailuser', 'gmailapppassword', 'apaynotificationemail']);
    return {
      sendFrom: row?.gmailuser ?? '',
      alertsTo: row?.apaynotificationemail ?? '',
      // Whether, not what.
      hasAppPassword: Boolean(row?.gmailapppassword),
      configured: Boolean(row),
    };
  }

  /**
   * @legacy PUT /email/settings
   *
   * `appPassword` is written only when a non-empty value arrives, so saving the
   * form without retyping it keeps the existing one — legacy's behaviour, and
   * the right one.
   *
   *   THE UPDATE HAD NO WHERE CLAUSE: `UPDATE siteconfig SET ..., updatedat=now()`
   *   rewrote every row in the table. Same defect as the affiliate settings
   *   above, in a second handler.
   */
  async updateEmailSettings({ sendFrom, alertsTo, appPassword, staffId = null }) {
    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    const patch = { updatedat: new Date() };
    if (sendFrom !== undefined) patch.gmailuser = sendFrom || null;
    if (alertsTo !== undefined) patch.apaynotificationemail = alertsTo || null;
    if (appPassword) patch.gmailapppassword = appPassword;

    await this.models.Siteconfig.update(patch, { where: { id: row.id } });

    this.logger?.warn(
      {
        staffId,
        configId: row.id,
        // The names of what changed, never the values — one of them is a
        // credential.
        changed: Object.keys(patch).filter((k) => k !== 'updatedat'),
      },
      'Outbound mail settings changed'
    );

    return this.emailSettings();
  }

  /**
   * @legacy POST /email/settings/test
   *
   * Send a message to the configured alert inbox, so an operator can confirm
   * the credentials work after changing them.
   *
   * The stored `gmailuser` / `gmailapppassword` are used when they are set,
   * falling back to the service's own SMTP configuration — legacy read only the
   * stored pair, so a deployment configured through the environment had no way
   * to test it.
   */
  async sendTestEmail({ staffId = null } = {}) {
    const settings = await this.emailSettings();
    if (!settings.alertsTo) throw errors.NO_ALERT_INBOX();

    const mailer = new Mailer({
      config: {
        ...this.config,
        ...(settings.hasAppPassword
          ? { SMTP_USER: settings.sendFrom, SMTP_PASSWORD: await this.#appPassword() }
          : {}),
      },
      logger: this.logger,
    });

    const result = await mailer.send({
      to: settings.alertsTo,
      subject: 'Test — notification email is working',
      html:
        '<p>This is a test from the admin panel. Deposit and withdrawal ' +
        `notifications will arrive at <b>${escapeHtml(settings.alertsTo)}</b>.</p>`,
      text: `This is a test from the admin panel. Notifications will arrive at ${settings.alertsTo}.`,
    });

    this.logger?.info({ staffId, sent: result.sent }, 'Test notification email requested');

    // `send` resolves either way and never throws — the caller gets the outcome
    // rather than a 500 that says nothing about which half failed.
    return { sent: result.sent, to: settings.alertsTo, error: result.error ?? null };
  }

  /** Read once, used once, never returned. */
  async #appPassword() {
    const row = await this.#configRow(['id', 'gmailapppassword']);
    return row?.gmailapppassword ?? null;
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * The config row, deterministically.
   *
   * Lowest id wins. Any total order would do — the point is that it is the same
   * row on every call and the same row the update targets, which `LIMIT 1` with
   * no ORDER BY does not guarantee.
   */
  async #configRow(attributes) {
    return this.models.Siteconfig.findOne({
      attributes,
      order: [['id', 'ASC']],
      raw: true,
    });
  }

  /** Exact decimals in, exact decimals out — never a float. */
  #amount(value) {
    return money.toDecimalString(money.toMinor(value ?? '0'));
  }
}

/** Minimal escaping — the address is ours, but it still lands in an HTML body. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

module.exports = { SiteConfigService, AFFILIATE_FIELDS, OPERATOR_FLAGS, USER_PREFS };
