'use strict';

const {
  money, Mailer, entitlements, currencyRegistry, rewardCurrencyOf, defaultCurrencyOf, isDefaultCurrencyChoice, REWARD_CURRENCY_NAMES,
} = require('@ibitplay/common');

const errors = require('./siteConfig.errors');
const ownerErrors = require('../features/owner.errors');

/** The `site_features` row holding the owner's reward currency (a catalogue policy). */
const REWARD_CURRENCY_FEATURE = 'reward_currency';

/** The `site_features` row holding the owner's default coin (a catalogue policy). */
const DEFAULT_CURRENCY_FEATURE = 'default_currency';
const { visibleStaffIds } = require('../staff-directory/staffDirectory.service');
const { assertTransactionPassword } = require('../staff-auth/transactionPassword');

/**
 * user-service's payment gateways, as the owner panel names them (its flag is `gateway_<name>`).
 * `currencies`: a gateway the OWNER switches per currency — each key is the owner's flag, the same key
 * user-service checks (`currencySwitch` in payment-orders/gateways). The Super Admin only sees them.
 */
const PAYMENT_GATEWAYS = Object.freeze([
  { name: 'ccpayment', label: 'CCPayment (crypto deposits)' },
  { name: 'apay', label: 'A-Pay' },
  { name: 'waypay', label: 'WayPay' },
  { name: 'cricpay', label: 'CricPay' },
  { name: 'upi', label: 'UPI (EkQR)' },
  {
    name: 'f2pay',
    label: 'F2Pay (deposits)',
    // Each currency's methods are rows of `payment_methods` (migration 153).
    currencies: [
      // INR and crypto only (user, 2026-10-24).
      { code: 'INR', key: 'f2pay_inr', label: 'INR' },
      { code: 'USDT', key: 'f2pay_usdt', label: 'Crypto (USDT)' },
    ],
  },
]);

/** A Payment Methods switch: a whole gateway (`apay`, `f2pay`) — the Super Admin switches nothing finer. */
const PAYMENT_SWITCHES = Object.freeze(PAYMENT_GATEWAYS.map((g) => g.name));

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

const AFFILIATE_CURRENCY_FIELDS = Object.freeze({
  registerBonusCurrency: 'register_bonus_currency',
  affiliateBonusCurrency: 'affiliate_bonus_currency',
});

/** The welcome bonus columns (migration 070, plus the original `registerbonus`). */
const WELCOME_FIELDS = Object.freeze({
  registerBonus: 'registerbonus',
  registerBonusEnabled: 'register_bonus_enabled',
  firstDepositEnabled: 'first_deposit_bonus_enabled',
  firstDepositTiers: 'first_deposit_bonus_tiers',
  firstDepositWagerMultiplier: 'first_deposit_bonus_wager_multiplier',
  // Migration 076: days an unwagered first-deposit bonus stays in the bonus balance.
  firstDepositExpiryDays: 'first_deposit_bonus_expiry_days',
});

/**
 * Peer-to-peer tip limits (migration 081), all USD. The defaults are the
 * column defaults and what user-service falls back to when it cannot read
 * these — limits ON, never "no limits".
 */
const TIP_LIMIT_FIELDS = Object.freeze({
  maxPerTipUsd: 'tip_max_per_tip_usd',
  maxPerDayUsd: 'tip_max_per_day_usd',
  minWageredUsd: 'tip_min_wagered_usd',
});
const TIP_LIMIT_DEFAULTS = Object.freeze({ maxPerTipUsd: '500', maxPerDayUsd: '2000', minWageredUsd: '0' });

/**
 * Referral unlock tiers (migration 106) — the "Friend's Level / Total Wager /
 * Unlock Amount" table on the player site's `/referral/rules`.
 *
 * PAYING TERMS (19 Oct 2026). user-service's tier unlock reads this table through
 * `/internal/admin/site-config/affiliate` (`referralUnlocks`); `UNLOCK_TIERS` in
 * affiliate.constants.js is only the fallback when the table is unreadable. Amounts are USD
 * (hash.game's $1,000 per friend), priced into the reward currency when paid.
 *
 * The defaults are the migration's column default (the bc.game capture the
 * page shipped with) and are what a site without the column yet reads, so the
 * page is unchanged until an operator edits it. Kept in step with
 * `packages/db/migrations/106-referral-unlock-tiers.js` by hand.
 */
/** hash.game's commission rates (migration 134): `wager × 1% × rate × game rate`, percents. */
const COMMISSION_RATE_DEFAULT = '25';
const GAME_RATE_DEFAULTS = Object.freeze({ originals: '28', slots: '60', live: '60', sports: '100' });

const REFERRAL_UNLOCK_COLUMN = 'referral_unlock_tiers';
const REFERRAL_UNLOCK_MAX = 50;
const REFERRAL_UNLOCK_DEFAULTS = Object.freeze([
  { level: 'Bronze I', totalWager: '1000', unlockAmount: '0.50' },
  { level: 'Bronze II', totalWager: '3000', unlockAmount: '2.50' },
  { level: 'Bronze IV', totalWager: '15000', unlockAmount: '5.00' },
  { level: 'Silver I', totalWager: '30000', unlockAmount: '12.00' },
  { level: 'Silver III', totalWager: '120000', unlockAmount: '25.00' },
  { level: 'Silver IV', totalWager: '240000', unlockAmount: '50.00' },
  { level: 'Gold I', totalWager: '500000', unlockAmount: '80.00' },
  { level: 'Gold II', totalWager: '1000000', unlockAmount: '120.00' },
  { level: 'Gold IV', totalWager: '3500000', unlockAmount: '205.00' },
  { level: 'Platinum II', totalWager: '8500000', unlockAmount: '500.00' },
].map(Object.freeze));

/**
 * The business settings an operator owns — limits, policy and schedule.
 *
 * ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────
 *
 * Every one of these was an environment variable, which put two things in the
 * wrong hands: changing the minimum bet meant a deploy, and the person who
 * could change it was whoever had shell access rather than whoever runs the
 * site. They are stored per site now and edited in the admin, behind a
 * permission and an audit row.
 *
 * ENV IS STILL THE FALLBACK. Nothing stored means "use the deployed value", so
 * a site that has never opened the screen behaves exactly as it did.
 *
 * `env` names the variable each one replaces, `kind` is what a value must be,
 * and a range is enforced on write — an operator cannot set a maximum below a
 * minimum, or a house edge of 90%.
 */
