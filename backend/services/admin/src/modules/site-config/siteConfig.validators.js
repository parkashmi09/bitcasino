'use strict';

const { z, REWARD_CURRENCY_CHOICES } = require('@ibitplay/common');
const { PAYMENT_SWITCHES } = require('./siteConfig.service');

/**
 * Wallet currency codes an operator may pick for reward payouts.
 *
 * Mirrors `wallet.constants.js` `SUPPORTED_CURRENCIES` in user-service. Kept
 * here rather than importing across services: admin-service does not load the
 * wallet module, and a currency that is not a `credits` column must never be
 * written into siteconfig or claims will fail at credit time. Retired coins
 * (BJB) are left out for the same reason: the wallet refuses to credit them.
 */
const WALLET_CURRENCIES = Object.freeze([
  'BTC', 'ETH', 'LTC', 'BCH', 'USDT', 'TRX', 'DOGE', 'ADA', 'XRP', 'BNB',
  'USDP', 'NEXO', 'MKR', 'TUSD', 'USDC', 'BUSD', 'NC', 'INR', 'SHIB', 'MATIC',
  'SC', 'MVR', 'AED', 'NPR', 'PKR', 'EUR', 'BDT',
]);

/**
 * Affiliate and register bonuses pay in the site's reward currency (owner-set,
 * `REWARD_CURRENCY_CHOICES`). The fields stay in the body so an older admin
 * screen that sends them still saves; the service refuses one that names a
 * coin other than the current reward currency (`SITE_CONFIG_REWARD_CURRENCY_FIXED`).
 */
const rewardCurrency = z
  .string({ invalid_type_error: 'send the currency as a string' })
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.enum(REWARD_CURRENCY_CHOICES, { errorMap: () => ({ message: 'not a reward currency the wallet can credit' }) }));

/**
 * A decimal that may be zero, carried as a string.
 *
 * Zero is not a valid PAYMENT, but it is a valid SETTING — it is how the
 * operator switches a bonus off. So this is deliberately looser than the
 * wallet's `moneyAmount`, and no looser: still a string, still exact, never a
 * float. `parseFloat`, which is what legacy used, accepts `1e9` and `Infinity`.
 */
const rate = z
  .string({ invalid_type_error: 'send this as a string, not a number' })
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a non-negative decimal with at most 8 decimal places');

/** A percent, 0–100 (hash.game's commission rate and game rates). */
const percent = rate.refine((v) => Number.parseFloat(v) <= 100, 'a percent cannot exceed 100');

const updateAffiliateSettings = {
  body: z
    .object({
      affiliateBonus: rate.optional(),
      // A percentage is a percentage. Legacy stored whatever `parseFloat`
      // returned, so a commission rate of a billion percent was accepted.
      commissionPercent: rate
        .refine((v) => Number.parseFloat(v) <= 100, 'commissionPercent cannot exceed 100')
        .optional(),
      registerBonus: rate.optional(),
      registerBonusCurrency: rewardCurrency.optional(),
      affiliateBonusCurrency: rewardCurrency.optional(),
      // The joining bonus waits for the referee's first deposit (migration 072).
      affiliateBonusRequiresDeposit: z.boolean().optional(),
      // hash.game's commission (migration 134): wager × 1% × commissionRate% × game rate%.
      commissionRate: percent.optional(),
      gameRates: z
        .object({ originals: percent.optional(), slots: percent.optional(), live: percent.optional(), sports: percent.optional() })
        .strict()
        .optional(),
    })
    .strict()
    // An update naming nothing would answer "updated successfully" having
    // changed nothing — legacy's `updates.length === 0` branch guarded this and
    // it is kept.
    .refine(
      (v) =>
        v.affiliateBonus !== undefined ||
        v.commissionPercent !== undefined ||
        v.registerBonus !== undefined ||
        v.registerBonusCurrency !== undefined ||
        v.affiliateBonusCurrency !== undefined ||
        v.affiliateBonusRequiresDeposit !== undefined ||
        v.commissionRate !== undefined ||
        v.gameRates !== undefined,
      { message: 'give at least one setting to change' }
    ),
};

/**
 * Welcome bonuses — the registration bonus switch + amount, and the tiered
 * first-deposit bonus. All amounts are USD. A patch: each group and each field
 * is optional, but the body must name at least one.
 *
 * Real booleans for the switches, for the reason `setSportsEnabled` gives.
 * `percent` is capped at 1000 (a 10x match) so a slipped key cannot store a
 * bonus of a million percent; a `maxBonus` of 0 means "no cap". Two tiers may
 * not share a minimum — which one applies would be undefined.
 */
const tier = z
  .object({
    minDeposit: rate,
    percent: rate.refine((v) => Number.parseFloat(v) > 0 && Number.parseFloat(v) <= 1000, 'percent must be above 0 and at most 1000'),
    maxBonus: rate,
  })
  .strict();

