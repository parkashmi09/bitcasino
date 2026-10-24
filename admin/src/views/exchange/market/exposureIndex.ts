/**
 * Market Analysis ka book ↔ live odds feed — zip ka `utils/marketExposure.js`.
 *
 * Book ka market naam (game_type) feed me match-odds jaise markets ke liye `mname`
 * ("MATCH_ODDS", "Bookmaker 2") hai aur fancy ke liye `gtype` ("Normal", "oddeven").
 * Isliye dono se index karte hain aur dono se dhoondte hain.
 */

import type { BookEvent } from './api'

export type ExposureIndex = Map<string, Map<string, number>>

// "Bookmaker 2" / "BOOKMAKER_2" / "bookmaker-2" → "bookmaker2"
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Event ke book se index: market → runner → value. */
export function buildExposureIndex(event: BookEvent | undefined | null): ExposureIndex | null {
  if (!event) return null
  const byMarket: ExposureIndex = new Map()

  for (const market of event.markets) {
    const runners = byMarket.get(norm(market.name)) ?? new Map<string, number>()

    for (const row of market.rows) {
      if (Number.isFinite(Number(row.value))) runners.set(norm(row.label), Number(row.value))
    }

    byMarket.set(norm(market.name), runners)
  }

  return byMarket
}

/**
 * Ek runner ka book. Strict — MATCH_ODDS aur Bookmaker ke runner naam same hote hain,
 * isliye sirf naam se dhoondna galat market ka book dikha deta. Na mile to null.
 */
export function lookupExposure(index: ExposureIndex | null, marketKeys: (string | undefined)[], runnerName: string) {
  if (!index) return null
  const runner = norm(runnerName)

  if (!runner) return null

  for (const key of marketKeys) {
    const runners = key ? index.get(norm(key)) : undefined

    if (runners?.has(runner)) return runners.get(runner) ?? null
  }

  return null
}
