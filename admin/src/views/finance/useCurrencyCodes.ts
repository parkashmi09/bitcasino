'use client'

import { useCallback } from 'react'

import { useSession } from '@/contexts/SessionContext'
import { useApi } from '@/hooks/use-api'

import { SUPPORTED_CURRENCIES, type CurrencyRow } from './types'

export const CURRENCIES_PATH = 'admin/currencies'

/** Any staff member may read it: the coins players get (owner AND site on, not retired). */
export const PUBLIC_CURRENCIES_PATH = 'admin/currencies/public'

/**
 * The coins this site runs on, in the site's order — `null` until known.
 *
 * House staff read the registry (`GET admin/currencies`) and keep the coins that are live
 * (`enabled` = the owner's pick AND the site's switch, not retired): the owner picks INR + USDT →
 * every admin picker, filter and dropdown shows only INR + USDT. The agent tree is refused the
 * registry (403 CURRENCIES_HOUSE_ONLY), so it reads the public list, which is the same set.
 */
function useOwnerCodes(): string[] | null {
  const { actor } = useSession()
  const house = actor?.promotions !== false
  const options = { retry: false, staleTime: 60_000 }
  const registry = useApi<CurrencyRow[]>(house ? CURRENCIES_PATH : null, undefined, options)
  const open = useApi<Array<{ code: string }>>(house ? null : PUBLIC_CURRENCIES_PATH, undefined, options)

  if (house) return Array.isArray(registry.data) ? registry.data.filter(c => c.enabled && !c.retired).map(c => c.code) : null

  return Array.isArray(open.data) ? open.data.map(c => c.code) : null
}

/**
 * The currency codes a picker offers: the owner-enabled coins (see `useOwnerCodes`) — or, while
 * that list is loading or unreachable, the wallet's built-in allow-list.
 */
export function useCurrencyCodes(): string[] {
  return useOwnerCodes() ?? [...SUPPORTED_CURRENCIES]
}

/**
 * Narrows a fixed coin list (P2P coins, fiat rails, bank coins) to the owner-enabled coins,
 * case-insensitively, keeping the list's own order and spelling. Unchanged until the coins are known.
 */
export function useOwnerCoinFilter(): (list: readonly string[]) => string[] {
  const codes = useOwnerCodes()
  const key = codes ? codes.map(c => c.toUpperCase()).join(',') : null

  return useCallback(
    (list: readonly string[]) => {
      if (key === null) return [...list]

      const allowed = new Set(key.split(','))

      return list.filter(c => allowed.has(c.toUpperCase()))
    },
    [key]
  )
}
