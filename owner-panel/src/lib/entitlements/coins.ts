import type { CoinChange, CoinDefinition } from './types'

/**
 * Custom coins (coin management phase B): the owner creates a coin here, the site's backend
 * inserts it into its `currencies` registry (`builtin = false`) and holds its balances in
 * `wallet_balances`. Shared by the Add/Edit dialog (client), the save route and the store.
 */

/** The coins with a `credits` column on the site (backend BUILTIN_CURRENCIES). Never definable here. */
export const BUILTIN_COINS = [
  'BTC', 'ETH', 'LTC', 'BCH', 'USDT', 'TRX', 'DOGE', 'ADA', 'XRP', 'BNB', 'USDP', 'NEXO', 'MKR', 'TUSD',
  'USDC', 'BUSD', 'NC', 'INR', 'SHIB', 'MATIC', 'SC', 'MVR', 'BJB', 'AED', 'NPR', 'PKR', 'EUR', 'BDT', 'IDR'
] as const

export const COIN_CODE = /^[A-Z][A-Z0-9]{1,9}$/
export const COIN_KINDS = ['fiat', 'crypto', 'points'] as const

/** The wallet's money arithmetic works in 8-place minor units, so a coin has 0–8 decimals. */
export const MAX_DECIMALS = 8

/** USD value of one unit: a decimal > 0 with at most 8 places (the backend's rate scale). */
export const USD_RATE = /^\d{1,15}(\.\d{1,8})?$/
const NETWORK_KEY = /^[A-Za-z0-9_-]{1,20}$/
const UNSAFE_TEXT = /[<>\u0000-\u001f\u007f]/

export const isBuiltinCoin = (code: string) => (BUILTIN_COINS as readonly string[]).includes(code.toUpperCase())

/** The first problem with one definition, or null. */
export function coinProblem(c: Partial<CoinDefinition> | null | undefined): string | null {
  if (!c || typeof c !== 'object') return 'must be an object'
  if (typeof c.code !== 'string' || !COIN_CODE.test(c.code)) return 'code must be a capital letter then 1–9 capitals or digits'
  if (isBuiltinCoin(c.code)) return `${c.code} is a built-in coin — switch it on the Coins table instead`
  if (!COIN_KINDS.includes(c.kind as (typeof COIN_KINDS)[number])) return 'kind must be crypto, fiat or points'
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.trim().length > 60 || UNSAFE_TEXT.test(c.name)) return 'name is required (60 characters at most, no < >)'
  if (c.symbol !== undefined && (typeof c.symbol !== 'string' || c.symbol.trim().length > 12 || UNSAFE_TEXT.test(c.symbol))) return 'symbol is 12 characters at most, no < >'
  if (!Number.isInteger(c.decimals) || (c.decimals as number) < 0 || (c.decimals as number) > MAX_DECIMALS) return `decimals must be a whole number from 0 to ${MAX_DECIMALS}`
  if (typeof c.usdRate !== 'string' || !USD_RATE.test(c.usdRate) || !(Number(c.usdRate) > 0)) return 'USD rate must be a number above 0 with at most 8 decimal places'
  if (c.enabled !== undefined && typeof c.enabled !== 'boolean') return 'enabled must be true or false'

  if (c.networks !== undefined) {
    if (!Array.isArray(c.networks) || c.networks.length > 20) return 'networks must be a list of at most 20'
    if (c.kind !== 'crypto' && c.networks.length) return 'only a crypto coin has networks'
    const keys = new Set<string>()

    for (const n of c.networks) {
      if (!n || typeof n.key !== 'string' || !NETWORK_KEY.test(n.key)) return 'a network key is 1–20 letters, digits, - or _'
      if (typeof n.name !== 'string' || !n.name.trim() || n.name.length > 40 || UNSAFE_TEXT.test(n.name)) return `network ${n.key} needs a name (40 characters at most)`
      if (keys.has(n.key)) return `network ${n.key} is listed twice`
      keys.add(n.key)
    }
  }

  return null
}

/** One definition in its stored shape (trimmed, defaults filled). Call after `coinProblem` is null. */
export function cleanCoin(c: CoinDefinition): CoinDefinition {
  return {
    code: c.code,
    kind: c.kind,
    name: c.name.trim(),
    symbol: (c.symbol ?? '').trim() || c.code,
    decimals: c.decimals,
    usdRate: c.usdRate,
    networks: c.kind === 'crypto' ? (c.networks ?? []).map(n => ({ key: n.key, name: n.name.trim() })) : [],
    enabled: c.enabled !== false
  }
}

const same = (a: CoinDefinition, b: CoinDefinition) => JSON.stringify(cleanCoin(a)) === JSON.stringify(cleanCoin(b))

/**
 * One `coin` change per added, edited, switched-on or switched-off coin (audit kind `coin`).
 * A code in `before` missing from `after` is not a change — it is refused (no delete).
 */
export function diffCoins(before: CoinDefinition[], after: CoinDefinition[]): CoinChange[] {
  const out: CoinChange[] = []

  for (const to of after) {
    const from = before.find(c => c.code === to.code) ?? null

    if (!from) out.push({ kind: 'coin', key: to.code, action: 'added', from: null, to: cleanCoin(to) })
    else if (!same(from, to)) {
      const onlySwitch = same({ ...from, enabled: to.enabled }, to)
      const action = onlySwitch ? (to.enabled === false ? 'disabled' : 'enabled') : 'edited'

      out.push({ kind: 'coin', key: to.code, action, from: cleanCoin(from), to: cleanCoin(to) })
    }
  }

  return out
}

/** Codes in `before` that `after` dropped — a save that drops one is refused. */
export const droppedCoins = (before: CoinDefinition[], after: CoinDefinition[]) => before.filter(c => !after.some(a => a.code === c.code)).map(c => c.code)
