import { resolveOptions } from '@/configs/entitlementCatalogue'
import { cleanRegion, type RegionSetting } from './region'
import { diffWithdrawalCap, type WithdrawalCap } from './withdrawalCap'
import { diffWithdrawalDailyLimit, type WithdrawalDailyLimit } from './withdrawalDailyLimit'
import { diffPaymentMethods, type PaymentMethods } from './paymentMethods'
import { diffBranding, type Branding, type BrandingChange } from './branding'

/** Shapes shared by the routes and the screens — contract §2. */
export type EntitlementsDoc = {
  site: string
  version: number
  updatedAt: string

  /** Template key (configs/templateCatalogue): theme + preset. Set by the owner only; missing in an older file = DEFAULT_TEMPLATE. */
  template: string

  /** Feature key → ON for the site (the client can no longer switch features, so entitled == on). */
  features: Record<string, boolean>
  flags: Record<string, boolean>

  /**
   * Feature key → variant key, every catalogue feature incl. the policies business_model /
   * deposit_mode / withdrawal_mode. Missing (an older document) or a missing key = the backend
   * keeps the site's current variant.
   */
  variants?: Record<string, string>

  /**
   * Coins the owner adds beyond the site's built-in ones (phase B: the backend creates them in
   * its `currencies` registry, balances in `wallet_balances`). Absent in older documents = none.
   * Built-in coins are switched through `flags[<code lower-case>]`, never here. Never shrinks:
   * a coin is switched off (`enabled: false`), not removed.
   */
  coins?: CoinDefinition[]

  /**
   * Owner-only feature options (`FEATURE_OPTIONS` in configs/entitlementCatalogue), e.g. when the
   * spin wheel grants a spin. Absent in an older document = every default.
   */
  options?: Record<string, Record<string, boolean>>

  /**
   * Region restriction's list type and countries (./region). The mode is `variants.region_restriction`.
   * Absent in an older document = an empty blocklist.
   */
  region?: RegionSetting

  /**
   * Withdrawal requirements' deposit cap (./withdrawalCap). KYC and wagering are
   * `variants.withdrawal_requirements`. Absent in an older document = the cap is off.
   */
  withdrawalCap?: WithdrawalCap

  /**
   * Daily withdrawal limit per currency, rolling 24 hours (./withdrawalDailyLimit). Absent in an
   * older document = off.
   */
  withdrawalDailyLimit?: WithdrawalDailyLimit

  /**
   * Payment gateway deposit methods per currency (./paymentMethods), e.g. F2Pay's UPI for INR, each
   * active or not. Absent in an older document = none listed.
   */
  paymentMethods?: PaymentMethods

  /**
   * Master switch for player withdrawals on every rail (bank, crypto, gateway payouts, P2P sell).
   * Absent in an older document = on.
   */
  withdrawalsEnabled?: boolean

  /**
   * Site name, page metadata and logo files (./branding, contract §8). Absent in an older
   * document = not branded: the site keeps its own name and the UI's own logo.
   */
  branding?: Branding
}

/**
 * A custom coin definition (phase B). `code` matches ^[A-Z][A-Z0-9]{1,9}$, is not a built-in
 * coin and never changes. `decimals` 0–8; `usdRate` the fixed USD value of one unit (a decimal
 * string > 0, ≤ 8 places) — what swap prices it at; `networks` only for crypto (labels: a
 * custom coin has no deposit or withdrawal rail).
 */
export type CoinDefinition = {
  code: string
  kind: 'fiat' | 'crypto' | 'points'
  name: string
  symbol?: string
  decimals?: number
  usdRate?: string
  networks?: { key: string; name: string }[]
  enabled?: boolean
}

/** One coin as the site reports it to the owner panel (`GET /api/owner/coins`). */
export type SiteCoin = {
  code: string
  kind: 'fiat' | 'crypto' | 'points'
  name: string
  symbol: string
  builtin: boolean
  retired: boolean
  decimals?: number
  usdRate?: string | null
  imageUrl: string | null
  ownerEnabled: boolean
  siteEnabled: boolean | null
  networks: { key: string; name: string }[]
}

/** One row of the site's `payment_methods` table (`GET /api/owner/payment-methods`). */
export type SiteMethod = {
  gateway: string
  currency: string
  code: string
  ownerEnabled: boolean
  siteEnabled: boolean
  addedBy: 'site' | 'owner'
}

/** Where the variants of an older document (without `variants`) were filled from for editing. */
export type VariantsSeed = 'backend' | 'template' | null

/** What the owner screen edits: the document with a full `variants` map. */
export type EditableDoc = EntitlementsDoc & { variants: Record<string, string>; options: Record<string, Record<string, boolean>>; region: RegionSetting; withdrawalCap: WithdrawalCap; withdrawalDailyLimit: WithdrawalDailyLimit; paymentMethods: PaymentMethods; withdrawalsEnabled: boolean; branding: Branding; seededFrom: VariantsSeed }

export type ToggleChange = { kind: 'feature' | 'flag'; key: string; from: boolean; to: boolean }
export type TemplateChange = { kind: 'template'; key: 'template'; from: string | null; to: string }
export type VariantChange = { kind: 'variant'; key: string; from: string | null; to: string }

/** A feature option switched (audit kind `option`); `key` is `<feature>.<option>`. */
export type OptionChange = { kind: 'option'; key: string; from: boolean; to: boolean }

/** Audit lines written before per-coin entries existed: the custom coin codes before and after. */
export type CoinsChange = { kind: 'coins'; key: 'coins'; from: string[]; to: string[] }

