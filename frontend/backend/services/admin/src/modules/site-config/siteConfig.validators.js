'use strict';

const { z } = require('@ibitplay/common');

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
    })
    .strict()
    // An update naming nothing would answer "updated successfully" having
    // changed nothing — legacy's `updates.length === 0` branch guarded this and
    // it is kept.
    .refine(
      (v) =>
        v.affiliateBonus !== undefined ||
        v.commissionPercent !== undefined ||
        v.registerBonus !== undefined,
      { message: 'give at least one setting to change' }
    ),
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
const updateGlobalSettings = {
  body: z
    .object({})
    .catchall(z.boolean({ invalid_type_error: 'a flag is true or false, not a string' }))
    .refine((v) => Object.keys(v).length > 0, { message: 'give at least one flag to change' }),
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

module.exports = {
  updateAffiliateSettings,
  setSportsEnabled,
  updateEmailSettings,
  updateGlobalSettings,
  userParam,
  updateUserSettings,
  rate,
};
