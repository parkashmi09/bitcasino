/** Row types for the casino screens. Amounts are decimal strings on the wire. */

export type GisGame = {
  uuid: string
  name: string
  provider: string | null
  type: string | null
  image: string | null
  is_mobile?: boolean | number | null
  has_freespins?: boolean | number | null
}

export type GisVendor = { vendor: string; total?: number | string; [k: string]: unknown }
export type GisType = { type: string; total?: number | string; [k: string]: unknown }
export type GisProvider = { name: string; enabled: boolean }
export type GisPriority = { games: GisGame[]; updated_at: string | null; pinned?: number; vendor?: string; type?: string }

export type JsGame = {
  id: number
  game_uid: string
  game_name: string
  game_type: string | null
  game_icon: string | null
  vendor: string | null
  is_active: boolean
}

export type JsScopeEntry = { name?: string; key?: string; label?: string; games: number; curated: boolean; prioritized?: number; updatedAt: string | null; updatedBy?: string | number | null }
export type JsCuration = { scope: string; key: string; curated: boolean; updatedAt: string | null; updatedBy?: string | number | null; games: JsGame[] }

export type HouseRow = { id: number | string; userId: string | null; name: string | null; max: string; current: string }
export type HouseClock = { hour: number; iso: string; serverHour: number; serverOffsetMinutes: number }

export type CasinoTxn = {
  id: number | null
  transaction_id: string
  round_id: string
  user_id: number
  user_name: string | null
  session?: string | null
  transaction_type: string
  amount: string
  profit: string
  outcome: string
  currency_code: string | null
  transaction_timestamp: string
  reason: string | null
  round_finished?: boolean | null
  transaction_status: string
  source: string
  source_key: string
  game_uid: string | null
  game_title: string | null
  game_vendor: string | null
}

export type CasinoTotals = {
  total: number
  bets: number
  wins: number
  paidWins: number
  pushes: number
  losses: number
  refunds: number
  wagered: string
  payouts: string
  refunded: string
  net: string
}
export type CasinoStats = {
  totals: CasinoTotals
  bySource: Record<string, CasinoTotals>

  /** The same figures per wallet — money in two coins does not add up raw. */
  byCurrency?: { currency: string; totals: CasinoTotals; bySource: Record<string, CasinoTotals> }[]
  [k: string]: unknown
}

export type HouseBet = { id: string; at: string | null; userId: string | null; user: string | null; amount: string; profit: string; game: string | null }
export type RawTxn = { id: string; at: string | null; userId: string | null; user: string | null; amount: string; type: string | null; status: string | null }

/** One lobby provider's site settings — mirrors casino-service `providerSettingsList` (migration 067). */
export type ProviderSetting = {
  key: string
  name: string
  displayName: string | null
  enabled: boolean
  sortOrder: number | null
  games: number
  hasLogo: boolean
  logoUrl: string | null
  logoContentType: string | null
  logoByteSize: number | null
  logoUpdatedAt: string | null
  updatedBy: string | null
  updatedAt: string | null
}
