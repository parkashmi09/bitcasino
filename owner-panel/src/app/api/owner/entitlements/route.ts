import type { NextRequest } from 'next/server'

import { serverConfig } from '@/configs/site'
import { coinProblem } from '@/lib/entitlements/coins'
import { readForEdit, saveEntitlements } from '@/lib/entitlements/store'
import { siteMethods } from '@/lib/entitlements/siteMethods'
import type { CoinDefinition } from '@/lib/entitlements/types'
import type { RegionSetting } from '@/lib/entitlements/region'
import type { WithdrawalCap } from '@/lib/entitlements/withdrawalCap'
import type { WithdrawalDailyLimit } from '@/lib/entitlements/withdrawalDailyLimit'
import type { PaymentMethods } from '@/lib/entitlements/paymentMethods'
import type { Branding } from '@/lib/entitlements/branding'
import type { OwnerPalette } from '@/lib/entitlements/palettes'
import { handler, HttpError, ok } from '@/lib/owner/guard'

export const dynamic = 'force-dynamic'

/**
 * The document with a full `variants` map (an older document is filled for editing, not written), and
 * the site's payment methods (seeded, the Super Admin's and the owner's) for the F2Pay methods editor.
 */
export const GET = handler(async () => {
  const [doc, methods] = await Promise.all([readForEdit(), siteMethods()])

  return ok({ ...doc, siteMethods: methods })
})

const boolMap = (value: unknown, name: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'VALIDATION_ERROR', `${name} must be an object`)
  for (const [k, v] of Object.entries(value)) if (typeof v !== 'boolean') throw new HttpError(400, 'VALIDATION_ERROR', `${name}.${k} must be true or false`)

  return value as Record<string, boolean>
}

const stringMap = (value: unknown, name: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'VALIDATION_ERROR', `${name} must be an object`)
  for (const [k, v] of Object.entries(value)) if (typeof v !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', `${name}.${k} must be a variant key`)

  return value as Record<string, string>
}

/**
 * Custom coin definitions (coin management phase B): the whole list, every entry valid —
 * code ^[A-Z][A-Z0-9]{1,9}$ and not a built-in coin, name, symbol, kind crypto/fiat/points,
 * decimals 0–8, USD rate > 0 (≤ 8 places), networks (crypto only, key + name), enabled.
 * The store then refuses a save that drops an existing code (COIN_DELETE_REFUSED): codes are
 * immutable and a coin is only ever switched off.
 */
const coinList = (value: unknown): CoinDefinition[] => {
  if (!Array.isArray(value)) throw new HttpError(400, 'VALIDATION_ERROR', 'coins must be a list')
  if (value.length > 200) throw new HttpError(400, 'VALIDATION_ERROR', 'at most 200 custom coins')
  const seen = new Set<string>()

  for (const [i, raw] of value.entries()) {
    const problem = coinProblem(raw as CoinDefinition)

    if (problem) throw new HttpError(400, 'VALIDATION_ERROR', `coins[${i}]: ${problem}`)
    const code = (raw as CoinDefinition).code

    if (seen.has(code)) throw new HttpError(400, 'VALIDATION_ERROR', `coins[${i}]: ${code} is listed twice`)
    seen.add(code)
  }

  return value as CoinDefinition[]
}

/** `{ <feature>: { <option>: boolean } }`; the store checks the keys against the catalogue. */
const optionMap = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'VALIDATION_ERROR', 'options must be an object')

  return Object.fromEntries(Object.entries(value).map(([feature, v]) => [feature, boolMap(v, `options.${feature}`)]))
}

export const PUT = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as {
    version?: unknown
    template?: unknown
    features?: unknown
    flags?: unknown
    variants?: unknown
    coins?: unknown
    options?: unknown
    region?: unknown
    withdrawalCap?: unknown
    withdrawalDailyLimit?: unknown
    paymentMethods?: unknown
    withdrawalsEnabled?: unknown
    branding?: unknown
    palettes?: unknown
  } | null

  if (!body || !Number.isInteger(body.version)) throw new HttpError(400, 'VALIDATION_ERROR', 'version is required')

  if (body.template !== undefined && typeof body.template !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', 'template must be a string')

  const result = await saveEntitlements(
    {
      version: body.version as number,
      template: body.template as string | undefined,
      features: boolMap(body.features ?? {}, 'features'),
      flags: boolMap(body.flags ?? {}, 'flags'),

      // Known feature and variant keys only — checked in the store.
      variants: body.variants === undefined ? undefined : stringMap(body.variants, 'variants'),

      // Custom coin definitions (phase B): validated here, then against the stored list (no delete).
      coins: body.coins === undefined ? undefined : coinList(body.coins),

      // Owner-only feature options (e.g. when the spin wheel grants a spin).
      options: body.options === undefined ? undefined : optionMap(body.options),

      // Region restriction's list type + countries; validated in the store (bad code → 422).
      region: body.region === undefined ? undefined : (body.region as RegionSetting),

      // Withdrawal requirements' deposit cap; validated strictly in the store (bad multiplier → 422).
      withdrawalCap: body.withdrawalCap === undefined ? undefined : (body.withdrawalCap as WithdrawalCap),

      // Daily withdrawal limit per currency; validated strictly in the store (bad code / amount → 422).
      withdrawalDailyLimit:
        body.withdrawalDailyLimit === undefined ? undefined : (body.withdrawalDailyLimit as WithdrawalDailyLimit),

      // Payment gateway methods per currency; validated strictly in the store (bad code / repeat → 422).
      paymentMethods: body.paymentMethods === undefined ? undefined : (body.paymentMethods as PaymentMethods),

      // Player withdrawals on every rail; validated strictly in the store (not a boolean → 422).
      withdrawalsEnabled: body.withdrawalsEnabled as boolean | undefined,

      // Site name, metadata and logo files; validated strictly in the store (bad field → 422).
      branding: body.branding === undefined ? undefined : (body.branding as Partial<Branding>),

      // rainbet: the owner's own colour themes; validated strictly in the store (bad colour → 400).
      palettes: body.palettes === undefined ? undefined : (body.palettes as OwnerPalette[])
    },
    serverConfig.ownerUsername
  )

  // A saved change is already live: the backend stored, applied and pushed it to open sites (contract §3).
  const live = result.changes.length ? { live: true, version: result.doc.version } : undefined

  return ok({ ...result, live })
})
