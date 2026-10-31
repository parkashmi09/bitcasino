/** Shapes of admin/whitelabels (backend modules/whitelabels). */

export const PALETTE_KEYS = ['bg', 's1', 's2', 's3', 'border', 'text', 'muted', 'primary', 'ink', 'accent', 'live', 'hi', 'lo'] as const

export type PaletteKey = (typeof PALETTE_KEYS)[number]
export type Palette = Record<PaletteKey, string>

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

export type WhitelabelDetail = Whitelabel & {

  /** slot (`poster` | `poster_mobile`) → last updated; absent = none uploaded. */
  posters: Record<string, string>
  summary: WhitelabelSummary | null
  summaryError: string | null
  jobs: WhitelabelJob[]
  transfers: WhitelabelTransfer[]
}
