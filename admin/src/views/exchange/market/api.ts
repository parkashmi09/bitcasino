/**
 * Exchange market screens ke shared types + chhote helpers
 * (Market Analysis, Events / Game Details, Current Bets).
 */

/** admin-service module `exchange-market`. */
export const MARKET_API = 'admin/exchange/market'

/** Sports service ke public routes (odds, events) — zip ke `/user/...`. */
export const SPORTS_USER = 'sports/user'

// ── Market Analysis ─────────────────────────────────────────────────────

export type BookRow = { label: string; value: number }
export type BookMarket = { name: string; label?: string; rows: BookRow[] }

export type BookEvent = {
  eventId: string
  matchId: string
  title: string
  sportId: string | null
  eventDate: string | null
  markets: BookMarket[]
}

export type AnalysisResponse = { events: BookEvent[] }

// ── Bets ────────────────────────────────────────────────────────────────

export type Bet = {
  id: string
  userId: string
  username: string
  sportId: string | null
  sportName: string | null
  eventId: string | null
  matchId: string | null
  eventName: string | null
  marketType: string | null
  gameType: string | null
  selection: string | null
  betType: string
  odds: string | null

  /** Readable market ("Match Odds") and the rate in its own scale ("1.40", "55 @ 100"), from shapeBet. */
  marketLabel?: string
  rate?: string | null
  stake: string
  ip: string
  browser: string
  unmatched: boolean
  deleted: boolean
  createdAt: string
}

/** Lay side (fancy me 'no') — row ka pink border. */
export const isLay = (bet: Pick<Bet, 'betType'>) => bet.betType === 'lay' || bet.betType === 'no'

// ── User Book ───────────────────────────────────────────────────────────

export type BookNode = { id: string; username: string; values: (number | null)[]; children?: BookNode[] }
export type UserBookResponse = { runners: string[]; tree: BookNode[] }

// ── Odds feed (get-match-private-data) ──────────────────────────────────

export type FeedOdds = { odds: number; oname: string; otype: string; size: number; tno: number }

export type FeedSection = {
  sid: number | string
  sno?: number
  nat: string
  gscode?: number
  gstatus?: string
  min?: number
  max?: number
  rem?: string
  odds?: FeedOdds[]
  cno?: string | number
  sdraw?: string | number
  adfa?: string | number
  rdt?: string
}

export type FeedMarket = {
  mid: number | string
  mname: string
  gtype: string
  dtype?: number
  sno?: number
  gscode?: number
  status?: string
  iplay?: boolean
  min?: number
  max?: number
  maxb?: number
  umaxbof?: number
  rem?: string
  section?: FeedSection[]
}

/** Match meta (v1/sports-gamedetailPrivate). */
export type MatchMeta = {
  gmid: number | string
  etid: number | string
  ename?: string
  cname?: string
  stime?: string
  mname?: string
  gtv?: number
  scard?: number
  tv?: boolean
}

// ── Formatters (zip jaise) ──────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/** DD/MM/YYYY HH:mm:ss — zip ka fmtDate / fmtPlaceDate. */
export function fmtDateTime(raw: string | null | undefined) {
  if (!raw) return ''
  const d = new Date(raw)

  if (Number.isNaN(d.getTime())) return String(raw)

  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** "3.4000" → "3.4", "100.00" → "100" (trailing zeros hatao). */
/** A bet's rate for the screen: shapeBet's own scale, else the raw odds. */
export const rateOf = (b: Pick<Bet, 'rate' | 'odds'>) => b.rate ?? plain(b.odds)

export function plain(v: string | number | null | undefined) {
  const n = Number.parseFloat(String(v ?? ''))

  return Number.isFinite(n) ? String(n) : ''
}

/** "-1200" → "-1,200" — zip ka fmtVal. */
export function commas(v: string | number | null | undefined) {
  const n = Number.parseFloat(String(v ?? ''))

  return Number.isNaN(n) ? String(v ?? '') : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** Zip ka `v-currency`: en-IN grouping, max 2 decimals. */
export function currency(v: string | number | null | undefined) {
  const n = Number.parseFloat(String(v ?? ''))

  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''
}

/** Book value ka rang: + green, − red, 0 grey. */
export function bookColor(v: number | null | undefined) {
  const n = Number(v)

  if (!Number.isFinite(n) || n === 0) return 'text-muted-foreground'

  return n < 0 ? 'text-destructive' : 'text-success'
}
