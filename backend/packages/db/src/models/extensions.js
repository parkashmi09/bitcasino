'use strict';

const { DataTypes } = require('sequelize');

/**
 * Columns added to baseline tables by migrations.
 *
 * The model files under `core/`, `sports/`, … are generated from
 * `000_baseline_schema.sql` and carry a "do not edit by hand" header, because
 * `npm run db:generate-models` overwrites them. A migration that adds a column
 * to one of those tables therefore has nowhere to declare it: editing the
 * generated file works until the next regeneration silently deletes it, and
 * a model missing a column fails at runtime in the worst possible way — the
 * INSERT succeeds and the column is quietly left null.
 *
 * `extended/` is not the answer either; that directory is for new TABLES.
 *
 * So post-baseline columns live here, applied after registration. One file,
 * reviewable in isolation, and regeneration-proof.
 *
 * Rules:
 *   - every entry names the migration that created the column
 *   - a table that is not loaded (wrong domain for this service) is skipped
 *   - a column the database does not have yet is still declared; the migration
 *     is what creates it, and running the app against an unmigrated database is
 *     a deployment error the migrator already refuses
 */

const EXTENSIONS = {
  // ── migration 004-provably-fair-seeds ────────────────────────────────
  // Added to `userconfig` by migration but never declared, so Sequelize could
  // neither read nor write them: a seed rotation would have appeared to succeed
  // while storing nothing. Found by `node tools/verify-models.js`.
  Userconfig: {
    fair_server_seed: { type: DataTypes.STRING(128), allowNull: true, field: 'fair_server_seed' },
    fair_server_seed_hash: { type: DataTypes.STRING(128), allowNull: true, field: 'fair_server_seed_hash' },
    fair_client_seed: { type: DataTypes.STRING(128), allowNull: true, field: 'fair_client_seed' },
    fair_nonce: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0, field: 'fair_nonce' },
    fair_rotated_at: { type: DataTypes.DATE, allowNull: true, field: 'fair_rotated_at' },
    // ── migration 077-tips ─────────────────────────────────────────────
    // The player's own switch for receiving tips. No row = the default (on).
    tips_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'tips_enabled' },
    // ── migration 169-privacy-preferences (rainbet) ────────────────────
    show_bets_publicly: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'show_bets_publicly' },
    show_statistics: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'show_statistics' },
    tip_notifications: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'tip_notifications' },
    // ── migration 177-userconfig-privacy-email (hash 167)───────────────────────
    hide_gaming_data: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'hide_gaming_data' },
    hide_username: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'hide_username' },
    max_profit_alert: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'max_profit_alert' },
    deposit_email: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'deposit_email' },
    withdraw_email: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'withdraw_email' },
  },

  // ── migration 008-wager-columns ──────────────────────────────────────
  // Legacy created these with an ALTER TABLE run on every request that touched
  // the targetX endpoints, so they never reached the baseline schema.
  Users: {
    // ── migration 180-user-email-verified: when the player proved `email` (deposit_email_verification).
    email_verified_at: { type: DataTypes.DATE, allowNull: true, field: 'email_verified_at' },
    // ── migration 178-player-must-change-password: a password an upline chose.
    must_change_password: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'must_change_password' },
    // ── migration 119-google-login: the Google account (`sub`) this player signs in with.
    google_sub: { type: DataTypes.STRING(64), allowNull: true, field: 'google_sub' },
    wager_multiplier: { type: DataTypes.DECIMAL(10, 4), allowNull: true, defaultValue: 3, field: 'wager_multiplier' },
    lock_targetx: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'lock_targetx' },
    // ── migration 043-user-withdrawal-whitelist ────────────────────────
    // The master switch for whitelist-only withdrawals. Undeclared, this file's
    // own warning came true exactly: `Users.update({ withdraw_whitelist_only })`
    // reported success, wrote nothing, and the next read answered `false` — the
    // switch appeared to turn on and did not.
    withdraw_whitelist_only: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'withdraw_whitelist_only',
    },
    // ── migration 044-withdraw-cooldown-after-password-change ──────────
    // The 24-hour withdrawal freeze that follows a self-service password
    // change. Declared here for the same reason the line above it is: an
    // undeclared column is written by a silently-successful UPDATE, and this
    // one deciding whether money can leave is the worst place for that.
    withdraw_locked_until: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'withdraw_locked_until',
    },
    // ── migration 058-login-geo ────────────────────────────────────────
    // Where the player last signed in from, and where they signed up.
    last_country_code: { type: DataTypes.STRING(2), allowNull: true, field: 'last_country_code' },
    last_country: { type: DataTypes.STRING(80), allowNull: true, field: 'last_country' },
    last_city: { type: DataTypes.STRING(120), allowNull: true, field: 'last_city' },
    last_isp: { type: DataTypes.STRING(160), allowNull: true, field: 'last_isp' },
    signup_ip: { type: DataTypes.TEXT, allowNull: true, field: 'signup_ip' },
    signup_country_code: { type: DataTypes.STRING(2), allowNull: true, field: 'signup_country_code' },
    signup_country: { type: DataTypes.STRING(80), allowNull: true, field: 'signup_country' },
    signup_city: { type: DataTypes.STRING(120), allowNull: true, field: 'signup_city' },
    signup_isp: { type: DataTypes.STRING(160), allowNull: true, field: 'signup_isp' },
    // migration 084-signup-region-ip-normalise
    signup_region: { type: DataTypes.STRING(120), allowNull: true, field: 'signup_region' },
    // ── migration 062-agent-money ──────────────────────────────────────
    // Why each lock column is set: `{ <column>: { own, by: [staffId…] } }`.
    // See `services/admin/src/modules/locks/lockSources.js`.
    lock_sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'lock_sources' },
    // ── migration 091-withdraw-lock ────────────────────────────────────
    // The operator's withdrawal block — a lock column like `system_locked`,
    // set through `POST /admin/locks` and cascaded by `lock_sources`. Not the
    // timed `withdraw_locked_until` cooldown above.
    withdraw_locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'withdraw_locked' },
    // ── migration 141-originals-lock ───────────────────────────────────
    // Blocks Original Games only; `casino_locked` covers provider casino.
    originals_locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'originals_locked' },
  },

  // ── migration 062-agent-money ────────────────────────────────────────
  // `lords.setCreditLimit` wrote this column before it existed — Sequelize
  // dropped the attribute and the route reported success storing nothing.
  Credits: {
    credit_limit: { type: DataTypes.DECIMAL, allowNull: true, defaultValue: '0', field: 'credit_limit' },
    // ── migration 151-idr-currency: the IDR balance (F2Pay's Indonesian deposits).
    idr: { type: DataTypes.DECIMAL, allowNull: true, defaultValue: '0', field: 'idr' },
    // ── migration 095-credits-sports-wallet: the wallet's own id (BIGSERIAL;
    // `point_ledger.wallet_id` stores it). Postgres fills it — never written here.
    id: { type: DataTypes.BIGINT, allowNull: true, field: 'id' },
    // the zip's points columns.
    // `credit` = jitna parent ne diya (deposit − withdraw), `all_point` = point ledger ka jod.
    credit: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: '0', field: 'credit' },
    all_point: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: '0', field: 'all_point' },
    // ── migration 099-credits-for-everyone: player row = 'USER' (uid set).
    // Staff/owner rows are read through the `StaffCredits` model (extended/).
    user_type: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'USER', field: 'user_type' },
  },

  // ── migration 065-custom-coins ───────────────────────────────────────
  // 'owner' on a custom coin's rate, which the owner panel sets; the site
  // admin's rate editor refuses those rows (EXCHANGE_RATE_OWNER_MANAGED).
  Exchangerate: {
    managed_by: { type: DataTypes.STRING(20), allowNull: true, field: 'managed_by' },
  },

  // ── migration 058-login-geo ──────────────────────────────────────────
  // The IP's location at each login / registration (see services/user geo).
  UserLoginHistory: {
    country_code: { type: DataTypes.STRING(2), allowNull: true, field: 'country_code' },
    country: { type: DataTypes.STRING(80), allowNull: true, field: 'country' },
    region: { type: DataTypes.STRING(120), allowNull: true, field: 'region' },
    city: { type: DataTypes.STRING(120), allowNull: true, field: 'city' },
    isp: { type: DataTypes.STRING(160), allowNull: true, field: 'isp' },
    org: { type: DataTypes.STRING(160), allowNull: true, field: 'org' },
    asn: { type: DataTypes.STRING(160), allowNull: true, field: 'asn' },
    is_proxy: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_proxy' },
    is_hosting: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_hosting' },
    source: { type: DataTypes.STRING(16), allowNull: true, field: 'source' },
    // migration 064-ip-locations: the ip_locations row that located this login.
    ip_location_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ip_location_id' },
  },

  // ── migration 010-vault-schema ───────────────────────────────────────
  // The baseline `vault_pro` carries only a balance; the lock terms the legacy
  // code reads and writes were never in the schema. The migration adds them.
  VaultPro: {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
    lock_period: { type: DataTypes.STRING(50), allowNull: true, field: 'lock_period' },
    interest_rate: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'interest_rate' },
    startTime: { type: DataTypes.DATE, allowNull: true, field: 'startTime' },
    endTime: { type: DataTypes.DATE, allowNull: true, field: 'endTime' },
    status: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'active', field: 'status' },
    principal: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'principal' },
  },

  // ── migration 013-spin-wheel-integrity ───────────────────────────────
  // `redeembonus` shipped with no primary key, so the generated model is
  // insert-and-read only — Sequelize cannot update a row it cannot address.
  // The migration adds one, and declaring it here is what lets a code be
  // expired or marked used.
  Redeembonus: {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
    // ── migration 075-spin-wheel-deposit-bonus: the deposit a spin code was applied to.
    applied_ref: { type: DataTypes.STRING(80), allowNull: true, field: 'applied_ref' },
    applied_at: { type: DataTypes.DATE, allowNull: true, field: 'applied_at' }, // timestamptz (migration 083)
  },

  // ── migration 075-spin-wheel-deposit-bonus ───────────────────────────
  // The most one spin code pays on one deposit, in the reward currency.
  SpinWheelConfig: {
    max_bonus: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '100', field: 'max_bonus' },
    // ── migration 076-player-bonuses: the spin bonus's own rollover (null = the first-deposit
    // multiplier) and how many days an unwagered spin bonus lives.
    wager_multiplier: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'wager_multiplier' },
    bonus_expiry_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30, field: 'bonus_expiry_days' },
  },

  // ── migration 007-wallet-integrity ───────────────────────────────────
  CreditsLedger: {
    /**
     * Idempotency key for a money movement.
     *
     * Casino and sports retry on timeout. Without this, a retried
     * "settle bet 123" pays out twice — the single most expensive bug class in
     * a betting platform. Unique where present, so the second insert of the
     * same key is rejected by the database rather than by application logic
     * that a race can slip past.
     */
    idempotency_key: {
      type: DataTypes.STRING(120),
      allowNull: true,
      field: 'idempotency_key',
    },

    /** Which service performed the movement, for "who moved this money". */
    source_service: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'source_service',
    },
  },

  // ── migration 016-casino-provider-schema ─────────────────────────────
  // The jsGames wallet callback had no duplicate detection of any kind, so
  // every provider retry was paid again. `serial_number` is the provider's
  // per-callback id and is now uniquely indexed; these two columns are what
  // make that workable from the application side.
  JsGameTransactions: {
    /**
     * A row whose serial number lost the race to an earlier one.
     *
     * Rows that predate the constraint may repeat a serial number — each is
     * real money that really did move, so they are marked rather than deleted,
     * and the partial unique index ignores them.
     */
    superseded: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'superseded' },
    /** The ledger row this produced, so a movement traces both ways. */
    ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ledger_id' },
  },

  // ── migration 020-bonus-counter-integrity ────────────────────────────
  // Both tables shipped with no primary key, so the generated models are
  // insert-and-read only. That is why legacy addressed rows by `userid` —
  // updating a player's bonus LOG rewrote every row in it. The migration adds
  // the key; declaring it here is what lets a single event be edited.
  Bonusgame: {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
  },
  Bonushistory: {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
  },

  // ── migration 022-withdrawal-decisions ───────────────────────────────
  // A crypto withdrawal is settled by broadcasting a transaction, and the
  // table had nowhere to record its hash — see the migration for the variable
  // named `txid` that holds the string "In Queue".
  // ── migration 114-fiat-deposit-claimed-amount ─────────────────────────
  // `amount` is what was credited once approved; this is what the player entered.
  FiatDeposits: {
    claimed_amount: { type: DataTypes.DECIMAL, allowNull: true, field: 'claimed_amount' },
    // ── migration 118-manual-crypto-deposit: the network and house address of a manual crypto deposit.
    network: { type: DataTypes.STRING(32), allowNull: true, field: 'network' },
    wallet_address: { type: DataTypes.STRING(128), allowNull: true, field: 'wallet_address' },
  },

  // ── migration 118-manual-crypto-deposit: a house receiving address for a crypto coin.
  CurrencyPaymentDetails: {
    network: { type: DataTypes.STRING(32), allowNull: true, field: 'network' },
    wallet_address: { type: DataTypes.STRING(128), allowNull: true, field: 'wallet_address' },
    // migration 147: the deposit amounts this destination is shown for (NULL = no bound).
    min_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: true, field: 'min_amount' },
    max_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: true, field: 'max_amount' },
  },

  Withdrawals: {
    txid: { type: DataTypes.STRING(120), allowNull: true, field: 'txid' },
    /** The staff member who authorised it, from a verified token. */
    decided_by: { type: DataTypes.BIGINT, allowNull: true, field: 'decided_by' },
    decided_at: { type: DataTypes.DATE, allowNull: true, field: 'decided_at' },
    note: { type: DataTypes.TEXT, allowNull: true, field: 'note' },
    // migration 171: sent through CCPayment instead of by hand.
    gateway: { type: DataTypes.STRING(20), allowNull: true, field: 'gateway' },
    gateway_order_id: { type: DataTypes.STRING(64), allowNull: true, field: 'gateway_order_id' },
    gateway_record_id: { type: DataTypes.STRING(64), allowNull: true, field: 'gateway_record_id' },
  },

  // ── migration 018-otp-integrity ──────────────────────────────────────
  // `user_otps` was created at runtime from a class constructor, so its shape
  // never reached the baseline schema and neither did these two columns.
  UserOtps: {
    /**
     * When a code was verified.
     *
     * A code is checked in one request and spent in another — verify, then
     * reset the 2FA. Without a timestamp the verification is either consumed
     * immediately and useless, or permanent, which is worse.
     */
    verified_at: { type: DataTypes.DATE, allowNull: true, field: 'verified_at' },
    /** Where the request came from, so a flood has a source in the audit trail. */
    request_ip: { type: DataTypes.STRING(64), allowNull: true, field: 'request_ip' },
  },

  // ── migration 027-banner-storage ─────────────────────────────────────
  // Legacy kept banner images on the API server's local disk and only the
  // filename in the row, which works for exactly one server. The bytes live
  // in the row now so any replica can serve them.
  Banners: {
    image_data: { type: DataTypes.BLOB, allowNull: true, field: 'image_data' },
    content_type: { type: DataTypes.STRING(60), allowNull: true, field: 'content_type' },
    byte_size: { type: DataTypes.INTEGER, allowNull: true, field: 'byte_size' },
    /** Legacy recorded nothing — the upload route had no authentication. */
    uploaded_by: { type: DataTypes.BIGINT, allowNull: true, field: 'uploaded_by' },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },

    /**
     * Migration 037 — the slide fields.
     *
     * Before these, a banner could only ever be a picture, so the home hero
     * stayed a nine-slide fixture in the front end: pointing it at this table
     * would have discarded the title, subtitle and CTA on every slide.
     *
     * All nullable. An image-only banner is still valid and every row that
     * predates the migration is one.
     */
    title: { type: DataTypes.STRING(160), allowNull: true, field: 'title' },
    subtitle: { type: DataTypes.STRING(300), allowNull: true, field: 'subtitle' },
    cta_label: { type: DataTypes.STRING(60), allowNull: true, field: 'cta_label' },
    cta_href: { type: DataTypes.STRING(500), allowNull: true, field: 'cta_href' },
    /**
     * Position within a placement. Several rows may share a `type` now — that
     * is what turns a placement into a carousel — and this is the only thing
     * that makes their order deterministic.
     */
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
  },

  // Migration 032. Same move as banners, and for the same reason — legacy wrote
  // blog images to `uploads/blogs/` on one server's disk. The upload route also
  // took the file extension from the client's own filename, so a `.html` named
  // file served from the platform's origin was one unauthenticated POST away.
  Blogs: {
    image_data: { type: DataTypes.BLOB, allowNull: true, field: 'image_data' },
    /** Detected from the CONTENT. Never what the request claimed. */
    content_type: { type: DataTypes.STRING(60), allowNull: true, field: 'content_type' },
    byte_size: { type: DataTypes.INTEGER, allowNull: true, field: 'byte_size' },
    created_by: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, field: 'updated_by' },
    /** Legacy had no draft state: inserting a post published it. */
    is_published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_published' },
    published_at: { type: DataTypes.DATE, allowNull: true, field: 'published_at' },
  },

  // Migration 033. The proof images were `req.file.filename` on local disk —
  // and a payment proof is the EVIDENCE in a dispute over real money, so losing
  // it on a restart means losing the record of who is telling the truth.
  // The `*_by` columns exist because legacy's release routes had no
  // authentication, so there was no operator identity to record.
  P2pOrder: {
    payment_proof_data: { type: DataTypes.BLOB, allowNull: true, field: 'payment_proof_data' },
    payment_proof_type: { type: DataTypes.STRING(60), allowNull: true, field: 'payment_proof_type' },
    payment_proof_size: { type: DataTypes.INTEGER, allowNull: true, field: 'payment_proof_size' },
    released_by: { type: DataTypes.BIGINT, allowNull: true, field: 'released_by' },
    cancelled_by: { type: DataTypes.BIGINT, allowNull: true, field: 'cancelled_by' },
    cancelled_at: { type: DataTypes.DATE, allowNull: true, field: 'cancelled_at' },
    admin_note: { type: DataTypes.TEXT, allowNull: true, field: 'admin_note' },
  },

  P2pOrderSell: {
    admin_proof_data: { type: DataTypes.BLOB, allowNull: true, field: 'admin_proof_data' },
    admin_proof_type: { type: DataTypes.STRING(60), allowNull: true, field: 'admin_proof_type' },
    admin_proof_size: { type: DataTypes.INTEGER, allowNull: true, field: 'admin_proof_size' },
    qr_image_type: { type: DataTypes.STRING(60), allowNull: true, field: 'qr_image_type' },
    released_by: { type: DataTypes.BIGINT, allowNull: true, field: 'released_by' },
    cancelled_by: { type: DataTypes.BIGINT, allowNull: true, field: 'cancelled_by' },
    cancelled_at: { type: DataTypes.DATE, allowNull: true, field: 'cancelled_at' },
  },

  P2pDispute: {
    screenshot_data: { type: DataTypes.BLOB, allowNull: true, field: 'screenshot_data' },
    screenshot_type: { type: DataTypes.STRING(60), allowNull: true, field: 'screenshot_type' },
    screenshot_size: { type: DataTypes.INTEGER, allowNull: true, field: 'screenshot_size' },
    resolved_by: { type: DataTypes.BIGINT, allowNull: true, field: 'resolved_by' },
  },

  // ── migrations 034-siteconfig-sports-flag, 035-siteconfig-livesports-flag ──
  //
  // Both are feature flags the admin toggle screen has always listed and the
  // baseline never had. `sports` is additionally read by sports-service over
  // the internal route in front of every feed endpoint, so an undeclared column
  // there is a kill switch that cannot be thrown.
  Siteconfig: {
    // ── migration 072-affiliate-bonus-requires-deposit ────────────────
    affiliate_bonus_requires_deposit: {
      type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'affiliate_bonus_requires_deposit',
    },
    sports: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'sports' },
    home_livesports: {
      type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'home_livesports',
    },
    // ── migration 041-siteconfig-eur-flag ──────────────────────────────
    //
    // ADDED LATE, AND ITS ABSENCE MADE 037 A NO-OP FOR WRITES. The migration
    // created the column and the service's `PUBLIC_FLAGS` lists it, so the
    // flag READS (missing from a model read, it defaults to ON, which is the
    // documented behaviour for an absent flag) — but `Siteconfig.update({ eur })`
    // silently dropped the key, so an operator could not turn EUR OFF. That is
    // precisely the defect 037 was written to fix: EUR permanently visible
    // while every other currency was switchable.
    //
    // Found by `node tools/verify-models.js`, which is what this file's header
    // says to use and which reported it as the only column missing platform-wide.
    eur: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'eur' },
    // ── migration 049-siteconfig-operator-settings ─────────────────────
    //
    // The business values an operator sets for themselves — limits, policy,
    // schedule. Undeclared here the column exists and every write to it is
    // silently dropped, which is the defect the `eur` note above describes.
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'settings' },
    // ── migration 043-siteconfig-reward-currencies ─────────────────────
    //
    // Wallet codes VIP bonuses and Instant Rakeback credit into. Written from
    // the Site Config admin screen; read by user-service over the internal
    // site-config/rewards route. Default USDT since migration 060 retired
    // BJB (it was BJB before).
    bonus_currency: {
      type: DataTypes.TEXT, allowNull: false, defaultValue: 'USDT', field: 'bonus_currency',
    },
    rakeback_currency: {
      type: DataTypes.TEXT, allowNull: false, defaultValue: 'USDT', field: 'rakeback_currency',
    },
    // ── migration 051-siteconfig-affiliate-bonus-currencies ────────────
    // Informational since migration 060: these bonuses are always paid in
    // USDT (`REWARD_CURRENCY` in @ibitplay/common), whatever is stored here.
    register_bonus_currency: {
      type: DataTypes.TEXT, allowNull: false, defaultValue: 'USDT', field: 'register_bonus_currency',
    },
    affiliate_bonus_currency: {
      type: DataTypes.TEXT, allowNull: false, defaultValue: 'USDT', field: 'affiliate_bonus_currency',
    },
    // ── migration 070-welcome-bonuses ──────────────────────────────────
    //
    // The registration bonus switch and the first-deposit bonus. Written from
    // the Site config "Welcome bonuses" screen; read by user-service over the
    // internal site-config/welcome-bonuses route.
    register_bonus_enabled: {
      type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'register_bonus_enabled',
    },
    first_deposit_bonus_enabled: {
      type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'first_deposit_bonus_enabled',
    },
    // [{ minDeposit, percent, maxBonus }] in USD — see the migration.
    first_deposit_bonus_tiers: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'first_deposit_bonus_tiers',
    },
    first_deposit_bonus_wager_multiplier: {
      type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'first_deposit_bonus_wager_multiplier',
    },
    // ── migration 076-player-bonuses: days an unwagered first-deposit bonus lives.
    first_deposit_bonus_expiry_days: {
      type: DataTypes.INTEGER, allowNull: false, defaultValue: 30, field: 'first_deposit_bonus_expiry_days',
    },
  },

  // ── migration 071-wager-activity-and-commission-claims ───────────────
  // Affiliate commission rows became a claimable payable: who owns it, whether
  // it has been paid (and by which ledger row), and whether it is void.
  Rewards: {
    owner_id: { type: DataTypes.BIGINT, allowNull: true, field: 'owner_id' },
    claimed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'claimed' },
    claimed_at: { type: DataTypes.DATE, allowNull: true, field: 'claimed_at' },
    ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ledger_id' },
    voided: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'voided' },
    // ── migration 090-wager-reversal-links: the stake a commission row was paid on, so a
    // refund / rollback / void can void (or pro-rate) it while it is unclaimed.
    source: { type: DataTypes.TEXT, allowNull: true, field: 'source' },
    ref: { type: DataTypes.TEXT, allowNull: true, field: 'ref' },
    reversed_amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'reversed_amount' },
  },

  // ── migration 045-team-campaign ──────────────────────────────────────
  Team: {
    campaign: { type: DataTypes.TEXT, allowNull: false, defaultValue: '', field: 'campaign' },
  },

  // ── migration 036-2fa-hardening ──────────────────────────────────────
  //
  // A TOTP code is valid for its whole acceptance window — three 30-second
  // steps with `window: 1`. Nothing recorded that one had been spent, so the
  // same six digits were accepted repeatedly for up to 90 seconds, which makes
  // it a short-lived second password rather than a one-time one.
  //
  // `last_used_step` is the 30-second counter of the last accepted code; a code
  // at or below it is refused. The STEP is stored rather than the code, so the
  // column tells a reader nothing they can use.
  User2fa: {
    last_used_step: { type: DataTypes.BIGINT, allowNull: true, field: 'last_used_step' },
  },

  // Staff had no second factor at all, while holding `wallet:credit` and
  // `withdrawals:approve` over other people's money. These mirror the player
  // columns rather than reusing `user_2fa`, which is keyed on `uid` in the
  // users domain — pointing one table at two identity tables is how a lookup
  // eventually returns the wrong person's secret.
  //
  // `two_fa_secret` is TEXT because it holds an AES-256-GCM envelope
  // (`v1.<iv>.<tag>.<ciphertext>`), not the 32-character base32 secret.
  Staff: {
    two_fa_secret: { type: DataTypes.TEXT, allowNull: true, field: 'two_fa_secret' },
    two_fa_enabled: {
      type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'two_fa_enabled',
    },
    two_fa_last_step: { type: DataTypes.BIGINT, allowNull: true, field: 'two_fa_last_step' },
    two_fa_enrolled_at: { type: DataTypes.DATE, allowNull: true, field: 'two_fa_enrolled_at' },
    // ── migration 063-staff-must-change-password ───────────────────────
    // A password somebody else chose; the auth guard blocks the session
    // until its owner replaces it.
    must_change_password: {
      type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'must_change_password',
    },
    // ── migration 156-staff-token-version ──────────────────────────────
    // Signed into staff tokens; bumping it ends every session (see the auth guard).
    token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'token_version' },
    // ── migration 062-agent-money ──────────────────────────────────────
    lock_sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'lock_sources' },
    // ── migration 091-withdraw-lock ────────────────────────────────────
    withdraw_locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'withdraw_locked' },
    // ── migration 141-originals-lock ───────────────────────────────────
    originals_locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'originals_locked' },
  },

  // ── migration 157-executive-token-version ────────────────────────────
  // Signed into executive tokens (`etv`); an executive's logout bumps it.
  Executives: {
    token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'token_version' },
  },
};

