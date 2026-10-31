export type ExecutiveRow = {
  id: number
  username: string
  kind: 'executive' | 'marketing'
  status: 'active' | 'inactive' | 'locked'
  parentStaffId: number | null
  parentRoleAtCreation: number | null
  permissions: string[]
  lastLogin: string | null
}

export type ExecutiveActivity = {
  id: number
  executiveId: number
  action: string
  targetType: string | null
  targetId: string | null
  details: Record<string, unknown> | null
  ip: string | null
  status: string | null
  error: string | null
  createdAt: string | null
}

export const EXECUTIVE_STATUSES = ['active', 'inactive', 'locked'] as const

/** The platform permission vocabulary — `backend/packages/auth/src/permissions.js`. */
// Grouped by what the screens do (agent system, sports exchange, …); the picker offers only what the creator holds.
export const PERMISSION_GROUPS: { label: string; permissions: string[] }[] = [
  { label: 'Agent system: accounts, create account, locks', permissions: ['users:read', 'users:write', 'users:lock', 'staff:read', 'staff:write'] },
  { label: 'Agent system: points (D/W, settlement, bank)', permissions: ['wallet:read', 'wallet:credit', 'wallet:debit', 'wallet:adjust'] },
  { label: 'Reports (statements, win/loss, turnover, current bets)', permissions: ['reports:read', 'audit:read'] },
  { label: 'Sports exchange: view / settings & locks / settlement / void', permissions: ['sports:read', 'sports:manage', 'sports:settle', 'sports:void-settled'] },
  { label: 'Payments (direct users)', permissions: ['deposits:read', 'deposits:approve', 'withdrawals:read', 'withdrawals:approve'] },
  { label: 'Casino', permissions: ['casino:read', 'casino:manage', 'casino:settle', 'originals:read'] },
  { label: 'Admin', permissions: ['roles:manage', 'config:read', 'config:write', 'redeem:write', 'users:delete', 'users:impersonate'] }
]

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.permissions)

/** One-click roles for an executive. The picker keeps only what the creator holds. */
export const EXECUTIVE_ROLES: { label: string; permissions: string[] }[] = [
  { label: 'Finance', permissions: ['deposits:read', 'deposits:approve', 'withdrawals:read', 'withdrawals:approve', 'wallet:read', 'wallet:credit', 'wallet:debit', 'wallet:adjust', 'reports:read', 'config:read'] },
  { label: 'Site content & config', permissions: ['config:read', 'config:write', 'redeem:write', 'reports:read'] },
  { label: 'Player support', permissions: ['users:read', 'users:lock', 'deposits:read', 'withdrawals:read', 'wallet:read', 'reports:read'] },
  { label: 'KYC', permissions: ['users:read', 'users:write', 'reports:read'] },
  { label: 'Sports', permissions: ['sports:read', 'sports:manage', 'sports:settle', 'reports:read'] },
  { label: 'Casino', permissions: ['casino:read', 'casino:manage', 'casino:settle', 'originals:read', 'reports:read'] },
  { label: 'Reports only', permissions: ['reports:read', 'audit:read'] }
]
