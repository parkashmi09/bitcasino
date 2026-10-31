'use client'

import { useCallback, useMemo } from 'react'

import { useDefaultCurrency } from '@/components/shared/DefaultCurrency'
import { useApi } from '@/hooks/use-api'
import { formatMoney, isPlainInr, localeFor } from '@/lib/format'

/**
 * Player money in the site's DEFAULT COIN — the owner's `default_currency` policy (USDT today),
 * converted at the live rate table (`exchangerate`, kept current by the backend's rate worker and
 * read from the public `user/exchange-rate/rates`, re-read every minute). When the owner picks
 * another default, every figure follows on the next read of `admin/site-config/public`.
 *
 * `usdRate` is "USD per unit"; USD and USDT count 1:1 when the table has no row for them (the
 * backend's `reportingCurrency` / `createValuer` rule). A source or target with no rate is never
 * printed as 0: `format` falls back to the source amount in its own currency.
 *
 *   const money = useReportMoney()
 *   money.format(row.totalDeposited, 'INR')   // "108.00 USDT"
 *   money.convert('9000', 'INR')              // 108 (number), or null when unpriced
 *   money.sum([['5000', 'INR'], ['0.1', 'BTC']]) // { value, partial, text } — a multi-coin total
 *
 * THE ONE PLACE the admin turns player money into the default coin: Users list, Financial,
 * Turnover, Wallets, the player page and its balance sheet all go through it.
 */

type RateRow = { currency: string; usdRate: string }

/** ISO fiat codes printed with their own symbol; anything else prints "1,234.56 CODE". */
const FIAT = new Set(['INR', 'USD', 'EUR', 'GBP', 'PKR', 'BDT', 'NPR', 'AED', 'MVR', 'IDR', 'BRL', 'PHP', 'THB', 'VND', 'NGN', 'KES', 'TRY', 'RUB', 'JPY', 'CAD', 'AUD'])

export const RATES_PATH = 'user/exchange-rate/rates'

/** One amount in one currency, the admin's way: fiat with its symbol, a coin with its code after it. */
export function formatIn(value: number, code: string, opts: { digits?: number; signed?: boolean } = {}) {
  const sign = opts.signed && value > 0 ? '+' : ''

  if (FIAT.has(code)) {
    const digits = opts.digits ?? 2

    if (code === 'INR' && isPlainInr()) return sign + formatMoney(value, undefined, { digits })

    return (
      sign +
      new Intl.NumberFormat(localeFor(code), { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
    )
  }

  // Stablecoins read like money (2 places); other coins keep their precision.
  const digits = opts.digits ?? (/^USD[TC]?$/.test(code) ? 2 : Math.abs(value) >= 1 ? 4 : 8)

  return `${sign}${formatMoney(value, undefined, { digits, of: code })} ${code}`
}

export function useReportMoney() {
  const { code, loading } = useDefaultCurrency()
  const rates = useApi<RateRow[]>(RATES_PATH, undefined, { staleTime: 60_000, refetchInterval: 60_000 })

  const usdPer = useMemo(() => {
    const map = new Map<string, number>()

    for (const r of Array.isArray(rates.data) ? rates.data : []) {
      const n = Number(r.usdRate)

      if (Number.isFinite(n) && n > 0) map.set(String(r.currency).toUpperCase(), n)
    }

    if (!map.has('USD')) map.set('USD', 1)
    if (!map.has('USDT')) map.set('USDT', 1)

    return map
  }, [rates.data])

  /** A number in the default coin, or null when either side has no rate. */
  const convert = useCallback(
    (amount: string | number | null | undefined, from = 'INR') => {
      const n = Number(amount)

      if (!Number.isFinite(n)) return null
      const src = String(from).toUpperCase()

      if (src === code) return n
      const a = usdPer.get(src)
      const b = usdPer.get(code)

      return a && b ? (n * a) / b : null
    },
    [usdPer, code]
  )

  /** The figure in the default coin; unpriced → the source amount in its own currency. */
  const format = useCallback(
    (amount: string | number | null | undefined, from = 'INR', opts: { digits?: number; signed?: boolean } = {}) => {
      const n = Number(amount) || 0
      const v = convert(n, from)

      return v === null ? formatIn(n, String(from).toUpperCase(), opts) : formatIn(v, code, opts)
    },
    [convert, code]
  )

  /**
   * Several native amounts (`[amount, currency]`) as one figure in the default coin. `partial` when
   * a non-zero amount had no rate — it is left out of `value`, and `text` ends with "+" to say so.
   */
  const sum = useCallback(
    (parts: readonly (readonly [string | number | null | undefined, string])[], opts: { digits?: number; signed?: boolean } = {}) => {
      let value = 0
      let partial = false

      for (const [amount, from] of parts) {
        if (!Number(amount)) continue
        const v = convert(amount, from)

        if (v === null) partial = true
        else value += v
      }

      return { value, partial, text: formatIn(value, code, opts) + (partial ? ' +' : '') }
    },
    [convert, code]
  )

  return { code, convert, format, sum, ready: !loading && !rates.isLoading }
}

export default useReportMoney
