export type Range = { from: string; to: string }

type ChannelKey = 'online' | 'agent'

export type Signups = {
  range: Range
  total: number
  byChannel: Record<ChannelKey, number>
  series: Record<string, unknown>[]
  estimatedUsers?: number
}

export type Deposits = {
  range: Range
  totals: { volume: string; count: number; average: string }
  byChannel: Record<ChannelKey, { volume: string; count: number; cohortSize: number; converted: number; conversionRate: number }>
  series: Record<string, unknown>[]
}

export type Retention = {
  range: Range
  series: { date: string; activeDepositors: number }[]
  byChannel: Record<ChannelKey, { depositors: number; repeatDepositors: number; repeatRate: number }>
}

export type TopAgent = {
  agentId: number
  agentName: string
  agentCode: string | null
  role: string | null
  customers: number
  lifetimeDepositVolume: string
  depositCount: number
}

export type TopAgents = { range: Range; agents: TopAgent[] }

export type Customer = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  country: string | null
  status: string
  channel: ChannelKey
  createdAt: string | null
  createdEstimated?: boolean
  lastLoginAt: string | null
  lastIp: string | null
  referralCode: string | null
  referredBy: string | null
  agent: { id: number; name: string; code: string | null } | null
  depositCount: number
  depositVolume: string
  lastDepositAt: string | null
}

export const RANGE_PRESETS = [7, 30, 90, 365] as const
export const CUSTOMER_SORTS = ['recent', 'deposits', 'name'] as const
export const CUSTOMER_CHANNELS = ['all', 'direct', 'agent'] as const