/**
 * Columns a migration CHANGED on a baseline table.
 *
 * `EXTENSIONS` above adds columns the generated models do not have. This is the
 * other half: a column that exists in the generated model but whose definition
 * a migration has since altered. The generator reads
 * `000_baseline_schema.sql`, not the live database, so it cannot see the change
 * and would keep regenerating the old definition.
 *
 * A wrong `allowNull` is not cosmetic. Sequelize validates BEFORE it sends the
 * statement, so a model that still believes a column is NOT NULL rejects the
 * insert itself — the database never sees it, and the error looks like a
 * constraint violation from a constraint that is no longer there.
 *
 * Keep this list short. An entry here means the baseline SQL and the database
 * disagree, and the durable fix is to refresh the baseline.
 */
const OVERRIDES = {
  // ── migration 177-redeem-amount-decimal
  Redeembonus: {
    amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: 'amount' },
  },

  // ── migration 016-casino-provider-schema ─────────────────────────────
  JsGameTransactions: {
    /**
     * The provider does not always send a game id with a wallet callback.
     *
     * With NOT NULL in force the INSERT throws, the handler reports an error,
     * and the provider retries forever against a payout that can never be
     * recorded. The round is still in `additional_data`, and `serial_number` —
     * which IS required — is what makes the movement idempotent.
     */
    game_uid: { type: DataTypes.STRING(255), allowNull: true, field: 'game_uid' },
  },

  // ── migration 023-ccdeposit-precision ────────────────────────────────
  Ccdeposit: {
    /**
     * Crypto amounts were NUMERIC(10,2) — two decimal places.
     *
     * 0.0012 BTC stored as 0.00. Without these overrides Sequelize keeps
     * declaring DECIMAL(10,2) and rounds the value itself before the widened
     * column ever sees it, which would make the migration look applied while
     * changing nothing.
     */
    price: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'price' },
    amount: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'amount' },
  },

  // ── migration 010-vault-schema ───────────────────────────────────────
  VaultPro: {
    vaultBalance: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'vaultBalance' },
  },

  // ── migration 020-bonus-counter-integrity ────────────────────────────
  Bonushistory: {
    /**
     * The bonus log stored money in an INTEGER column.
     *
     * Postgres rounded every value on the way in — a 0.40 bonus was logged as
     * 0, a 0.60 as 1. The migration widens it; without this override the model
     * keeps declaring INTEGER and Sequelize truncates the decimal itself before
     * the widened column ever sees it, which would make the fix look applied
     * while changing nothing.
     */
    amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount' },
  },
};