const OPERATOR_SETTINGS = Object.freeze({
  casino_house_edge: { env: 'CASINO_HOUSE_EDGE', kind: 'number', min: 0, max: 20, label: 'House edge %' },
  casino_min_bet: { env: 'CASINO_MIN_BET', kind: 'decimal', min: 0, label: 'Minimum bet' },
  casino_max_bet: { env: 'CASINO_MAX_BET', kind: 'decimal', min: 0, label: 'Maximum bet' },
  casino_seed_rotate_after: { env: 'CASINO_SEED_ROTATE_AFTER', kind: 'number', min: 0, max: 1e6, label: 'Rotate the fair seed after N rounds' },

  // The old sportsbook's stake / payout / drift settings are gone (nothing read them).
  race_timezone: { env: 'RACE_TIMEZONE', kind: 'timezone', label: 'Race week resets in' },

  login_max_attempts: { env: 'LOGIN_MAX_ATTEMPTS', kind: 'number', min: 1, max: 50, label: 'Failed logins before a lock' },
  login_lock_minutes: { env: 'LOGIN_LOCK_MINUTES', kind: 'number', min: 1, max: 1440, label: 'Lock lasts (minutes)' },
  max_active_sessions: { env: 'MAX_ACTIVE_SESSIONS', kind: 'number', min: 1, max: 100, label: 'Sessions per player' },
  // Read by user-service's AuthService, with the owner's `idle_logout` flag (both on = in force): 5
  // minutes after sign-in a player with no sports / Originals / casino bet in them is signed out.
  idle_logout: { env: 'IDLE_LOGOUT', kind: 'boolean', default: true, label: 'Sign a player out who places no bet in the first 5 minutes' },
  require_email_verification: { env: 'REQUIRE_EMAIL_VERIFICATION', kind: 'boolean', label: 'Verify email before transacting' },

  // Read by user-service's PlayerBonusService (user, 2026-10-28). The lock is in force only while
  // the owner's `bonus.wagering_lock` is on too; the forfeit pair is the withdraw popup's copy.
  bonus_wagering_lock: { env: 'BONUS_WAGERING_LOCK', kind: 'boolean', default: true, label: 'Keep a granted bonus locked until it is wagered' },
  bonus_forfeit_allowed: { env: 'BONUS_FORFEIT_ALLOWED', kind: 'boolean', default: true, label: 'Let a player give up a locked bonus to withdraw' },
  bonus_forfeit_title: { env: 'BONUS_FORFEIT_TITLE', kind: 'text', maxLength: 80, default: 'You will lose your bonus', label: 'Forfeit popup title' },
  bonus_forfeit_message: {
    env: 'BONUS_FORFEIT_MESSAGE',
    kind: 'text',
    maxLength: 400,
    default: 'Your bonus is still locked because its wagering requirement has not been met. If you withdraw now, the locked bonus will be forfeited and cannot be recovered. Your cash balance will not be affected.',
    label: 'Forfeit popup message',
  },

  // Loss bonus (lossback), read by user-service's LossBonusService (user, 2026-10-28): a share of a
  // player's net loss over the last completed period, claimed by the player. Amounts are in the
  // site's reward currency; OFF until the Super Admin turns it on.
  loss_bonus_enabled: { env: 'LOSS_BONUS_ENABLED', kind: 'boolean', default: false, label: 'Loss bonus on' },
  loss_bonus_percent: { env: 'LOSS_BONUS_PERCENT', kind: 'decimal', min: 0, max: 100, default: '10', label: 'Loss bonus % of net loss' },
  loss_bonus_period_days: { env: 'LOSS_BONUS_PERIOD_DAYS', kind: 'number', min: 1, max: 31, default: 7, label: 'Period (days; 7 = Monday to Monday, 1 = daily)' },
  loss_bonus_min_loss: { env: 'LOSS_BONUS_MIN_LOSS', kind: 'decimal', min: 0, default: '0', label: 'Minimum net loss to qualify' },
  loss_bonus_max: { env: 'LOSS_BONUS_MAX', kind: 'decimal', min: 0, default: '0', label: 'Maximum bonus per period (0 = no cap)' },
  loss_bonus_wager_multiplier: { env: 'LOSS_BONUS_WAGER_MULTIPLIER', kind: 'decimal', min: 0, max: 100, default: '1', label: 'Wager before the bonus becomes cash (× bonus; 0 = cash at once)' },
});

