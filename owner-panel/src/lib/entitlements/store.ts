import 'server-only'

import { createHmac, createPrivateKey, sign as edSign, type KeyObject } from 'node:crypto'

import { DEFAULT_OFF_FLAGS, FEATURE_CATALOGUE, FEATURE_KEYS, FEATURE_OPTIONS, featureByKey, FLAG_GROUPS, FLAG_KEYS, isPolicy, isVariantOf, resolveOptions } from '@/configs/entitlementCatalogue'
import { serverConfig } from '@/configs/site'
import { pinToUi, SITE_UI } from '@/configs/siteUi'
import { DEFAULT_TEMPLATE, resolveTemplateKey, templateByKey, TEMPLATE_KEYS } from '@/configs/templateCatalogue'
import { HttpError } from '@/lib/owner/guard'
import { brandingProblem, BRANDING_SLOTS, cleanBranding, type Branding } from './branding'
import { ownerJson } from './backend'
import { assetExists } from './brandingAssets'
import { coinSwitchedOff } from './coinGate'
import { cleanCoin, coinProblem, diffCoins, droppedCoins } from './coins'
import { cleanRegion, regionProblem, type RegionSetting } from './region'
import { cleanWithdrawalCap, withdrawalCapProblem, type WithdrawalCap } from './withdrawalCap'
import { cleanWithdrawalDailyLimit, withdrawalDailyLimitProblem, type WithdrawalDailyLimit } from './withdrawalDailyLimit'
import { cleanPaymentMethods, paymentMethodsProblem, type PaymentMethods } from './paymentMethods'
import { cleanPalettes, type OwnerPalette } from './palettes'
import { diffDocs, type AuditEntry, type Change, type CoinDefinition, type EditableDoc, type EntitlementsDoc, type VariantsSeed } from './types'

/**
 * The entitlements document and its audit trail live in the site database (owner_entitlements,
 * owner_audit), read and written through the backend's owner API (./backend) — never a local
 * file, so every owner panel pointed at the same SITE_GATEWAY_URL shows the same data. This
 * panel validates, normalises and SIGNS; the backend verifies the signature and the version
 * order, stores, applies and pushes the change to open sites (contract §2, §3).
 */

/** The full catalogue, every key present; a key the file lacks reads as entitled. */
function complete(map: Record<string, unknown> | undefined, keys: string[]) {
  const out: Record<string, boolean> = {}

  for (const key of keys) out[key] = map && key in map ? map[key] !== false : !DEFAULT_OFF_FLAGS.has(key)

  // Keep keys the catalogue no longer lists, so an older value is not silently dropped.
  for (const [key, value] of Object.entries(map ?? {})) if (!(key in out)) out[key] = value !== false

  return out
}

/**
 * A feature this UI does not have (siteUi `absent`) reads as OFF even before the owner's next
 * save writes it: a key added to the catalogue later (e.g. `p2p`) would otherwise read as
 * entitled from a document that predates it, while the panel shows it off.
 */
function offWhereAbsent(features: Record<string, boolean>) {
  for (const [key, s] of Object.entries(SITE_UI)) if (s.status === 'absent') features[key] = false

  return features
}

/** Only catalogue features, only their own variant keys; anything else is dropped (read) or refused (save). */
function knownVariants(map: unknown) {
  const out: Record<string, string> = {}

  if (!map || typeof map !== 'object' || Array.isArray(map)) return out

  for (const [key, value] of Object.entries(map)) if (typeof value === 'string' && isVariantOf(key, value)) out[key] = value

  return out
}

/**
 * The rule that ties ON to VARIANT (contract §2): a policy is always on (its variant is the
 * policy); any other feature on variant `none` is off.
 */
const FIAT_COIN_FLAGS = new Set(FLAG_GROUPS.find(g => g.title === 'Fiat currencies')?.keys ?? [])

function normalise(features: Record<string, boolean>, variants: Record<string, string>) {
  const out = { ...features }

  for (const f of FEATURE_CATALOGUE) {
    if (f.policy) out[f.key] = true
    else if (variants[f.key] === 'none') out[f.key] = false
  }

  return out
}

/**
 * Custom coin definitions (phase B). Reading drops anything malformed; saving (strict) refuses
 * it. Built-in coins never appear here — they are switched through `flags`. Rules in ./coins.
 */
