/** Shapes of admin/whitelabels (backend modules/whitelabels). */

export const PALETTE_KEYS = ['bg', 's1', 's2', 's3', 'border', 'text', 'muted', 'primary', 'ink', 'accent', 'live', 'hi', 'lo'] as const

export type PaletteKey = (typeof PALETTE_KEYS)[number]
export type Palette = Record<PaletteKey, string>

/** The products and features a whitelabel runs (backend common/whitelabelPlan). */
export type Plan = {
  products: { casino: boolean; sports: boolean; originals: boolean }
  features: { branch_management: boolean; bonus: boolean; affiliate: boolean; vip: boolean; promotions: boolean }
  payments: { manual: boolean; gateways: Record<Gateway, boolean> }
}

export const GATEWAYS = ['ccpayment', 'f2pay', 'upi'] as const
export type Gateway = (typeof GATEWAYS)[number]
export type Product = keyof Plan['products']

/** Percentages as strings. The parent's record only: never sent to the copy. */
export type Terms = {
  fees: Record<Gateway, { deposit: string; withdraw: string }>
  revenueShare: Record<Product, string>
}

export type WhitelabelStatus = 'queued' | 'creating' | 'live' | 'failed' | 'deleting' | 'deleted'

export type Whitelabel = {
  id: number
  slug: string
  name: string
  title: string | null
  description: string | null
  siteDomain: string
  adminDomain: string
  apiDomain: string
  template: string
  palette: Palette | null

  /** null = made before plans: not limited. */
  plan: Plan | null
  terms: Terms

  /** The hub link's API key (gateway payments through this site); null = not issued yet. */
  hubKey: string | null
  hasLogo: boolean
  hasIcon: boolean
  companyRoleName: string
  companyName: string
  companyEmail: string
  status: WhitelabelStatus
  maintenance: boolean
  createdAt: string
  updatedAt: string
}

export type WhitelabelSummary = {
  company: { id: number; name: string; email: string; roleName: string }
  balances: { direct: string; agentSystem: string; staff: string; players: string }
  counts: { staff: number; directUsers: number; clientUsers: number; playersWithBalance: number }
  received: string
  maintenance: boolean
}

export type WhitelabelJob = {
  id: number
  kind: 'create' | 'delete'
  status: 'queued' | 'running' | 'done' | 'failed'
  step: string | null
  log: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type WhitelabelTransfer = {
  id: string
  amount: string
  note: string | null
  status: 'pending' | 'done' | 'refunded'
  uncertain: boolean
  attempts: number
  error: string | null
  createdAt: string
  updatedAt: string
}

export type GatewayOrder = {
  id: string
  provider: string
  flow: 'deposit' | 'payout'
  reference: string
  copyReference: string
  currency: string
  amount: string
  chargePct: string
  status: 'pending' | 'success' | 'failed'
  utr: string | null
  delivered: boolean
  deliveryError: string | null
  createdAt: string
}

export type GatewayRecord = {
  totals: { flow: 'deposit' | 'payout'; status: string; currency: string; count: number; amount: string; charges: string }[]
  undelivered: number
  orders: GatewayOrder[]
}

export type WhitelabelDetail = Whitelabel & {
  gateway: GatewayRecord

  /** slot (`poster` | `poster_mobile`) → last updated; absent = none uploaded. */
  posters: Record<string, string>
  summary: WhitelabelSummary | null
  summaryError: string | null
  jobs: WhitelabelJob[]
  transfers: WhitelabelTransfer[]
}