/**
 * Tables a migration MOVED to another schema, and the baseline columns the moved table does not have.
 *
 * ── migration 094-mssports-schema ────────────────────────────────────
 * The Sports Exchange (TENEXCH "mssports") writes its bets to `mssports."SportsBet"`; the baseline
 * `public."SportsBet"` is dead and empty. Every platform reader of this model (Risk, Statements,
 * the sports wager report / bet admin) read the empty table, so a player with settled bets showed
 * "no activity". The mssports table has no `lay_size` / `back_size`.
 */
const RELOCATED = {
  SportsBet: { schema: 'mssports', drop: ['lay_size', 'back_size'] },
};

/**
 * Apply the declared extensions to already-registered models.
 *
 * Uses `Model.rawAttributes` + `refreshAttributes()` rather than re-`init`,
 * so associations and hooks already wired onto the model survive.
 */
function applyExtensions(models, logger) {
  const applied = [];
  const skipped = [];

  for (const [modelName, { schema, drop = [] }] of Object.entries(RELOCATED)) {
    const model = models[modelName];
    if (!model) {
      skipped.push({ model: modelName, reason: 'model not loaded in this service' });
      continue;
    }
    // In place (not `Model.schema()`, which returns a clone) so associations keep pointing here.
    model.options.schema = schema;
    model._schema = schema;
    for (const name of drop) delete model.rawAttributes[name];
    model.refreshAttributes();
    applied.push(`${modelName} -> ${schema}`);
  }

  for (const [modelName, columns] of Object.entries(OVERRIDES)) {
    const model = models[modelName];
    if (!model) {
      skipped.push({ model: modelName, reason: 'model not loaded in this service' });
      continue;
    }

    for (const [name, definition] of Object.entries(columns)) {
      model.rawAttributes[name] = definition;
      applied.push(`${modelName}.${name} (override)`);
    }

    model.refreshAttributes();
  }

  for (const [modelName, columns] of Object.entries(EXTENSIONS)) {
    const model = models[modelName];

    if (!model) {
      // Expected: casino-service does not load `admin`, and so on.
      skipped.push({ model: modelName, reason: 'model not loaded in this service' });
      continue;
    }

    for (const [name, definition] of Object.entries(columns)) {
      if (model.rawAttributes[name]) {
        skipped.push({ model: modelName, column: name, reason: 'already defined' });
        continue;
      }
      model.rawAttributes[name] = definition;
      applied.push(`${modelName}.${name}`);
    }

    model.refreshAttributes();
  }

  if (applied.length) logger?.debug({ applied }, 'Applied post-baseline model extensions');
  return { applied, skipped };
}

module.exports = { applyExtensions, EXTENSIONS, OVERRIDES, RELOCATED };