export function knownCoins(list: unknown, strict = false): CoinDefinition[] {
  if (list === undefined || list === null) return []

  if (!Array.isArray(list)) {
    if (strict) throw new HttpError(400, 'VALIDATION_ERROR', 'coins must be an array')

    return []
  }

  const out: CoinDefinition[] = []

  for (const [i, raw] of list.entries()) {
    const c = raw as CoinDefinition
    const problem = coinProblem(c) ?? (out.some(o => o.code === c.code) ? 'code is listed twice' : null)

    if (problem) {
      if (strict) throw new HttpError(400, 'VALIDATION_ERROR', `coins[${i}]: ${problem}`)
      continue
    }

    out.push(cleanCoin(c))
  }

  return out
}

export async function readEntitlements(): Promise<EntitlementsDoc> {
  const { doc: stored } = await ownerJson<{ version: number; doc: Partial<EntitlementsDoc> | null }>('/entitlements')

  if (!stored) {
    // Nothing stored yet: everything entitled — today's behaviour. Written by the first save.
    return {
      site: serverConfig.siteKey,
      version: 1,
      updatedAt: new Date().toISOString(),
      template: DEFAULT_TEMPLATE,
      features: complete({}, FEATURE_KEYS),
      flags: complete({}, FLAG_KEYS)

      // No `variants`: the backend keeps the site's current ones until the owner's first save.
    }
  }

  return {
    site: stored.site ?? serverConfig.siteKey,
    version: Number(stored.version) || 1,
    updatedAt: stored.updatedAt ?? new Date(0).toISOString(),

    // An old name (e.g. from before the rename) reads as its current key; a file without one
    // runs DEFAULT_TEMPLATE, and the next save writes it — nothing is written here.
    template: typeof stored.template === 'string' && stored.template ? resolveTemplateKey(stored.template) : DEFAULT_TEMPLATE,
    features: offWhereAbsent(complete(stored.features, FEATURE_KEYS)),
    flags: complete(stored.flags, FLAG_KEYS),

    // Absent in an older document: the backend then keeps the site's current variants.
    ...(stored.variants ? { variants: knownVariants(stored.variants) } : {}),

    // Absent = no custom coins; only written once present.
    ...(stored.coins !== undefined ? { coins: knownCoins(stored.coins) } : {}),

    // Owner-only feature options; absent = every default (the backend fills them the same way).
    ...(stored.options !== undefined ? { options: resolveOptions(stored.options) } : {}),

    // Region restriction's list type + countries; absent = an empty blocklist (nobody restricted).
    ...(stored.region !== undefined ? { region: cleanRegion(stored.region) } : {}),

    // Withdrawal requirements' deposit cap; absent = off (KYC / wagering are the policy's variant).
    ...(stored.withdrawalCap !== undefined ? { withdrawalCap: cleanWithdrawalCap(stored.withdrawalCap) } : {}),

    // Daily withdrawal limit per currency; absent = off.
    ...(stored.withdrawalDailyLimit !== undefined ? { withdrawalDailyLimit: cleanWithdrawalDailyLimit(stored.withdrawalDailyLimit) } : {}),

    // Payment gateway deposit methods per currency; absent = none listed.
    ...(stored.paymentMethods !== undefined ? { paymentMethods: cleanPaymentMethods(stored.paymentMethods) } : {}),

    // Player withdrawals on every rail; absent = on.
    ...(stored.withdrawalsEnabled !== undefined ? { withdrawalsEnabled: stored.withdrawalsEnabled !== false } : {}),

    // Site name, metadata and logo files (./branding); absent = not branded, the site keeps its own.
    ...(stored.branding !== undefined ? { branding: cleanBranding(stored.branding) } : {}),

    // rainbet: the owner's own colour themes (./palettes); absent = none.
    ...(stored.palettes !== undefined ? { palettes: cleanPalettes(stored.palettes) } : {})
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * The site's live state, from the players' view `GET <SITE_GATEWAY_URL>/api/v1/admin/features/public`:
 * every feature that is on, with its variant, plus the policies. Null when unreachable.
 */
async function liveVariants(): Promise<Map<string, string> | null> {
  const base = serverConfig.gatewayUrl.replace(/\/$/, '')

  if (!base) return null

  try {
    const { protocol, hostname } = new URL(base)

    if (protocol !== 'https:' && !(protocol === 'http:' && LOOPBACK.has(hostname))) return null

    const res = await fetch(`${base}/api/v1/admin/features/public`, { cache: 'no-store', signal: AbortSignal.timeout(3_000) })
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: { feature?: unknown; variant?: unknown }[] } | null

    if (!res.ok || !body?.success || !Array.isArray(body.data)) return null

    const out = new Map<string, string>()

    for (const row of body.data) {
      if (typeof row.feature === 'string' && typeof row.variant === 'string' && isVariantOf(row.feature, row.variant)) out.set(row.feature, row.variant)
    }

    return out
  } catch {
    return null
  }
}

/**
 * The document as the owner screen edits it: always a full `variants` map. An older document
 * (no `variants`, or a key the catalogue added since) is filled from the site's live state when
 * the backend answers — a feature missing there is off — else from the current template. Nothing
 * is written here; the next save writes the full map (contract §2).
 */
export async function readForEdit(): Promise<EditableDoc> {
  const doc = await readEntitlements()
  const stored = doc.variants ?? {}

  const options = resolveOptions(doc.options)
  const region = cleanRegion(doc.region)
  const withdrawalCap = cleanWithdrawalCap(doc.withdrawalCap)
  const withdrawalDailyLimit = cleanWithdrawalDailyLimit(doc.withdrawalDailyLimit)
  const paymentMethods = cleanPaymentMethods(doc.paymentMethods)
  const withdrawalsEnabled = doc.withdrawalsEnabled !== false
  const branding = cleanBranding(doc.branding)

  if (FEATURE_KEYS.every(key => key in stored)) return { ...doc, variants: { ...stored }, options, region, withdrawalCap, withdrawalDailyLimit, paymentMethods, withdrawalsEnabled, branding, seededFrom: null }

  const live = await liveVariants()
  const template = templateByKey(doc.template)
  const seededFrom: VariantsSeed = live ? 'backend' : 'template'
  const variants: Record<string, string> = { ...stored }
  const features = { ...doc.features }

  for (const f of FEATURE_CATALOGUE) {
    if (f.key in stored) continue

    // The one Google switch replaced the `google_login` flag: a saved flag off stays off.
    if (f.key === 'google_signin' && doc.flags?.google_login === false) {
      variants[f.key] = 'off'
      continue
    }

    const fromTemplate = template?.variants[f.key]
    const fallback = f.policy ? (f.defaultVariant ?? f.variants[0].key) : 'none'

    if (live) {
      const on = live.get(f.key)

      // The public view lists only what is on (and in the plan).
      variants[f.key] = on ?? (fromTemplate && isVariantOf(f.key, fromTemplate) ? fromTemplate : fallback)
      if (!isPolicy(f.key)) features[f.key] = features[f.key] !== false && on !== undefined && on !== 'none'
    } else {
      variants[f.key] = fromTemplate && isVariantOf(f.key, fromTemplate) ? fromTemplate : fallback
    }
  }

  return { ...doc, features: normalise(features, variants), variants, options, region, withdrawalCap, withdrawalDailyLimit, paymentMethods, withdrawalsEnabled, branding, seededFrom }
}

// One save at a time inside this process; the version check guards against a stale screen.
let queue: Promise<unknown> = Promise.resolve()

export function saveEntitlements(
  input: {
    version: number
    template?: string
    features: Record<string, boolean>
    flags: Record<string, boolean>
    variants?: Record<string, string>
    coins?: CoinDefinition[]
    options?: Record<string, Record<string, boolean>>
    region?: RegionSetting
    withdrawalCap?: WithdrawalCap
    withdrawalDailyLimit?: WithdrawalDailyLimit
    paymentMethods?: PaymentMethods
    withdrawalsEnabled?: boolean
    branding?: Partial<Branding>
    palettes?: OwnerPalette[]
  },
  user: string
) {
  const run = async (): Promise<{ doc: EntitlementsDoc; changes: Change[] }> => {
    // Diffed against what the screen showed, so filling an older document's variants is not
    // reported as an owner change (the audit line records `seededFrom` instead).
    const { seededFrom, ...current } = await readForEdit()

    if (input.version !== current.version) {
      throw new HttpError(409, 'VERSION_CONFLICT', `Saved as version ${current.version} since you loaded version ${input.version}. Reload and try again.`)
    }

    // rainbet: the owner's own colour themes; the template may name one of them.
    let palettes = current.palettes

    if (input.palettes !== undefined) {
      try {
        palettes = cleanPalettes(input.palettes, true)
      } catch (error) {
        throw new HttpError(400, 'VALIDATION_ERROR', `palettes: ${(error as Error).message}`)
      }
    }

    const ownTheme = (key: string) => (palettes ?? []).some(p => p.key === key)
    const template = input.template === undefined ? current.template : ownTheme(input.template) ? input.template : resolveTemplateKey(input.template)

    if (input.template !== undefined && !TEMPLATE_KEYS.includes(template) && !ownTheme(template)) throw new HttpError(400, 'VALIDATION_ERROR', `template must be one of ${TEMPLATE_KEYS.join(', ')} or one of your own themes`)
    if (template.startsWith('custom_') && !ownTheme(template)) throw new HttpError(400, 'VALIDATION_ERROR', 'The active template is a theme you are removing — pick another template first')

    for (const [key, value] of Object.entries(input.variants ?? {})) {
      if (!FEATURE_KEYS.includes(key)) throw new HttpError(400, 'VALIDATION_ERROR', `variants.${key} is not a catalogue feature`)
      if (typeof value !== 'string' || !isVariantOf(key, value)) throw new HttpError(400, 'VALIDATION_ERROR', `variants.${key} is not a variant of ${key}`)
    }

    const variants = { ...current.variants, ...input.variants }

    // Owner-only options: catalogue features and options only, booleans only.
    for (const [feature, values] of Object.entries(input.options ?? {})) {
      const known = FEATURE_OPTIONS[feature]

      if (!known) throw new HttpError(400, 'VALIDATION_ERROR', `options.${feature} has no options`)

      for (const [key, value] of Object.entries(values ?? {})) {
        if (!known.some(o => o.key === key)) throw new HttpError(400, 'VALIDATION_ERROR', `options.${feature}.${key} is not an option`)
        if (typeof value !== 'boolean') throw new HttpError(400, 'VALIDATION_ERROR', `options.${feature}.${key} must be true or false`)
      }
    }

    const options = resolveOptions(
      Object.fromEntries(Object.keys(FEATURE_OPTIONS).map(f => [f, { ...current.options[f], ...input.options?.[f] }]))
    )

    // Region restriction: list type + ISO codes, exact. A bad code is 422 (well-formed, not acceptable).
    if (input.region !== undefined) {
      const problem = regionProblem(input.region)

      if (problem) throw new HttpError(422, 'VALIDATION_ERROR', problem)
    }

    const region = input.region !== undefined ? cleanRegion(input.region) : current.region

    // Withdrawal requirements' deposit cap: two switches and two multipliers (> 0, ≤ 100, 2 dp), exact.
    if (input.withdrawalCap !== undefined) {
      const problem = withdrawalCapProblem(input.withdrawalCap)

      if (problem) throw new HttpError(422, 'VALIDATION_ERROR', problem)
    }

    const withdrawalCap = input.withdrawalCap !== undefined ? cleanWithdrawalCap(input.withdrawalCap) : current.withdrawalCap

    // Daily withdrawal limit: currency codes and positive amounts (≤ 8 dp), exact.
    if (input.withdrawalDailyLimit !== undefined) {
      const problem = withdrawalDailyLimitProblem(input.withdrawalDailyLimit)

      if (problem) throw new HttpError(422, 'VALIDATION_ERROR', problem)
    }

    const withdrawalDailyLimit =
      input.withdrawalDailyLimit !== undefined ? cleanWithdrawalDailyLimit(input.withdrawalDailyLimit) : current.withdrawalDailyLimit

    // Payment gateway methods: gateway, currency and method codes, no repeats, exact.
    if (input.paymentMethods !== undefined) {
      const problem = paymentMethodsProblem(input.paymentMethods)

      if (problem) throw new HttpError(422, 'VALIDATION_ERROR', problem)
    }

    const paymentMethods = input.paymentMethods !== undefined ? cleanPaymentMethods(input.paymentMethods) : current.paymentMethods

    // Player withdrawals master switch: true or false, exact.
    if (input.withdrawalsEnabled !== undefined && typeof input.withdrawalsEnabled !== 'boolean') {
      throw new HttpError(422, 'VALIDATION_ERROR', 'withdrawalsEnabled must be true or false')
    }

    const withdrawalsEnabled = input.withdrawalsEnabled ?? current.withdrawalsEnabled

    // Branding: strict (unknown field, bad text, bad colour → 422), and every image it names
    // must be one uploaded here — the document is what vouches for the bytes the site fetches.
    let branding = current.branding

    if (input.branding !== undefined) {
      const problem = brandingProblem(input.branding)

      if (problem) throw new HttpError(422, 'VALIDATION_ERROR', problem)
      branding = cleanBranding({ ...current.branding, ...input.branding })

      for (const slot of BRANDING_SLOTS) {
        const asset = branding[slot]

        if (asset && !(await assetExists(asset.file))) throw new HttpError(422, 'BRANDING_FILE_MISSING', `${slot}: ${asset.file} was not uploaded here`)
      }
    }

    // This client's UI (configs/siteUi.ts): toggles keep the owner's ON/OFF on the one bc.game
    // variant, fixed features stay on, features the UI does not have stay off.
    const pinned = pinToUi(complete({ ...current.features, ...input.features }, FEATURE_KEYS), variants)

    const flags = complete({ ...current.flags, ...input.flags }, FLAG_KEYS)

    // The default coin and the reward coin must be coins the site actually offers: a switched-off
    // coin would open every money screen (and value every promotion) in a currency players can't hold.
    for (const key of ['default_currency', 'reward_currency']) {
      const coin = String(pinned.variants[key] ?? '').toLowerCase()

      if (coin && coinSwitchedOff(coin, flags, FIAT_COIN_FLAGS)) {
        const label = featureByKey(key)?.label ?? key
        const COIN = coin.toUpperCase()
        const why = flags[coin] === false ? `${COIN} is switched off under Site flags` : 'Crypto wallets (master) is switched off under Site flags'

        throw new HttpError(422, 'VALIDATION_ERROR', `Not saved: ${label} is ${COIN}, but ${why}. Turn ${COIN} back on, or first change ${label} to a coin that is on, then save.`)
      }
    }

    const next = {
      template,
      features: normalise(pinned.features, pinned.variants),
      flags,
      variants: pinned.variants,
      options,
      region,
      withdrawalCap,
      withdrawalDailyLimit,
      paymentMethods,
      withdrawalsEnabled,
      branding,
      ...(palettes !== undefined ? { palettes } : {})
    }

    const changes = diffDocs(current, next)

    // Custom coins (phase B): kept as they are unless the save names them. Never shrinks — a coin
    // is switched off, not removed (and so its code, which balances are keyed by, never changes).
    const coins = input.coins !== undefined ? knownCoins(input.coins, true) : current.coins

    if (input.coins !== undefined) {
      const dropped = droppedCoins(current.coins ?? [], coins ?? [])

      if (dropped.length) throw new HttpError(400, 'COIN_DELETE_REFUSED', `A coin is never removed (it may hold balances) — switch ${dropped.join(', ')} off instead`)
      changes.push(...diffCoins(current.coins ?? [], coins ?? []))
    }

    if (changes.length === 0) return { doc: current, changes }

    const doc: EntitlementsDoc = {
      site: current.site,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      ...next,
      ...(coins !== undefined ? { coins } : {})
    }

    const entry: AuditEntry = { at: doc.updatedAt, user, version: doc.version, changes, ...(seededFrom ? { seededFrom } : {}) }

    // `issuedAt` is inside the signed data, so a captured request goes stale instead of being
    // replayable later (the backend refuses one older than OWNER_MAX_AGE_SECONDS).
    const data = { ...doc, issuedAt: new Date().toISOString() }
    const signatureEd25519 = signDocEd25519(data)

    await ownerJson('/entitlements', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, signature: signDoc(data), ...(signatureEd25519 ? { signatureEd25519 } : {}), audit: entry, updatedBy: user })
    })

    return { doc, changes }
  }

  const result = queue.then(run, run)

  queue = result.catch(() => undefined)

  return result
}

