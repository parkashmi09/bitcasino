export type PlayerReportRow = {
  id: string
  name: string
  avatar: string | null
  level: number
  status: string

  /** Lifetime bets (stake rows on the wallet ledger), every product. */
  gamesPlayed: number
  referralCode: string | null
  channel: 'direct' | 'agent' | string
  agentId: number | null
  balance: string
  totalDeposited: string
  totalWithdrawn: string
  wager: string

  /** The currency `wager` is in, once the report sends it (userwager is kept in USD). */
  wagerCurrency?: string | null

  /** House-only: null for agent-tree accounts. */
  vip: { level: number; card: string; nextLevel: number | null; wagerToNextLevel: string; progressPct: string } | null
}

/** `admin/accounts/statement` — one transfer between two accounts. */
export type TransferRow = {
  id: number
  from: { type: 'staff' | 'user'; id: string | number; name: string | null }
  to: { type: 'staff' | 'user'; id: string | number; name: string | null }
  amount: string
  direction: string | null
  transferType: string | null
  note: string | null
  createdAt: string | null
}

export type StatementBalance = Record<string, string> & {
  live: string
  opening: string
  closing: string
  movement: string
  totalIn: string
  totalOut: string
  openExposure: string
}

export type StatementRow = {
  id: string
  ts: string
  kind: string
  label: string
  party?: Record<string, unknown> | string | null
  note: string | null
  legacy: string | null
  amount: string
  balance?: string
}

export type Statement = {

  /** User statement: the wallet shown, and every wallet the player holds. */
  currency?: string
  wallets?: { currency: string; balance: string }[]
  subject: { type: 'USER' | 'STAFF'; id: string; name: string; email: string | null; role: string; level: number | null; agentCode: string | null; parentName: string | null }
  period: { from: string | null; to: string | null }
  category: string
  balance: StatementBalance
  rows: StatementRow[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  gaming: {
    sports: Record<string, string | number>
    casino: Record<string, string | number>
    total: Record<string, string | number>
    counts: Record<string, number>
  }
  [k: string]: unknown
}

export type Exposure = { total: number; rows: Record<string, unknown>[] }

export const STATEMENT_CATEGORIES = ['all', 'money', 'sports', 'casino', 'other'] as const
export const STATEMENT_CATEGORY_LABEL: Record<(typeof STATEMENT_CATEGORIES)[number], string> = { all: 'All activity', money: 'Money', sports: 'Sports', casino: 'Casino', other: 'Admin credit, bonus, swap' }

/** A statement row's `kind` (admin statements.constants KIND), as a reader says it. */
export const STATEMENT_KIND_LABEL: Record<string, string> = {
  DEPOSIT_UPLINE: 'Deposit from upline',
  WITHDRAW_UPLINE: 'Withdrawn by upline',
  DEPOSIT_AGENT: 'Deposit to agent',
  COLLECTED_AGENT: 'Collected from agent',
  DEPOSIT_PLAYER: 'Deposit to player',
  COLLECTED_PLAYER: 'Collected from player',
  BANK_DEPOSIT: 'Bank deposit',
  GATEWAY_DEPOSIT: 'Gateway deposit',
  BANK_WITHDRAW: 'Bank withdrawal',
  GATEWAY_WITHDRAW: 'Gateway withdrawal',
  SPORTS: 'Sports',
  CASINO: 'Casino',
  ADMIN: 'Admin credit',
  BONUS: 'Bonus',
  SWAP: 'Swap'
}
export const ACCOUNT_TYPES = ['user', 'staff'] as const

export const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000))

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
