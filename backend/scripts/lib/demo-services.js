'use strict';

/**
 * The real money services, assembled for the data runner.
 *
 * ── WHY THE SEED GOES THROUGH THE SERVICES ───────────────────────────────
 *
 * Every balance on this platform must equal the sum of its own ledger
 * (`WalletService.reconcile`). A seed that `UPDATE credits SET inr = 10000`
 * creates a wallet that fails that check on day one, and every screen built
 * on the ledger (statements, the admin's player report, tips history) then
 * disagrees with the balance the header shows. So the demo money moves the
 * way a player's would: `WalletService.credit/debit`, `TipService.send`,
 * `VaultService.transferIn`, `PlayerBonusService.grant`, the fiat deposit /
 * withdrawal services, `WagerActivityService.record` (VIP, rakeback,
 * affiliate commission) and admin-service's `LordsService.adjustPlayer`
 * (the agent float → player transfer).
 *
 * ── WHAT IS STUBBED, AND HOW ─────────────────────────────────────────────
 *
 * The services ask admin-service a few questions over the internal API. Here
 * there is no admin-service, so `clients.admin` is a LOCAL client that answers
 * the same paths from the same tables admin-service would read:
 *
 *   GET  /internal/admin/site-config/rewards      site_features('reward_currency')
 *   GET  /internal/admin/site-config/affiliate    siteconfig (commission %, bonuses)
 *   GET  /internal/admin/site-config/tips         siteconfig (tip limits)
 *   PUT  /internal/admin/notifications/player     INSERT … user_notifications (same
 *                                                 statement + dedupe as admin-service,
 *                                                 without the device push)
 *
 * Anything else throws — a service that starts asking a new question fails
 * the seed loudly instead of being answered with a guess.
 *
 * The first-deposit bonus hook is switched off (`firstDepositBonus` stub): the
 * demo grants its bonuses explicitly, and an operator's live tiers must not
 * pay demo deposits. The bonus wagering lock is pinned ON (the default).
 *
 * Crypto deposits (`--history`) arrive through `CryptoService.handleWebhook`,
 * the CCPayment webhook handler itself. It is built with a LOCAL app id and a
 * random per-process secret (never printed, never the deployment's), and
 * `signCryptoWebhook` signs a body with them the way CCPayment would — so the
 * signature check, the order lookup and the credit all run for real, and
 * nothing ever talks to CCPayment.
 */

const crypto = require('crypto');
const path = require('path');
const { QueryTypes, Op } = require('sequelize');

const db = require('@ibitplay/db');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const ROOT = path.resolve(__dirname, '..', '..');
const userModule = (rel) => require(path.join(ROOT, 'services/user/src', rel));
const adminModule = (rel) => require(path.join(ROOT, 'services/admin/src/modules', rel));

const PLAYER_NOTIFICATION_PATH = '/internal/admin/notifications/player';

function createLocalAdminClient({ sequelize }) {
  const q = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  const siteconfig = async () => (await q('SELECT * FROM siteconfig ORDER BY id ASC LIMIT 1'))[0] ?? {};
  const text = (value, fallback) => (value === null || value === undefined ? fallback : String(value));

  return {
    async get(route) {
      if (route === '/internal/admin/site-config/rewards') {
        const row = (await q("SELECT variant FROM site_features WHERE feature = 'reward_currency' LIMIT 1"))[0];
        return { rewardCurrency: row?.variant || 'USDT' };
      }
      if (route === '/internal/admin/site-config/affiliate') {
        const s = await siteconfig();
        return {
          affiliateBonus: text(s.affiliatebonus, '0'),
          commissionPercent: text(s.comissionpercent, '0'),
          registerBonus: text(s.registerbonus, '0'),
          registerBonusEnabled: s.register_bonus_enabled === true,
          affiliateBonusRequiresDeposit: s.affiliate_bonus_requires_deposit !== false,
        };
      }
      if (route === '/internal/admin/site-config/tips') {
        const s = await siteconfig();
        return {
          maxPerTipUsd: text(s.tip_max_per_tip_usd, '500'),
          maxPerDayUsd: text(s.tip_max_per_day_usd, '2000'),
          minWageredUsd: text(s.tip_min_wagered_usd, '0'),
        };
      }
      throw new Error(`demo seed: no local answer for GET ${route}`);
    },

    async request(method, route, { body } = {}) {
      if (method === 'PUT' && route === PLAYER_NOTIFICATION_PATH) {
        // The statement admin-service's NotificationsService.notifyPlayer runs.
        const rows = await q(
          `INSERT INTO user_notifications (user_id, title, body, type, additional_data, dedupe_key, created_at)
           VALUES (:userId, :title, :body, :type, CAST(:data AS JSONB), :dedupeKey, NOW())
           ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
           RETURNING id`,
          {
            userId: body.userId,
            title: String(body.title).slice(0, 200),
            body: body.body ?? null,
            type: body.kind ?? 'general',
            data: body.data == null ? null : JSON.stringify(body.data),
            dedupeKey: body.key ?? null,
          }
        );
        return { created: Boolean(rows[0]), id: rows[0]?.id ?? null, unread: 0 };
      }
      throw new Error(`demo seed: no local answer for ${method} ${route}`);
    },

    async post(route) {
      throw new Error(`demo seed: no local answer for POST ${route}`);
    },
  };
}

/**
 * Build the services on the runner's own Sequelize. All model domains are
 * registered (admin-service's set), because the seed writes both sides:
 * player wallets and the staff float.
 */
