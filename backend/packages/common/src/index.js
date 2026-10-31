'use strict';

/**
 * @ibitplay/common — the shared foundation every service builds on.
 * Nothing here knows about a specific domain; anything domain-aware belongs in
 * the service that owns it.
 */

const env = require('./env');
const errors = require('./errors');
const money = require('./money');
const { createLogger } = require('./logger');
const { createApp, PROVIDER_CALLBACK_PREFIXES, isProviderCallback } = require('./createApp');
const { startServer } = require('./server');
const { createHealthRouter } = require('./health');
const { ServiceClient, CircuitBreaker } = require('./serviceClient');
const { WalletClient } = require('./walletClient');
const { Mailer, redact } = require('./mailer');
const { asyncHandler, wrapController } = require('./asyncHandler');
const imageUpload = require('./imageUpload');
const response = require('./response');
const { defineErrors, listErrorCodes, getErrorDefinition } = require('./defineErrors');
const { loadModules, mountModules, collectJobs, collectDomains, AUDIENCES } = require('./moduleLoader');
/**
 * The VIP ladder lives here because TWO services read it: user-service decides
 * a player's bonus from it, and admin-service reports the same level back to
 * an operator. A second copy would drift, and a player told they are VIP 30 on
 * one screen and VIP 29 on another has found a bug in the platform's word.
 */
const { VIP_LEVELS, UNRANKED, vipLevelName, vipLevelFor, PLATFORM_LADDER } = require('./vipLevels');
/** Every ladder a site can choose through its `vip` variant, and the resolver that reads the choice. */
const { VIP_LADDERS, vipLadderFor, resolveVipLadder, rebrand: rebrandVipLadder, clearVipBranding } = require('./vipLadders');
/**
 * The rewards table behind a VIP card — the rakeback rate and the rest.
 *
 * Exported WHOLE, as `vipRewards`, because that is how it is asked for:
 * `const { vipRewards } = require('@ibitplay/common')`. The file was in the
 * package and this line was not, so user-service could not load
 * `rakeback.service.js` at all.
 * What each rank PAYS — rakeback rates and USDT awards keyed on card. The ladder
 * above decides which rank a wager buys; this decides what that rank is worth.
 * Exported as a namespace, not spread, because names like `rewardsForLevel` mean
 * nothing without the `vipRewards.` in front of them.
 */
const vipRewards = require('./vipRewards');
/**
 * The wagering race's game buckets. Shared for the same reason the VIP ladder
 * is: THREE services read it — casino and sports classify their rows into
 * these names, user-service multiplies each name by an operator's number — and
 * a bucket one side emits that the other has no multiplier for scores nothing,
 * silently, because a missing key reads as zero.
 */
const raceBuckets = require('./raceBuckets');
/** The fixed reward currency (USDT) and the retired coins nothing may credit. */
const currencies = require('./currencies');
/** The feature menu and site templates — read by admin-service and the owner panel. */
const featureCatalogue = require('./featureCatalogue');
/** Business settings a site's owner chooses, enforced where money and accounts are created. */
const sitePolicy = require('./sitePolicy');
/** The operator's withdrawal block (migration 091) — every payout path asks it first. */
const withdrawBlock = require('./withdrawBlock');
const manualPayments = require('./manualPayments');
/** What the platform owner allows this site — see entitlements.js. */
const entitlements = require('./entitlements');
// rainbet: admin content changed → player sockets (contentPush.js).
const { CONTENT_SCOPES, createContentNotifier } = require('./contentPush');
/** Owner-only ON/OFF options of a feature (e.g. when the spin wheel grants a spin). */
const featureOptions = require('./featureOptions');
/** Region restriction: the owner's mode, list type and countries (regionPolicy.js). */
const regionPolicy = require('./regionPolicy');
/** Withdrawal cap: the owner's deposit-cap switch of `withdrawal_requirements` (withdrawalCap.js). */
const withdrawalCap = require('./withdrawalCap');
/** Deposit cap figures (deposited / withdrawn / wagered) — user-service cap + admin Users → Financial. */
const withdrawalCapFigures = require('./withdrawalCapFigures');
/** Bet kinds hash.game prices differently (originals / slots / live / sports) — wagerCategory.js. */
const wagerCategory = require('./wagerCategory');
/** Direct user's ledger: label a balance update (the trigger of migration 117 writes the row). */
const directLedger = require('./directLedger');
/** Daily withdrawal limit per currency: the owner's `withdrawalDailyLimit` block (withdrawalDailyLimit.js). */
const withdrawalDailyLimit = require('./withdrawalDailyLimit');
/** The owner's `paymentMethods` block (paymentMethods.js), applied to the `payment_methods` table. */
const paymentMethods = require('./paymentMethods');
const currencyRegistry = require('./currencyRegistry');
/** What the operator set in the site admin, read by the services that act on it. */
const { operatorSettings } = require('./operatorSettings');