export async function readAudit(limit = 500): Promise<AuditEntry[]> {
  return (await ownerJson<{ entries: AuditEntry[] }>(`/audit?limit=${limit}`)).entries
}

/** Contract §3: hex HMAC-SHA256 of JSON.stringify(data) with OWNER_SHARED_SECRET. */
export function signDoc(doc: object) {
  return createHmac('sha256', serverConfig.sharedSecret).update(JSON.stringify(doc)).digest('hex')
}

let signingKey: KeyObject | null | undefined

/**
 * The second signature, with a key that never leaves this host. The HMAC's key is
 * also the x-owner-key the backend sends, so whoever reads one request could forge
 * an answer; this one the backend only verifies (OWNER_VERIFY_KEY, public half).
 * Null when OWNER_SIGNING_KEY is not set.
 */
export function signDocEd25519(doc: object): string | null {
  if (signingKey === undefined) {
    try {
      signingKey = serverConfig.signingKey
        ? createPrivateKey({ key: Buffer.from(serverConfig.signingKey, 'base64'), format: 'der', type: 'pkcs8' })
        : null
    } catch {
      signingKey = null
      console.error('OWNER_SIGNING_KEY is not a base64 PKCS8 Ed25519 key — answering without signatureEd25519')
    }
  }

  return signingKey ? edSign(null, Buffer.from(JSON.stringify(doc)), signingKey).toString('base64') : null
}