function createDemoServices({ sequelize, logger, config = {} }) {
  const models = db.registerForService(sequelize, 'admin-service', { logger });

  // The same shape `db.connect()` hands a service container.
  const connection = {
    sequelize,
    models,
    Sequelize: db.Sequelize,
    Op,
    QueryTypes,
    DataTypes: db.DataTypes,
    literal: db.literal,
    fn: db.fn,
    col: db.col,
    where: db.where,
    transaction: (fn, options) => db.withTransaction(sequelize, fn, { logger, ...options }),
    lockRow: db.lockRow,
    lockRowsInOrder: db.lockRowsInOrder,
    advisoryLock: (key, fn, options) => db.withAdvisoryLock(sequelize, key, fn, options),
  };

  const admin = createLocalAdminClient({ sequelize });
  const { configureNotifier, settleNotifications } = userModule('modules/notifications/notifyPlayer');
  configureNotifier({ clients: { admin }, logger });

  // Agent-tree detection the way user-service's container wires it, with the
  // staff record read in-process instead of over the internal API.
  const { resolveStaff } = adminModule('staff-directory/staffDirectory.service');
  configureAgentPlayers({
    loadOwnerStaffId: async (userId) => {
      const row = await models.Users.findByPk(userId, { attributes: ['parent_staff_id'], raw: true });
      return row?.parent_staff_id ?? null;
    },
    loadStaff: (staffId) => resolveStaff(models, staffId),
  });

  const { WalletService } = userModule('modules/wallet/wallet.service');
  const { createRewardMoney } = userModule('lib/rewardMoney');
  const { PlayerBonusService } = userModule('modules/player-bonuses/playerBonus.service');
  const { VipService } = userModule('modules/vip/vip.service');
  const { AffiliateService } = userModule('modules/affiliate/affiliate.service');
  const { RakebackService } = userModule('modules/rakeback/rakeback.service');
  const { WagerActivityService } = userModule('modules/wager/wagerActivity.service');
  const { TipService } = userModule('modules/tip/tip.service');
  const { VaultService } = userModule('modules/vault/vault.service');
  const { FiatDepositService } = userModule('modules/fiat-deposit/fiatDeposit.service');
  const { FiatWithdrawService } = userModule('modules/fiat-withdraw/fiatWithdraw.service');
  const { LordsService } = adminModule('lords/lords.service');
  const { CryptoService } = userModule('modules/crypto/crypto.service');
  const { CryptoWithdrawService } = userModule('modules/crypto-withdraw/cryptoWithdraw.service');

  const deps = {
    models,
    db: connection,
    logger,
    clients: { admin },
    config: {
      SERVICE_NAME: 'seed-data',
      ROOT_STAFF_ID: 1,
      ADMIN_MAX_REFILL: '1000000',
      WITHDRAW_REQUIRE_KYC: true,
      ...config,
    },
    // The owner option `bonus.wagering_lock`, at its default.
    bonusWageringLock: async () => true,
    // See the header: demo deposits never trigger the operator's first-deposit tiers.
    firstDepositBonus: { onDepositCredited: async () => ({ paid: false, reason: 'DEMO_SEED' }) },
  };

  const wallet = new WalletService(deps);
  deps.walletService = wallet;
  deps.wallet = wallet;
  deps.rewardMoney = createRewardMoney(deps);

  const playerBonuses = new PlayerBonusService(deps);
  deps.playerBonuses = playerBonuses;
  const vip = new VipService(deps);
  const affiliate = new AffiliateService(deps);
  const rakeback = new RakebackService(deps);
  const wager = new WagerActivityService({ ...deps, vip, affiliate, rakeback, playerBonuses });

  // The webhook's signing pair: local to this process, so no real CCPayment secret is involved.
  const cryptoConfig = {
    CCPAYMENT_APP_ID: 'demo-seed-local',
    CCPAYMENT_APP_SECRET: crypto.randomBytes(32).toString('hex'),
  };
  const signCryptoWebhook = (rawBody) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac('sha256', cryptoConfig.CCPAYMENT_APP_SECRET)
      .update(`${cryptoConfig.CCPAYMENT_APP_ID}${timestamp}${rawBody}`)
      .digest('hex');
    return { timestamp, signature };
  };

  return {
    models,
    connection,
    deps,
    wallet,
    rewardMoney: deps.rewardMoney,
    playerBonuses,
    vip,
    affiliate,
    rakeback,
    wager,
    tips: new TipService(deps),
    vault: new VaultService(deps),
    fiatDeposit: new FiatDepositService(deps),
    fiatWithdraw: new FiatWithdrawService(deps),
    lords: new LordsService({ models, db: connection, logger, config: deps.config }),
    crypto: new CryptoService({ ...deps, config: { ...deps.config, ...cryptoConfig } }),
    // The crypto payout queue's decisions (Approved / Sent / Rejected → refund).
    cryptoWithdraw: new CryptoWithdrawService(deps),
    signCryptoWebhook,

    /** Wait for the fire-and-forget notifications sent so far (they write rows). */
    settle: () => settleNotifications(),

    /** Wait for fire-and-forget notifications, then unhook the process-wide resolvers. */
    async close() {
      await settleNotifications();
      configureNotifier(null);
      resetAgentPlayers();
    },
  };
}

module.exports = { createDemoServices, createLocalAdminClient };