const { requestContext, getContext, getRequestId, REQUEST_ID_HEADER } = require('./middleware/requestContext');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { validate, schemas, z, isStrictSchema, VALIDATE_SCHEMAS, noQuery, noBody } = require('./middleware/validate');
const { requireTxnPassword } = require('./middleware/requireTxnPassword');
const { createRateLimiter, configureRateLimitStore, closeRateLimitStore } = require('./middleware/rateLimit');
const { auditProductionConfig, assertProductionPosture } = require('./productionGuards');
const internalAclExports = require('./internalAcl');
const { internalAuth, INTERNAL_KEY_HEADER, INTERNAL_SERVICE_HEADER } = require('./middleware/internalAuth');
const { createActivityRecorder } = require('./middleware/activity');

module.exports = {
  ...require('./cache'),
  // config
  ...env,

  // errors
  ...errors,
  defineErrors,
  listErrorCodes,
  getErrorDefinition,

  // module system — one codebase, four services or one monolith
  loadModules,
  mountModules,
  collectJobs,
  collectDomains,
  AUDIENCES,

  // helpers
  money,
  VIP_LEVELS,
  UNRANKED,
  vipLevelName,
  vipLevelFor,
  PLATFORM_LADDER,
  VIP_LADDERS,
  vipLadderFor,
  resolveVipLadder,
  rebrandVipLadder,
  clearVipBranding,
  vipRewards,
  ...raceBuckets,
  ...currencies,
  featureCatalogue,
  sitePolicy,
  withdrawBlock,
  manualPayments,
  entitlements,
  CONTENT_SCOPES,
  createContentNotifier,
  featureOptions,
  regionPolicy,
  withdrawalCap,
  withdrawalCapFigures,
  wagerCategory,
  directLedger,
  directLedgerContext: directLedger.directLedgerContext,
  withdrawalDailyLimit,
  paymentMethods,
  configureEntitlements: entitlements.configureEntitlements,
  currencyRegistry,
  configureCurrencyRegistry: currencyRegistry.configureCurrencyRegistry,
  operatorSettings,
  createLogger,
  createApp,
  PROVIDER_CALLBACK_PREFIXES,
  isProviderCallback,
  startServer,
  createHealthRouter,
  ServiceClient,
  CircuitBreaker,
  WalletClient,
  Mailer,
  redact,
  asyncHandler,
  wrapController,
  response,
  z,

  /**
   * Image uploads. Three modules across two services take one, and all three
   * carried the same defect — the format judged from the client's declared MIME
   * type or filename, never from the bytes. One signature table, here.
   */
  imageUpload,

  // middleware
  middleware: {
    requestContext,
    errorHandler,
    notFound,
    validate,
    createRateLimiter,
    internalAuth,
    createActivityRecorder,
  },
  requestContext,
  errorHandler,
  notFound,
  validate,
  schemas,
  isStrictSchema,
  VALIDATE_SCHEMAS,
  noQuery,
  noBody,
  requireTxnPassword,
  createRateLimiter,
  configureRateLimitStore,
  closeRateLimitStore,
  auditProductionConfig,
  assertProductionPosture,
  ...internalAclExports,
  internalAuth,
  createActivityRecorder,

  // context
  getContext,
  getRequestId,

  // header names
  REQUEST_ID_HEADER,
  INTERNAL_KEY_HEADER,
  INTERNAL_SERVICE_HEADER,
};