/** A pair whose maximum may not sit under its minimum. */
const SETTING_PAIRS = Object.freeze([
  ['casino_min_bet', 'casino_max_bet'],
]);

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
  'lotterygames', 'cards', 'instantgames',
  // providers
  'spribe', 'evolution', 'pragmaticslots', 'pragmaticlive', 'ideal', 'microgaming',
  'pgsoft', 'hacksawgaming', 'jili', 'jilli', 'netent',
  // currencies offered
  'inr', 'mvr', 'aed', 'pkr', 'bdt', 'npr', 'eur', 'cryptocoin',
  'btc', 'eth', 'ltc', 'bch', 'usdt', 'trx', 'doge', 'ada', 'xrp', 'bnb',
  'usdp', 'nexo', 'mkr', 'tusd', 'usdc', 'busd', 'shib', 'matic', 'nc', 'sc',
  // (no 'bjb': a retired coin is never offered — RETIRED_CURRENCIES in common)
  // home page sections
  'home_heroSection', 'home_welcomebanner', 'home_latestwins', 'home_livecasino',
  'home_gamingcards', 'home_popularslots', 'home_bonus500banner', 'home_crashgames',
  'home_paymentbanner', 'home_leaderboard', 'home_promocards', 'home_livesports',
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
// `sports` is the owner's kill switch now (owner panel → Site flags → Sports), not the site admin's.
const OPERATOR_FLAGS = Object.freeze([...PUBLIC_FLAGS]);

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
  constructor({ models, db, logger, config, clients = null }) {
    /** Service clients, when the caller has them — `pushPublic` needs `clients.user`. */
    this.clients = clients;
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
    const row = await this.#configRow([
      'id',
      ...Object.values(AFFILIATE_FIELDS),
      ...Object.values(AFFILIATE_CURRENCY_FIELDS),
      'register_bonus_enabled',
      'affiliate_bonus_requires_deposit',
    ]);

    // No config row is a real state on a fresh install, and legacy reported
    // zeros for it rather than erroring. Kept, so the screen renders.
    const [rewardCurrency, unlocks, rates] = await Promise.all([
      this.rewardCurrency(),
      this.#storedReferralUnlocks(),
      this.#storedCommissionRates(),
    ]);
    return {
      // hash.game's formula (migration 134): commission = wager × 1% × commissionRate% × gameRates[category]%.
      commissionRate: rates.commissionRate,
      gameRates: rates.gameRates,
      // The referral unlock table PAYS now (user-service tier unlock), not only displays.
      referralUnlocks: unlocks.tiers,
      affiliateBonus: this.#amount(row?.affiliatebonus),
      commissionPercent: this.#amount(row?.comissionpercent),
      registerBonus: this.#amount(row?.registerbonus),
      // The switch (migration 070). Off pays nobody, whatever amount is stored.
      registerBonusEnabled: Boolean(row?.register_bonus_enabled),
      // Migration 072: the referrer's joining bonus waits for the referee's
      // first credited deposit (anti sign-up farming). ON unless switched off.
      affiliateBonusRequiresDeposit: row ? row.affiliate_bonus_requires_deposit !== false : true,
      // Not read from the row: every reward pays in the site's ONE reward
      // currency, which the platform owner sets. The amounts above are
      // denominated in it. The columns remain for old readers.
      registerBonusCurrency: rewardCurrency,
      affiliateBonusCurrency: rewardCurrency,
      rewardCurrency,
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
  /** The commission rate + game rates (migration 134); the defaults before it ran. */
  async #storedCommissionRates() {
    try {
      const [row] = await this.models.Siteconfig.sequelize.query(
        'SELECT affiliate_commission_rate, affiliate_game_rates FROM siteconfig ORDER BY id ASC LIMIT 1',
        { type: this.models.Siteconfig.sequelize.QueryTypes.SELECT }
      );
      const stored = typeof row?.affiliate_game_rates === 'string' ? JSON.parse(row.affiliate_game_rates) : row?.affiliate_game_rates;
      const gameRates = {};
      for (const [key, fallback] of Object.entries(GAME_RATE_DEFAULTS)) {
        const v = stored?.[key];
        gameRates[key] = v != null && /^\d+(\.\d+)?$/.test(String(v)) ? String(Number(v)) : fallback;
      }
      const rate = row?.affiliate_commission_rate;
      return { commissionRate: rate != null ? String(Number(rate)) : COMMISSION_RATE_DEFAULT, gameRates };
    } catch (error) {
      if (!isUndefinedColumn(error)) throw error;
      return { commissionRate: COMMISSION_RATE_DEFAULT, gameRates: { ...GAME_RATE_DEFAULTS } };
    }
  }

  async updateAffiliateSettings({ staffId = null, commissionRate, gameRates, ...input }) {
    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    if (commissionRate !== undefined || gameRates !== undefined) {
      const current = await this.#storedCommissionRates();
      try {
        await this.models.Siteconfig.sequelize.query(
          `UPDATE siteconfig SET affiliate_commission_rate = :rate, affiliate_game_rates = CAST(:games AS jsonb), updatedat = now() WHERE id = :id`,
          {
            replacements: {
              id: row.id,
              rate: commissionRate ?? current.commissionRate,
              games: JSON.stringify({ ...current.gameRates, ...(gameRates ?? {}) }),
            },
          }
        );
      } catch (error) {
        if (isUndefinedColumn(error)) throw errors.MIGRATION_PENDING({ migration: '134-affiliate-game-rates' });
        throw error;
      }
    }

    const patch = { updatedat: new Date() };
    for (const [name, column] of Object.entries(AFFILIATE_FIELDS)) {
      if (input[name] !== undefined) patch[column] = input[name];
    }
    if (input.affiliateBonusRequiresDeposit !== undefined) {
      patch.affiliate_bonus_requires_deposit = Boolean(input.affiliateBonusRequiresDeposit);
    }
    const rewardCurrency = await this.rewardCurrency();
    for (const [name, column] of Object.entries(AFFILIATE_CURRENCY_FIELDS)) {
      if (input[name] === undefined) continue;
      // These bonuses pay in the site's reward currency (owner-set). A body
      // naming another coin is refused rather than silently ignored.
      if (input[name] !== rewardCurrency) throw errors.REWARD_CURRENCY_FIXED({ field: name, rewardCurrency });
      patch[column] = rewardCurrency;
    }

    await this.models.Siteconfig.update(patch, { where: { id: row.id } });

    this.logger?.info(
      { staffId, configId: row.id, changed: Object.keys(patch).filter((k) => k !== 'updatedat') },
      'Affiliate programme settings changed'
    );

    return this.affiliateSettings();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Welcome bonuses — registration bonus + first-deposit bonus
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Both welcome bonuses, as the Site config screen and user-service read them.
   *
   * The registration bonus is the same `registerbonus` column the affiliate
   * screen edits, plus its on/off switch, paid in the site's reward currency
   * (owner-set, `rewardCurrency()`). The first-deposit bonus is TIERED: the
   * highest tier whose `minDeposit` the deposit (converted into the reward
   * currency) reaches applies, bonus = min(deposit × percent / 100, maxBonus),
   * paid in the reward currency. Tier amounts are denominated in it too
   * (`currency` = `payoutCurrency` = the reward currency).
   */
  /** hash.game's deposit bonus program (migration 136); the old behaviour before it ran. */
  async #storedDepositProgram() {
    const fallback = { mode: 'first', unlockMode: 'rollover', unlockRate: '1', schedule: [] };
    try {
      const [row] = await this.models.Siteconfig.sequelize.query('SELECT deposit_bonus_program FROM siteconfig ORDER BY id ASC LIMIT 1', {
        type: this.models.Siteconfig.sequelize.QueryTypes.SELECT,
      });
      const v = typeof row?.deposit_bonus_program === 'string' ? JSON.parse(row.deposit_bonus_program) : row?.deposit_bonus_program;
      if (!v) return fallback;
      return {
        mode: v.mode === 'monthly' ? 'monthly' : 'first',
        unlockMode: v.unlockMode === 'gradual' ? 'gradual' : 'rollover',
        unlockRate: /^\d+(\.\d+)?$/.test(String(v.unlockRate ?? '')) ? String(v.unlockRate) : '1',
        // In deposit order (1st, 2nd, …), NOT sorted: the Nth deposit of the month gets row N.
        schedule: (Array.isArray(v.schedule) ? v.schedule : []).map((t) => ({
          percent: this.#amount(t?.percent),
          minDeposit: this.#amount(t?.minDeposit),
          maxBonus: this.#amount(t?.maxBonus),
        })),
      };
    } catch (error) {
      if (!isUndefinedColumn(error)) throw error;
      return fallback;
    }
  }

  async welcomeBonusSettings() {
    const row = await this.#configRow(['id', ...Object.values(WELCOME_FIELDS)]);
    const multiplier = row?.first_deposit_bonus_wager_multiplier;
    const [rewardCurrency, depositProgram] = await Promise.all([this.rewardCurrency(), this.#storedDepositProgram()]);
    return {
      /**
       * hash.game "Monthly Deposit Bonus" (migration 136): `mode` 'monthly' pays the Nth deposit of
       * the calendar month (UTC) `schedule[N-1]`; 'first' keeps the first-deposit tiers below.
       * `unlockMode` 'gradual' = locked, unlocking `wager × contribution × house edge × unlockRate%`
       * per bet, claimable any time. On/off is `firstDepositBonus.enabled` either way.
       */
      depositProgram,
      rewardCurrency,
      registerBonus: {
        enabled: Boolean(row?.register_bonus_enabled),
        amount: this.#amount(row?.registerbonus),
        currency: rewardCurrency,
      },
      firstDepositBonus: {
        enabled: Boolean(row?.first_deposit_bonus_enabled),
        // Tier amounts (minDeposit, maxBonus) are denominated in the reward
        // currency, like every operator-entered reward amount; user-service
        // converts the deposit into it (rewardMoney.toReward) before comparing.
        currency: rewardCurrency,
        payoutCurrency: rewardCurrency,
        tiers: this.#tiers(row?.first_deposit_bonus_tiers),
        wagerMultiplier: multiplier == null ? null : Number(multiplier),
        expiryDays: Number(row?.first_deposit_bonus_expiry_days ?? 30),
      },
      configured: Boolean(row),
    };
  }

  /** A patch: any field left out keeps its stored value. `tiers` replaces the list. */
  async updateWelcomeBonusSettings({ registerBonus, firstDepositBonus, depositProgram, staffId = null }) {
    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    if (depositProgram !== undefined) {
      const next = { ...(await this.#storedDepositProgram()), ...depositProgram };
      try {
        await this.models.Siteconfig.sequelize.query(
          'UPDATE siteconfig SET deposit_bonus_program = CAST(:v AS jsonb), updatedat = now() WHERE id = :id',
          { replacements: { id: row.id, v: JSON.stringify(next) } }
        );
      } catch (error) {
        if (isUndefinedColumn(error)) throw errors.MIGRATION_PENDING({ migration: '136-gradual-bonus-unlock' });
        throw error;
      }
    }

    const patch = { updatedat: new Date() };
    const put = (column, value) => {
      if (value !== undefined) patch[column] = value;
    };
    put('register_bonus_enabled', registerBonus?.enabled);
    put('registerbonus', registerBonus?.amount);
    put('first_deposit_bonus_enabled', firstDepositBonus?.enabled);
    if (firstDepositBonus?.tiers !== undefined) patch.first_deposit_bonus_tiers = this.#tiers(firstDepositBonus.tiers);
    put('first_deposit_bonus_wager_multiplier', firstDepositBonus?.wagerMultiplier);
    put('first_deposit_bonus_expiry_days', firstDepositBonus?.expiryDays);

    await this.models.Siteconfig.update(patch, { where: { id: row.id } });

    this.logger?.info(
      { staffId, configId: row.id, changed: Object.keys(patch).filter((k) => k !== 'updatedat') },
      'Welcome bonus settings changed'
    );

    await this.pushPublic();

    return this.welcomeBonusSettings();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  VIP reward formula (migration 137) — hash.game's rakeback + daily/weekly/monthly
  // ══════════════════════════════════════════════════════════════════════

  async rewardFormula() {
    const defaults = { mode: 'hash', instant: '10', daily: '4', weeklyWager: '4', weeklyLoss: '1', monthlyWager: '3.5', monthlyLoss: '1.5' };
    try {
      const [row] = await this.models.Siteconfig.sequelize.query('SELECT vip_reward_formula FROM siteconfig ORDER BY id ASC LIMIT 1', {
        type: this.models.Siteconfig.sequelize.QueryTypes.SELECT,
      });
      const v = typeof row?.vip_reward_formula === 'string' ? JSON.parse(row.vip_reward_formula) : row?.vip_reward_formula;
      const out = { ...defaults };
      if (v?.mode === 'fixed') out.mode = 'fixed';
      for (const k of Object.keys(defaults)) if (k !== 'mode' && /^\d+(\.\d+)?$/.test(String(v?.[k] ?? ''))) out[k] = String(v[k]);
      return out;
    } catch (error) {
      if (!isUndefinedColumn(error)) throw error;
      return { ...defaults, mode: 'fixed' };
    }
  }

  async updateRewardFormula({ staffId = null, ...patch }) {
    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();
    const next = { ...(await this.rewardFormula()), ...patch };
    try {
      await this.models.Siteconfig.sequelize.query('UPDATE siteconfig SET vip_reward_formula = CAST(:v AS jsonb), updatedat = now() WHERE id = :id', {
        replacements: { id: row.id, v: JSON.stringify(next) },
      });
    } catch (error) {
      if (isUndefinedColumn(error)) throw errors.MIGRATION_PENDING({ migration: '137-vip-reward-formula' });
      throw error;
    }
    this.logger?.info({ staffId, ...patch }, 'VIP reward formula changed');
    return this.rewardFormula();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Wager contribution (migration 135) — hash.game's per-game bonus contribution
  // ══════════════════════════════════════════════════════════════════════

  async wagerContribution() {
    try {
      const rows = await this.models.Siteconfig.sequelize.query(
        `SELECT category, provider, game_ref, percent FROM wager_contribution
          ORDER BY (category IS NULL), category, (provider IS NULL), provider, game_ref`,
        { type: this.models.Siteconfig.sequelize.QueryTypes.SELECT }
      );
      return {
        rules: rows.map((r) => ({ category: r.category, provider: r.provider, gameRef: r.game_ref, percent: String(Number(r.percent)) })),
        stored: true,
      };
    } catch (error) {
      if (!/wager_contribution/.test(String(error?.message))) throw error;
      return { rules: [], stored: false };
    }
  }

  async updateWagerContribution({ rules, staffId = null }) {
    const sequelize = this.models.Siteconfig.sequelize;
    const clean = (v) => (v == null || v === '' ? null : String(v).trim().toLowerCase());
    await sequelize.transaction(async (transaction) => {
      await sequelize.query('DELETE FROM wager_contribution', { transaction });
      const seen = new Set();
      for (const r of rules) {
        const row = { category: clean(r.category), provider: clean(r.provider), gameRef: clean(r.gameRef), percent: r.percent };
        const key = `${row.category}|${row.provider}|${row.gameRef}`;
        if (seen.has(key)) continue; // a duplicate rule: the first one stands
        seen.add(key);
        await sequelize.query(
          'INSERT INTO wager_contribution (category, provider, game_ref, percent) VALUES (:category, :provider, :gameRef, :percent)',
          { replacements: row, transaction }
        );
      }
    });
    this.logger?.info({ staffId, rules: rules.length }, 'Wager contribution rules replaced');
    return this.wagerContribution();
  }

  /** Tiers as exact decimal strings, lowest minimum first; junk rows dropped. */
  #tiers(value) {
    const list = Array.isArray(value) ? value : [];
    const out = [];
    for (const t of list) {
      try {
        const tier = {
          minDeposit: this.#amount(t?.minDeposit),
          percent: this.#amount(t?.percent),
          maxBonus: this.#amount(t?.maxBonus),
        };
        if (money.gt(tier.percent, '0')) out.push(tier);
      } catch {
        // A row that is not a decimal is not a tier.
      }
    }
    return out.sort((a, b) => money.compare(a.minDeposit, b.minDeposit));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Tip limits — peer-to-peer tip caps (migration 081)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The operator's tip limits, as the Tips screen and user-service read them.
   * All USD (user-service converts each tip through `exchangerate`); "0" on a
   * max = no cap, "0" on the wager requirement = off.
   *
   * Raw SQL on the three named columns rather than `Siteconfig` attributes: the
   * columns are added by migration 081 and the shared model file is not
   * touched for them. Column names come from `TIP_LIMIT_FIELDS`, never input.
   */
  async tipSettings() {
    const columns = Object.values(TIP_LIMIT_FIELDS).join(', ');
    const [row] = await this.models.Siteconfig.sequelize.query(
      `SELECT id, ${columns} FROM siteconfig ORDER BY id ASC LIMIT 1`,
      { type: this.models.Siteconfig.sequelize.QueryTypes.SELECT }
    );
    const out = {};
    for (const [name, column] of Object.entries(TIP_LIMIT_FIELDS)) {
      out[name] = this.#amount(row?.[column] ?? TIP_LIMIT_DEFAULTS[name]);
    }
    return { ...out, currency: 'USD', configured: Boolean(row) };
  }

  /** A patch: any field left out keeps its stored value. */
  async updateTipSettings({ staffId = null, ...input }) {
    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    const sets = [];
    const replacements = { id: row.id };
    for (const [name, column] of Object.entries(TIP_LIMIT_FIELDS)) {
      if (input[name] === undefined) continue;
      sets.push(`${column} = :${name}`);
      replacements[name] = this.#amount(input[name]);
    }
    if (!sets.length) throw errors.NOTHING_TO_UPDATE();

    await this.models.Siteconfig.sequelize.query(
      `UPDATE siteconfig SET ${sets.join(', ')}, updatedat = now() WHERE id = :id`,
      { replacements }
    );

    this.logger?.info(
      { staffId, configId: row.id, changed: Object.keys(input).filter((k) => input[k] !== undefined) },
      'Tip limits changed'
    );

    return this.tipSettings();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Referral unlock tiers — the /referral/rules table (migration 106)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The tier list as stored, or the shipped defaults when there is no row or
   * the column is not there yet (migration 106 not run). Raw SQL for the same
   * reason as `tipSettings()`: the shared model file is not touched for it.
   * A missing column must not take `publicSettings()` — every first paint —
   * down with it, so that one error reads as "defaults".
   */
  async #storedReferralUnlocks() {
    try {
      const [row] = await this.models.Siteconfig.sequelize.query(
        `SELECT id, ${REFERRAL_UNLOCK_COLUMN} FROM siteconfig ORDER BY id ASC LIMIT 1`,
        { type: this.models.Siteconfig.sequelize.QueryTypes.SELECT }
      );
      if (!row) return { tiers: this.#unlockTiers(REFERRAL_UNLOCK_DEFAULTS), configured: false, stored: false };
      const value = row[REFERRAL_UNLOCK_COLUMN];
      return {
        tiers: this.#unlockTiers(typeof value === 'string' ? JSON.parse(value) : value),
        configured: true,
        stored: true,
      };
    } catch (error) {
      if (!isUndefinedColumn(error)) throw error;
      this.logger?.warn(`siteconfig.${REFERRAL_UNLOCK_COLUMN} is missing — run migration 106; serving the defaults`);
      return { tiers: this.#unlockTiers(REFERRAL_UNLOCK_DEFAULTS), configured: true, stored: false };
    }
  }

  /**
   * The referral unlock table, as the Affiliate rates screen reads it.
   * `totalWager` and `unlockAmount` are denominated in the site's reward
   * currency (`currency`), like every other operator-entered reward amount.
   * `stored: false` = the column is missing and these are the defaults.
   */
  async referralUnlockSettings() {
    const [stored, rewardCurrency] = await Promise.all([this.#storedReferralUnlocks(), this.rewardCurrency()]);
    return { ...stored, currency: rewardCurrency, rewardCurrency, maxTiers: REFERRAL_UNLOCK_MAX };
  }

  /** Replaces the whole list (the validator has already checked each row). */
  async updateReferralUnlockSettings({ tiers, staffId = null }) {
    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    const list = this.#unlockTiers(tiers);
    try {
      await this.models.Siteconfig.sequelize.query(
        `UPDATE siteconfig SET ${REFERRAL_UNLOCK_COLUMN} = CAST(:tiers AS jsonb), updatedat = now() WHERE id = :id`,
        { replacements: { id: row.id, tiers: JSON.stringify(list) } }
      );
    } catch (error) {
      if (isUndefinedColumn(error)) throw errors.MIGRATION_PENDING({ migration: '106-referral-unlock-tiers' });
      throw error;
    }

    this.logger?.info({ staffId, configId: row.id, tiers: list.length }, 'Referral unlock tiers changed');

    await this.pushPublic();

    return this.referralUnlockSettings();
  }

  /** Rows as exact decimal strings, lowest wager first; junk rows dropped. */
  #unlockTiers(value) {
    const list = Array.isArray(value) ? value : [];
    const out = [];
    for (const t of list) {
      try {
        const level = String(t?.level ?? '').replace(/\s+/g, ' ').trim();
        if (!level) continue;
        out.push({ level, totalWager: this.#amount(t?.totalWager), unlockAmount: this.#amount(t?.unlockAmount) });
      } catch {
        // A row that is not a decimal is not a tier.
      }
    }
    return out.sort((a, b) => money.compare(a.totalWager, b.totalWager)).slice(0, REFERRAL_UNLOCK_MAX);
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
    // Absent config reads as ON: a missing row is an unconfigured deployment, not an operator
    // switching sports off.
    const enabled = row ? Boolean(row.sports) : true;
    // Effective = the owner's flag (owner panel → Site flags → Sports) AND the Super Admin's
    // switch (Sports Exchange → Sports switch). sports-service reads `sportsEnabled` from here.
    const doc = await entitlements.getEntitlements();
    const entitled = entitlements.flagOnIn(doc, 'sports');
    // The exchange takes bets only in exchange mode: with the owner's sportsbook on, sports-service
    // refuses new exchange bets (open ones still settle), as the kill switch does.
    const mode = entitlements.flagOnIn(doc, 'sportsbook') ? 'sportsbook' : entitlements.flagOnIn(doc, 'sportsexchange') ? 'exchange' : 'off';
    return { sportsEnabled: enabled && entitled && mode === 'exchange', enabled, entitled, mode, configured: Boolean(row) };
  }

  /** The Super Admin's sports switch. Pushes the new flags so every open site hides/shows sports. */
  async setSportsEnabled({ enabled, staffId = null }) {
    if (enabled) await this.#assertFlagsEntitled(['sports']);
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

    await this.pushPublic();

    return this.sportsEnabled();
  }

  /**
   * Settings → Payment Methods: the gateways the owner has on (owner panel → Site flags →
   * Payment gateways, missing = on), each with the Super Admin's own switch. Effective = both on;
   * user-service reads the Super Admin's side as `payment_gateways_off` (internal `/settings`).
   */
  async paymentGateways() {
    const [off, { flags }, methods] = await Promise.all([
      this.paymentGatewaysOff(),
      entitlements.getEntitlements(),
      // Every method the owner has on, for the gateways the owner switches per currency — one query.
      this.models.PaymentMethod
        ? this.models.PaymentMethod.findAll({ where: { owner_enabled: true }, order: [['id', 'ASC']], raw: true })
        : [],
    ]);
    const shown = [];
    for (const gateway of PAYMENT_GATEWAYS) {
      if (flags[`gateway_${gateway.name}`] === false) continue;
      // Only the currencies the owner has on, with their methods — shown to the Super Admin, not switched.
      const currencies = (gateway.currencies ?? [])
        .filter((c) => flags[c.key] !== false)
        .map((c) => ({
          ...c,
          methods: methods
            .filter((m) => m.gateway === gateway.name && m.currency === c.code)
            .map((m) => ({ id: Number(m.id), code: m.code })),
        }));
      shown.push({ ...gateway, enabled: !off.includes(gateway.name), ...(gateway.currencies ? { currencies } : {}) });
    }
    return shown;
  }

  /** The gateways the Super Admin switched off (`siteconfig.settings.payment_gateways_off`). */
  async paymentGatewaysOff() {
    const row = await this.#configRow(['id', 'settings']);
    return Array.isArray(row?.settings?.payment_gateways_off) ? row.settings.payment_gateways_off : [];
  }

  /**
   * The Super Admin's ON / OFF for one gateway (`apay`, `f2pay`), with the transaction password. One
   * the owner has off cannot be touched (NOT_ENTITLED).
   */
  async setPaymentGateway({ name, enabled, staffId = null, executiveId = null, transactionPassword }) {
    await assertTransactionPassword(this.models, staffId, transactionPassword, { required: true, executiveId });
    await this.#assertFlagsEntitled([`gateway_${name}`]);
    const row = await this.#configRow(['id', 'settings']);
    if (!row) throw errors.NOT_CONFIGURED();

    const off = new Set(Array.isArray(row.settings?.payment_gateways_off) ? row.settings.payment_gateways_off : []);
    if (enabled) off.delete(name);
    else off.add(name);
    await this.models.Siteconfig.update(
      { settings: { ...(row.settings ?? {}), payment_gateways_off: [...off] }, updatedat: new Date() },
      { where: { id: row.id } }
    );

    this.logger?.warn({ staffId, gateway: name, enabled }, `Payment gateway ${name} switched ${enabled ? 'ON' : 'OFF'} by the Super Admin`);
    return this.paymentGateways();
  }

  /** Every `payment_methods` row, for the owner panel's methods editor (owner-key read). */
  async ownerPaymentMethods() {
    const rows = this.models.PaymentMethod ? await this.models.PaymentMethod.findAll({ order: [['id', 'ASC']], raw: true }) : [];
    return rows.map((m) => ({
      gateway: m.gateway, currency: m.currency, code: m.code,
      ownerEnabled: m.owner_enabled, siteEnabled: m.site_enabled, addedBy: m.added_by,
    }));
  }

  /**
   * The owner document's `paymentMethods` → `payment_methods`: a method the owner lists is added
   * (`added_by 'owner'`) or set to its `active` (`owner_enabled`). One the owner added and no longer
   * lists goes off; a site-added one the owner does not list is on (missing = on). A default document
   * (no owner reachable) changes nothing. Few rows, so one read and at most a handful of writes.
   */
  async applyOwnerPaymentMethods(doc) {
    if (!this.models.PaymentMethod || !doc || doc.source === 'default') return;
    const rows = await this.models.PaymentMethod.findAll({ raw: true });
    const keyOf = (gateway, currency, code) => `${gateway}|${currency}|${code}`;
    const byKey = new Map(rows.map((r) => [keyOf(r.gateway, r.currency, r.code), r]));
    const listed = new Set();

    for (const [gateway, currencies] of Object.entries(doc.paymentMethods ?? {})) {
      for (const [currency, methods] of Object.entries(currencies)) {
        for (const { code, active } of methods) {
          const key = keyOf(gateway, currency, code);
          listed.add(key);
          const row = byKey.get(key);
          if (!row) await this.models.PaymentMethod.create({ gateway, currency, code, owner_enabled: active, added_by: 'owner', updated_by: 'owner' });
          else if (row.owner_enabled !== active) await this.models.PaymentMethod.update({ owner_enabled: active, updated_by: 'owner' }, { where: { id: row.id } });
        }
      }
    }

    const unlisted = rows.filter((r) => !listed.has(keyOf(r.gateway, r.currency, r.code)));
    const off = unlisted.filter((r) => r.added_by === 'owner' && r.owner_enabled).map((r) => r.id);
    const on = unlisted.filter((r) => r.added_by !== 'owner' && !r.owner_enabled).map((r) => r.id);
    if (off.length) await this.models.PaymentMethod.update({ owner_enabled: false, updated_by: 'owner' }, { where: { id: off } });
    if (on.length) await this.models.PaymentMethod.update({ owner_enabled: true, updated_by: 'owner' }, { where: { id: on } });
  }

  /**
   * THE reward currency — the one coin every reward is calculated and paid in
   * (VIP, periodic bonuses, rakeback, affiliate, spin wheel, races, welcome
   * bonuses, redeem codes). The platform owner sets it in the owner panel
   * (the `reward_currency` policy); the entitlement pull writes it into
   * `site_features` (`updated_by 'owner'`). Nothing stored, or a value that is
   * not an allowed choice → USDT (`rewardCurrencyOf`).
   *
   * Not cached here: one primary-key read. user-service caches its copy 5 s.
   */
  async rewardCurrency() {
    if (typeof this.models.SiteFeature?.findByPk !== 'function') return rewardCurrencyOf(null);
    const row = await this.models.SiteFeature.findByPk(REWARD_CURRENCY_FEATURE, { attributes: ['variant'], raw: true });
    return rewardCurrencyOf(row?.variant);
  }

  /**
   * The site's DEFAULT COIN — what every money screen opens on before anybody
   * picks a currency (site admin Finance filters, the player's deposit dialog).
   * The platform owner sets it (the `default_currency` policy); the
   * entitlement pull writes it into `site_features`. Nothing stored, or a
   * value that is not an allowed choice → USDT (`defaultCurrencyOf`).
   */
  async defaultCurrency() {
    if (typeof this.models.SiteFeature?.findByPk !== 'function') return defaultCurrencyOf(null);
    const row = await this.models.SiteFeature.findByPk(DEFAULT_CURRENCY_FEATURE, { attributes: ['variant'], raw: true });
    return defaultCurrencyOf(row?.variant);
  }

  /**
   * The default coin as a browser is told it: the owner's choice while the
   * registry has it on, else the first coin in the registry's order that is on
   * and is an allowed choice. The stored value is untouched, so switching the
   * coin back on restores it. A registry outage serves the stored choice.
   */
  async #publicDefaultCurrency() {
    const chosen = await this.defaultCurrency();
    if (await currencyRegistry.isEnabled(chosen)) return chosen;
    const fallback = (await currencyRegistry.listCurrencies())
      .find((c) => c.enabled !== false && isDefaultCurrencyChoice(c.code));
    return fallback?.code ?? chosen;
  }

  /** True when an owner panel manages this site (same rule as FeaturesService.ownerManaged). */
  #ownerManaged() {
    return Boolean(this.config?.OWNER_SHARED_SECRET);
  }

  /**
   * The reward currency, for user-service (`/internal/admin/site-config/rewards`)
   * and the staff screens (`GET /admin/site-config/rewards`).
   *
   * `bonusCurrency` / `rakebackCurrency` are kept for older readers and always
   * equal `rewardCurrency` — the old `siteconfig.bonus_currency` /
   * `rakeback_currency` columns no longer choose a payout wallet.
   */
  async rewardCurrencies() {
    const rewardCurrency = await this.rewardCurrency();
    const managed = this.#ownerManaged();
    return {
      rewardCurrency,
      name: REWARD_CURRENCY_NAMES[rewardCurrency] ?? rewardCurrency,
      bonusCurrency: rewardCurrency,
      rakebackCurrency: rewardCurrency,
      managedBy: managed ? 'owner' : null,
      configured: true,
    };
  }

  /**
   * Staff change of the reward currency (`PUT /admin/site-config/rewards`).
   *
   * Owner-managed site (`OWNER_SHARED_SECRET` set): any CHANGE is
   * `403 OWNER_MANAGED { feature: 'reward_currency' }` — only the owner panel
   * sets it. Repeating the current value is not a change. Without an owner
   * panel (the hub default) staff may still set it; it is written to the same
   * `site_features` row the owner would write.
   */
  async updateRewardCurrencies({ rewardCurrency, bonusCurrency, rakebackCurrency, staffId = null }) {
    const asked = [rewardCurrency, bonusCurrency, rakebackCurrency].filter((c) => c !== undefined);
    const wanted = rewardCurrencyOf(asked[0]);
    if (asked.some((c) => rewardCurrencyOf(c) !== wanted)) {
      throw errors.REWARD_CURRENCY_FIXED({ field: 'bonusCurrency/rakebackCurrency', rewardCurrency: wanted });
    }

    const current = await this.rewardCurrency();
    if (wanted === current) return this.rewardCurrencies();
    if (this.#ownerManaged()) throw ownerErrors.MANAGED({ feature: REWARD_CURRENCY_FEATURE });

    const [row, created] = await this.models.SiteFeature.findOrCreate({
      where: { feature: REWARD_CURRENCY_FEATURE },
      defaults: { feature: REWARD_CURRENCY_FEATURE, enabled: true, variant: wanted, updated_by: staffId ? `staff:${staffId}` : 'staff' },
    });
    if (!created) await row.update({ enabled: true, variant: wanted, updated_by: staffId ? `staff:${staffId}` : 'staff' });

    this.logger?.info({ staffId, from: current, to: wanted }, 'Reward currency changed');
    await this.pushPublic();
    return this.rewardCurrencies();
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
    const row = await this.#configRow([
      'id',
      'sports',
      ...PUBLIC_FLAGS,
      ...PUBLIC_AMOUNTS,
      ...Object.values(AFFILIATE_CURRENCY_FIELDS),
      ...Object.values(WELCOME_FIELDS),
      'affiliate_bonus_requires_deposit',
    ]);

    // Absent config reads as ON, matching `sportsEnabled()`: a missing row is
    // an unconfigured deployment, not an operator switching the site off. The
    // client defaults the same way, so first paint does not flicker.
    // A flag outside the owner's plan reads as off; the stored value is kept.
    const planDoc = await entitlements.getEntitlements();
    const { flags: plan } = planDoc;
    const flags = Object.fromEntries(
      PUBLIC_FLAGS.map((name) => [name, plan[name] !== false && (row ? Boolean(row[name]) : true)])
    );
    // Read-only here so a browser can hide sports. Same rule as `sportsEnabled()`: owner flag
    // AND the Super Admin's switch.
    flags.sports = plan.sports !== false && (row ? Boolean(row.sports) : true);
    // Which sports the site runs (owner panel → Products): the third-party book in an iframe, or
    // our exchange. Never both; `flagOnIn` closes the exchange while the sportsbook is on.
    flags.sportsbook = flags.sports && entitlements.flagOnIn(planDoc, 'sportsbook');
    flags.sportsexchange = flags.sports && entitlements.flagOnIn(planDoc, 'sportsexchange');
    // The owner's Demo login switch: the player site draws the Demo button only while it is on.
    flags.demo_login = entitlements.flagOnIn(planDoc, 'demo_login');

    const amounts = Object.fromEntries(
      PUBLIC_AMOUNTS.map((name) => [name, this.#amount(row?.[name])])
    );
    // A switched-off registration bonus is not advertised: the stored amount is
    // kept for the admin, but a browser reads what a new player would get.
    const registerBonusEnabled = Boolean(row?.register_bonus_enabled);
    if (!registerBonusEnabled) amounts.registerbonus = this.#amount('0');

    // What the site may promise a new player. Only the terms when it is on.
    const tiers = this.#tiers(row?.first_deposit_bonus_tiers);
    const [rewardCurrency, defaultCurrency, referralUnlocks, rates] = await Promise.all([
      this.rewardCurrency(),
      this.#publicDefaultCurrency(),
      this.#storedReferralUnlocks(),
      this.#storedCommissionRates(),
    ]);
    const firstDepositBonus = row?.first_deposit_bonus_enabled && tiers.length
      ? { enabled: true, currency: rewardCurrency, payoutCurrency: rewardCurrency, tiers }
      : { enabled: false };

    // What the site promises is what user-service pays: the owner's ONE
    // reward currency, so a browser can label every reward amount with it.
    return {
      ...flags,
      ...amounts,
      registerBonusEnabled,
      // A browser can say "your friend must deposit" next to the joining bonus.
      affiliateBonusRequiresDeposit: row ? row.affiliate_bonus_requires_deposit !== false : true,
      firstDepositBonus,
      // The /referral/rules table (migration 106): friend's VIP level, the
      // total wager that reaches it, and what the referrer unlocks there —
      // amounts in the reward currency. Display terms only.
      referralUnlocks: { currency: rewardCurrency, tiers: referralUnlocks.tiers },
      // The /referral/rules rate boxes and calculator (migration 134): percent
      // strings, the defaults until it runs. Display terms only.
      commissionRate: rates.commissionRate,
      gameRates: rates.gameRates,
      rewardCurrency,
      registerBonusCurrency: rewardCurrency,
      affiliateBonusCurrency: rewardCurrency,
      // The owner's default coin: what a money screen opens on (admin Finance
      // filters, the player's deposit dialog) until somebody picks another.
      defaultCurrency,
      configured: Boolean(row),
    };
  }

  /**
   * Push the public view down every player socket.
   *
   * ── WHY A CALL TO USER-SERVICE, NOT AN EMIT ──────────────────────────
   *
   * The player sockets are on user-service and there is no cross-process
   * Socket.IO adapter, so an emit from here reaches nobody. user-service's
   * `POST /internal/user/preferences/site-config` emits what it is given —
   * and what it is given is `publicSettings()`, the same allow-list the HTTP
   * route serves, so the socket can never carry more than the GET does.
   *
   * Best effort: the write has already happened and is the truth; a push that
   * fails is logged, and the next page load reads the row. It must never turn
   * a successful save into a 500.
   *
   * @param {{ features?: Array }} [extra] the public feature list, when the
   *   caller changed it (the features service passes `publicList()`).
   */
  async pushPublic({ features, currencies } = {}) {
    const client = this.clients?.user;
    if (!client) return { pushed: false, reason: 'no user-service client' };
    try {
      const flags = await this.publicSettings();
      const result = await client.post('/internal/user/preferences/site-config', {
        flags,
        ...(features ? { features } : {}),
        ...(currencies ? { currencies } : {}),
      });
      return { pushed: true, ...(result?.data ?? {}) };
    } catch (error) {
      this.logger?.warn({ err: error.message }, 'Could not push site config to the player sockets');
      return { pushed: false, reason: error.message };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Operator settings — limits, policy, schedule
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Every setting, with where its value came from.
   *
   * `stored` is what the operator saved; `value` is what the services should
   * act on, which is the stored value when there is one and the deployed
   * environment variable when there is not. The screen shows both, so nobody
   * has to guess whether a number is theirs or the deployment's.
   */
  async operatorSettings() {
    const row = await this.#configRow(['id', 'settings']);
    const stored = row?.settings ?? {};

    return Object.entries(OPERATOR_SETTINGS).map(([key, spec]) => {
      // `process.env` FIRST: these variables belong to casino-, sports- and
      // user-service, so admin-service's typed config does not declare them —
      // but every service reads the one `.env`, which is where they are.
      const envValue = process.env[spec.env] ?? this.config?.[spec.env];
      const has = Object.prototype.hasOwnProperty.call(stored, key) && stored[key] !== null;
      return {
        key,
        label: spec.label,
        kind: spec.kind,
        env: spec.env,
        envValue: envValue === undefined ? null : String(envValue),
        stored: has ? stored[key] : null,
        // `default`: the value with nothing stored and no env (idle_logout and the bonus settings).
        value: has ? stored[key] : (envValue === undefined ? spec.default ?? null : envValue),
        source: has ? 'operator' : 'environment',
        ...(spec.min !== undefined ? { min: spec.min } : {}),
        ...(spec.max !== undefined ? { max: spec.max } : {}),
        ...(spec.maxLength !== undefined ? { maxLength: spec.maxLength } : {}),
      };
    });
  }

  /**
   * Save a patch. A key the table does not name is refused rather than stored:
   * this column is a set of decisions, not a bag.
   *
   * `null` CLEARS a setting, which is how an operator hands one back to the
   * deployment rather than pinning today's value forever.
   */
  async updateOperatorSettings({ patch, staffId }) {
    const row = await this.#configRow(['id', 'settings']);
    const next = { ...(row?.settings ?? {}) };

    for (const [key, raw] of Object.entries(patch ?? {})) {
      const spec = OPERATOR_SETTINGS[key];
      if (!spec) throw errors.UNKNOWN_SETTING({ setting: key });
      if (raw === null) {
        delete next[key];
        continue;
      }
      next[key] = coerceSetting(key, spec, raw);
    }

    for (const [minKey, maxKey] of SETTING_PAIRS) {
      const lo = Number(next[minKey] ?? process.env[OPERATOR_SETTINGS[minKey].env] ?? this.config?.[OPERATOR_SETTINGS[minKey].env]);
      const hi = Number(next[maxKey] ?? process.env[OPERATOR_SETTINGS[maxKey].env] ?? this.config?.[OPERATOR_SETTINGS[maxKey].env]);
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > 0 && lo > hi) {
        throw errors.INVALID_SETTING({ setting: maxKey, reason: `${maxKey} (${hi}) is below ${minKey} (${lo})` });
      }
    }

    if (row) await this.models.Siteconfig.update({ settings: next }, { where: { id: row.id } });
    else await this.models.Siteconfig.create({ settings: next });

    this.logger?.warn({ staffId, settings: Object.keys(patch ?? {}) }, 'Operator settings changed');
    return this.operatorSettings();
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
   * Which operator flags the owner's plan includes, `{ [flag]: boolean }`.
   * Served beside `globalSettings()` (in `meta.entitled`) rather than inside
   * it, so the flag map keeps its `Record<string, boolean>` shape.
   */
  async globalEntitlements() {
    const { flags: plan } = await entitlements.getEntitlements();
    return Object.fromEntries(OPERATOR_FLAGS.map((name) => [name, plan[name] !== false]));
  }

  /** 403 NOT_ENTITLED on the first flag the owner has not put in the plan. */
  async #assertFlagsEntitled(names) {
    if (!names.length) return;
    const { flags: plan } = await entitlements.getEntitlements();
    const refused = names.find((name) => plan[name] === false);
    if (refused) throw errors.NOT_ENTITLED({ kind: 'flag', key: refused });
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

    // Switching OFF is always allowed; switching on needs the owner's plan.
    await this.#assertFlagsEntitled(Object.keys(patch).filter((name) => patch[name] === true));

    const row = await this.#configRow(['id']);
    if (!row) throw errors.NOT_CONFIGURED();

    await this.models.Siteconfig.update(
      { ...patch, updatedat: new Date() },
      { where: { id: row.id } }
    );

    // A coin flag is also the coin's site switch in the registry (migration
    // 061): mirror it, and push the coin list with the flags when one moved.
    // Required here, not at the top: currencies.service requires this file.
    // eslint-disable-next-line global-require
    const { CurrenciesService } = require('../currencies/currencies.service');
    const coins = new CurrenciesService({ models: this.models, logger: this.logger, config: this.config, clients: this.clients });
    const coinsChanged = await coins.syncSiteFlags(patch);

    // Every connected player hears the new flags — see `pushPublic`.
    await this.pushPublic(coinsChanged.length ? { currencies: await coins.publicList() } : {});

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

  /**
   * A player is addressable only from inside the tree that owns them.
   *
   * Same rule as the dashboard, reports and player directory: `visibleStaffIds`
   * widens house staff to the whole back office, and a scope that contains the
   * platform root (staff 1) covers every player, direct signups included.
   * Filtering on `parent_staff_id` alone missed those, so a superadmin got
   * PLAYER_NOT_IN_YOUR_TREE on a direct player's Preferences.
   */
  async #assertPlayerVisible(actor, userId) {
    const staffIds = (await visibleStaffIds(this.models, actor.id, { logger: this.logger })).map(Number);
    const root = Number(this.config?.ROOT_STAFF_ID ?? 1);
    const everyone = staffIds.includes(root);

    const player = await this.models.Users.findOne({
      where: { id: userId, is_demo: false, ...(everyone ? {} : { parent_staff_id: staffIds }) },
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

/** Postgres 42703 — a column the query names does not exist (a migration not run yet). */
function isUndefinedColumn(error) {
  const code = error?.parent?.code ?? error?.original?.code ?? error?.code;
  return code === '42703';
}

/** Minimal escaping — the address is ours, but it still lands in an HTML body. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * One value, checked against what its setting is allowed to be.
 *
 * Money is kept as a STRING — these numbers reach a ledger, and a float is how
 * 0.1 + 0.2 becomes a support ticket. Everything else is narrowed to the type
 * the setting declares, and a value outside its range is refused here rather
 * than at the till.
 */
function coerceSetting(key, spec, raw) {
  if (spec.kind === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 'false') return raw === 'true';
    throw errors.INVALID_SETTING({ setting: key, reason: 'expected true or false' });
  }

  if (spec.kind === 'text') {
    const text = String(raw).trim();
    if (!text) throw errors.INVALID_SETTING({ setting: key, reason: 'empty — use Reset to default instead' });
    if (text.length > spec.maxLength) throw errors.INVALID_SETTING({ setting: key, reason: `longer than ${spec.maxLength} characters` });
    // eslint-disable-next-line no-control-regex
    if (/[<>\u0000-\u0008\u000b-\u001f]/.test(text)) throw errors.INVALID_SETTING({ setting: key, reason: 'no angle brackets or control characters' });
    return text;
  }

  if (spec.kind === 'timezone') {
    const zone = String(raw).trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      throw errors.INVALID_SETTING({ setting: key, reason: `${zone} is not an IANA timezone` });
    }
    return zone;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) throw errors.INVALID_SETTING({ setting: key, reason: 'expected a number' });
  if (spec.min !== undefined && n < spec.min) throw errors.INVALID_SETTING({ setting: key, reason: `below ${spec.min}` });
  if (spec.max !== undefined && n > spec.max) throw errors.INVALID_SETTING({ setting: key, reason: `above ${spec.max}` });
  if (spec.kind === 'number' && !Number.isInteger(n)) throw errors.INVALID_SETTING({ setting: key, reason: 'expected a whole number' });

  // A decimal stays a string all the way to the column; a plain number does not.
  return spec.kind === 'decimal' ? String(raw).trim() : n;
}

module.exports = {
  SiteConfigService, AFFILIATE_FIELDS, OPERATOR_FLAGS, USER_PREFS, OPERATOR_SETTINGS, TIP_LIMIT_FIELDS, TIP_LIMIT_DEFAULTS,
  REFERRAL_UNLOCK_DEFAULTS, REFERRAL_UNLOCK_MAX, PAYMENT_GATEWAYS, PAYMENT_SWITCHES,
};