const updateWelcomeBonusSettings = {
  body: z
    .object({
      registerBonus: z
        .object({ enabled: z.boolean().optional(), amount: rate.optional() })
        .strict()
        .optional(),
      firstDepositBonus: z
        .object({
          enabled: z.boolean().optional(),
          tiers: z
            .array(tier)
            .max(20, 'at most 20 tiers')
            .refine(
              (list) => new Set(list.map((t) => Number.parseFloat(t.minDeposit))).size === list.length,
              'two tiers cannot have the same minimum deposit'
            )
            .optional(),
          wagerMultiplier: z.number().min(0).max(100).nullable().optional(),
          // Days an unwagered bonus stays in the bonus balance before it is forfeited (0 = never).
          expiryDays: z.number().int().min(0).max(3650).optional(),
        })
        .strict()
        .optional(),
      // Checked by the service (403 TXN_PASSWORD_REQUIRED / _INVALID), as the other money settings are.
      transactionPassword: z.string().min(1).max(200).optional(),
      // hash.game's deposit bonus program (migration 136).
      depositProgram: z
        .object({
          mode: z.enum(['first', 'monthly']).optional(),
          unlockMode: z.enum(['rollover', 'gradual']).optional(),
          unlockRate: percent.optional(),
          schedule: z
            .array(z.object({ percent: rate.refine((v) => Number.parseFloat(v) <= 1000, 'at most 1000%'), minDeposit: rate, maxBonus: rate }).strict())
            .max(10, 'at most 10 deposits a month')
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .refine(
      (v) =>
        [v.registerBonus, v.firstDepositBonus, v.depositProgram].some(
          (group) => group && Object.values(group).some((field) => field !== undefined)
        ),
      { message: 'give at least one setting to change' }
    ),
};

/**
 * Referral unlock tiers (migration 106) — the /referral/rules table. The whole
 * list is sent and replaces what is stored. `level` is the friend's VIP level
 * name as the player site prints it; `totalWager` and `unlockAmount` are exact
 * decimal strings in the reward currency (at most 12 integer digits, the
 * numeric(20,8) every other amount here fits). Two rows may not share a
 * wager — which one a friend reached would be undefined — nor a level.
 */
const unlockAmountString = rate.refine((v) => v.split('.')[0].length <= 12, 'at most 12 digits before the decimal point');

const unlockTier = z
  .object({
    level: z
      .string({ invalid_type_error: 'send the level as a string' })
      .transform((v) => v.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(1, 'give the level a name').max(40, 'at most 40 characters')),
    totalWager: unlockAmountString,
    unlockAmount: unlockAmountString,
  })
  .strict();

const updateReferralUnlockSettings = {
  body: z
    .object({
      tiers: z
        .array(unlockTier)
        .max(50, 'at most 50 rows')
        .refine(
          (list) => new Set(list.map((t) => Number.parseFloat(t.totalWager))).size === list.length,
          'two rows cannot have the same total wager'
        )
        .refine(
          (list) => new Set(list.map((t) => t.level.toLowerCase())).size === list.length,
          'two rows cannot have the same level'
        ),
    })
    .strict(),
};

/**
 * Tip limits (migration 081), all USD. Decimal strings ≥ 0 with at most 8
 * decimal places and at most 12 integer digits (the column is numeric(20,8)).
 * An empty string reads as "0" — no cap on a max, off for the wager rule.
 * A patch, but it must name at least one field.
 */
const usdLimit = z
  .string({ invalid_type_error: 'send this as a string, not a number' })
  .trim()
  .transform((v) => (v === '' ? '0' : v))
  .pipe(
    z
      .string()
      .regex(/^\d{1,12}(\.\d{1,8})?$/, 'must be a non-negative decimal with at most 8 decimal places')
  );

const updateTipSettings = {
  body: z
    .object({
      maxPerTipUsd: usdLimit.optional(),
      maxPerDayUsd: usdLimit.optional(),
      minWageredUsd: usdLimit.optional(),
    })
    .strict()
    .refine((v) => Object.values(v).some((field) => field !== undefined), {
      message: 'give at least one setting to change',
    }),
};

/**
 * The sports master switch.
 *
 * A real boolean, not a truthy string — `{"enabled":"false"}` would otherwise
 * turn sports ON, which is the wrong direction for a kill switch to fail in.
 */
const setSportsEnabled = {
  body: z.object({ enabled: z.boolean() }).strict(),
};

const setPaymentGateway = {
  params: z.object({ name: z.enum(PAYMENT_SWITCHES) }),
  body: z.object({ enabled: z.boolean(), transactionPassword: z.string().min(1).max(200) }).strict(),
};

/**
 * The site's reward currency (one coin for every reward). On an owner-managed
 * site a change is `403 OWNER_MANAGED` (the owner panel sets it); the old
 * `bonusCurrency` / `rakebackCurrency` names are still accepted and must agree.
 */
const updateRewardCurrencies = {
  body: z
    .object({
      rewardCurrency: rewardCurrency.optional(),
      bonusCurrency: rewardCurrency.optional(),
      rakebackCurrency: rewardCurrency.optional(),
    })
    .strict()
    .refine(
      (v) => v.rewardCurrency !== undefined || v.bonusCurrency !== undefined || v.rakebackCurrency !== undefined,
      { message: 'give the reward currency' }
    ),
};

/**
 * Outbound mail settings.
 *
 * `appPassword` is optional and only written when non-empty — saving the form
 * without retyping it keeps the existing credential, which is legacy's
 * behaviour and the right one.
 */
const updateEmailSettings = {
  body: z
    .object({
      sendFrom: z.string().trim().email().max(255).or(z.literal('')).optional(),
      alertsTo: z.string().trim().email().max(255).or(z.literal('')).optional(),
      appPassword: z.string().trim().min(1).max(200).optional(),
    })
    .strict()
    .refine(
      (v) => v.sendFrom !== undefined || v.alertsTo !== undefined || v.appPassword !== undefined,
      { message: 'give at least one setting to change' }
    ),
};

/**
 * The feature-flag screen.
 *
 * Every value is a real boolean and every key is checked against the service's
 * allow-list, so a body naming a column that is not a flag is REFUSED rather
 * than partially applied — legacy wrote whatever it was given, including
 * `gmailapppassword`. `.catchall` keeps the shape open enough that adding a
 * flag needs no change here, and closed enough that a string cannot become a
 * truthy toggle.
 */
/**
 * Only the operator flags `GET /global` returns (the admin sends the changed
 * subset). An unknown flag name used to be accepted and dropped by the
 * service; now it is a 422 naming the key. The list lives in the service,
 * which does not require this file, so there is no cycle.
 */
const { OPERATOR_FLAGS, OPERATOR_SETTINGS } = require('./siteConfig.service');
const updateGlobalSettings = {
  body: z
    .object(
      Object.fromEntries(
        OPERATOR_FLAGS.map((name) => [
          name,
          z.boolean({ invalid_type_error: 'a flag is true or false, not a string' }).optional(),
        ])
      )
    )
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'give at least one flag to change' }),
};

/**
 * PUT /settings: a patch of operator settings. Only the known names; the
 * service coerces and range-checks each value (`null` hands it back to the
 * deployment), so here a value only has to be a scalar.
 */
const updateOperatorSettings = {
  body: z
    .object(
      Object.fromEntries(
        Object.entries(OPERATOR_SETTINGS).map(([name, spec]) => [
          name,
          // A `text` setting is as long as its own `maxLength` (the forfeit popup message: 400).
          z.union([z.string().max(spec.maxLength ?? 100), z.number(), z.boolean(), z.null()]).optional(),
        ])
      )
    )
    .strict(),
};

const userParam = { params: z.object({ userId: z.coerce.number().int().positive() }) };

/**
 * A player's own preferences. UI state only — nothing here can lock an account
 * or change a limit, which is why it is not behind the transaction password
 * that guards `/lords/user-setting/*`.
 */
const updateUserSettings = {
  ...userParam,
  body: z
    .object({
      email_notifications: z.boolean().optional(),
      push_notifications: z.boolean().optional(),
      hide_balance: z.boolean().optional(),
      theme: z.enum(['dark', 'light']).optional(),
      language: z.string().trim().min(2).max(8).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'give at least one setting to change' }),
};

/**
 * Wager contribution rules (migration 135). Each rule names exactly ONE of category / provider /
 * gameRef, with a percent 0–100. The whole list replaces what is stored.
 */
const updateWagerContribution = {
  body: z
    .object({
      rules: z
        .array(
          z
            .object({
              category: z.enum(['originals', 'slots', 'live', 'sports']).nullable().optional(),
              provider: z.string().trim().min(1).max(120).nullable().optional(),
              gameRef: z.string().trim().min(1).max(190).nullable().optional(),
              percent: rate.refine((p) => Number.parseFloat(p) <= 100, 'a percent cannot exceed 100'),
            })
            .strict()
            .refine((r) => [r.category, r.provider, r.gameRef].filter(Boolean).length === 1, 'name exactly one of category, provider or game')
        )
        .max(2000),
    })
    .strict(),
};

/** hash.game reward formula (migration 137): mode + six percents. */
const updateRewardFormula = {
  body: z
    .object({
      mode: z.enum(['hash', 'fixed']).optional(),
      instant: percent.optional(),
      daily: percent.optional(),
      weeklyWager: percent.optional(),
      weeklyLoss: percent.optional(),
      monthlyWager: percent.optional(),
      monthlyLoss: percent.optional(),
    })
    .strict()
    .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'give at least one setting to change' }),
};

module.exports = {
  updateRewardFormula,
  updateWagerContribution,
  WALLET_CURRENCIES,
  updateAffiliateSettings,
  updateWelcomeBonusSettings,
  updateTipSettings,
  updateReferralUnlockSettings,
  setSportsEnabled,
  setPaymentGateway,
  updateRewardCurrencies,
  updateEmailSettings,
  updateGlobalSettings,
  updateOperatorSettings,
  userParam,
  updateUserSettings,
  rate,
};