/** One custom coin added, edited, switched on or switched off (audit kind `coin`). */
export type CoinChange = { kind: 'coin'; key: string; action: 'added' | 'edited' | 'enabled' | 'disabled'; from: CoinDefinition | null; to: CoinDefinition }

/** Region restriction's list type or countries changed (audit kind `region`). */
export type RegionChange = { kind: 'region'; key: 'region'; from: RegionSetting; to: RegionSetting }

/** Withdrawal requirements' deposit cap switched or re-set (audit kind `withdrawal_cap`). */
export type WithdrawalCapChange = { kind: 'withdrawal_cap'; key: 'withdrawalCap'; from: WithdrawalCap; to: WithdrawalCap }

/** The daily withdrawal limit switched or a currency's amount changed (audit kind `withdrawal_daily_limit`). */
export type WithdrawalDailyLimitChange = { kind: 'withdrawal_daily_limit'; key: 'withdrawalDailyLimit'; from: WithdrawalDailyLimit; to: WithdrawalDailyLimit }

/** A gateway's deposit methods added, removed or switched (audit kind `payment_methods`). */
export type PaymentMethodsChange = { kind: 'payment_methods'; key: 'paymentMethods'; from: PaymentMethods; to: PaymentMethods }

/** Player withdrawals switched on or off on every rail (audit kind `withdrawals_enabled`). */
export type WithdrawalsEnabledChange = { kind: 'withdrawals_enabled'; key: 'withdrawalsEnabled'; from: boolean; to: boolean }

export type { BrandingChange }
export type Change = ToggleChange | TemplateChange | VariantChange | CoinsChange | CoinChange | OptionChange | RegionChange | WithdrawalCapChange | WithdrawalDailyLimitChange | PaymentMethodsChange | WithdrawalsEnabledChange | BrandingChange

export type AuditEntry = { at: string; user: string; version: number; changes: Change[]; seededFrom?: Exclude<VariantsSeed, null> }

export type Probe = { url: string; ok: boolean; status: number | null; ms: number | null; error?: string }

export type Overview = {
  site: { key: string; name: string; gatewayUrl: string; adminUrl: string; frontendUrl: string }
  health: { gateway: Probe; admin: Probe; frontend: Probe }
  entitlements: { version: number; updatedAt: string; template: string; lastSave: AuditEntry | null; entitled: number; blocked: number; total: number }
}

type Diffable = Pick<EntitlementsDoc, 'features' | 'flags'> & {
  template?: string | null
  variants?: Record<string, string>
  options?: Record<string, Record<string, boolean>>
  region?: RegionSetting
  withdrawalCap?: WithdrawalCap
  withdrawalDailyLimit?: WithdrawalDailyLimit
  paymentMethods?: PaymentMethods
  withdrawalsEnabled?: boolean
  branding?: Branding
}

/** The template (if it moved), every variant that moved, then every key the two maps disagree on, in catalogue order. */
export function diffDocs(before: Diffable, after: Diffable) {
  const changes: Change[] = []

  if (after.template && after.template !== before.template) {
    changes.push({ kind: 'template', key: 'template', from: before.template ?? null, to: after.template })
  }

  for (const [key, to] of Object.entries(after.variants ?? {})) {
    const from = before.variants?.[key] ?? null

    if (from !== to) changes.push({ kind: 'variant', key, from, to })
  }

  for (const kind of ['feature', 'flag'] as const) {
    const a = kind === 'feature' ? before.features : before.flags
    const b = kind === 'feature' ? after.features : after.flags

    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const from = a[key] !== false
      const to = b[key] !== false

      if (from !== to) changes.push({ kind, key, from, to })
    }
  }

  // Options compare with defaults filled in, so an older document (no options) never reads as changed.
  const a = resolveOptions(before.options)
  const b = resolveOptions(after.options)

  for (const [feature, values] of Object.entries(b)) {
    for (const [option, to] of Object.entries(values)) {
      const from = a[feature]?.[option]

      if (from !== to) changes.push({ kind: 'option', key: `${feature}.${option}`, from: !!from, to })
    }
  }

  // Region: compared cleaned, so an older document (no region) equals an empty blocklist.
  if (after.region) {
    const from = cleanRegion(before.region)
    const to = cleanRegion(after.region)

    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ kind: 'region', key: 'region', from, to })
  }

  // Withdrawal cap: compared cleaned, so an older document (no block) equals the cap off.
  const capChange = after.withdrawalCap ? diffWithdrawalCap(before.withdrawalCap, after.withdrawalCap) : null

  if (capChange) changes.push(capChange)

  // Daily limit: compared cleaned, so an older document (no block) equals off.
  const dailyChange = after.withdrawalDailyLimit ? diffWithdrawalDailyLimit(before.withdrawalDailyLimit, after.withdrawalDailyLimit) : null

  if (dailyChange) changes.push(dailyChange)

  // Payment methods: compared cleaned, so an older document (no block) equals none listed.
  const methodsChange = after.paymentMethods ? diffPaymentMethods(before.paymentMethods, after.paymentMethods) : null

  if (methodsChange) changes.push(methodsChange)

  // Withdrawals master switch: an older document (no key) equals on.
  if (after.withdrawalsEnabled !== undefined && (before.withdrawalsEnabled !== false) !== after.withdrawalsEnabled) {
    changes.push({ kind: 'withdrawals_enabled', key: 'withdrawalsEnabled', from: before.withdrawalsEnabled !== false, to: after.withdrawalsEnabled })
  }

  // Branding: one change per field; an older document (no branding) equals an empty one.
  if (after.branding) changes.push(...diffBranding(before.branding, after.branding))

  return changes
}
