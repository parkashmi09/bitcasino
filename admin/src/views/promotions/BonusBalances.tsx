'use client'

import { useEffect, useRef, useState } from 'react'

import Link from 'next/link'

import { BanIcon } from 'lucide-react'

import { useStatsFilters } from '@/components/shared/charts'
import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import TxnCodeInput from '@/components/shared/TxnCodeInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { titleCase } from '@/lib/format'

import RewardStats from './RewardStats'

/**
 * Player bonuses held in the locked bonus balance (backend `player-bonuses`, migration 076).
 * A bonus becomes cash only when `wagered` reaches `requiredWager`; until then it is not
 * withdrawable. Staff with `wallet:adjust` can forfeit an active one (audited).
 */
export type PlayerBonus = {
  id: string
  userId: string
  userName?: string | null
  source: string
  amount: string
  currency: string
  wagerMultiplier: number
  requiredWager: string
  wagered: string
  remaining: string
  progress: number
  status: 'active' | 'completed' | 'expired' | 'forfeited'

  /** 'gradual' (hash.game): unlocks bet by bet, the unlocked part is claimable cash, never blocks a withdrawal. */
  unlockMode?: 'rollover' | 'gradual'
  unlocked?: string
  claimed?: string
  claimable?: string
  locked?: string
  ref: string | null
  grantedAt: string
  expiresAt: string | null
  completedAt: string | null
  endedAt: string | null
  endReason: string | null
  endedBy: string | null
}

type Report = { rows: PlayerBonus[]; total: number; totals: { status: string; currency: string; count: number; amount: string }[] }

const STATUSES = ['active', 'completed', 'expired', 'forfeited'] as const
const SOURCES: Record<string, string> = { first_deposit: 'First deposit', spin_wheel: 'Spin wheel', monthly_deposit: 'Monthly deposit' }


/** `player_bonuses.end_reason` (user-service playerBonus.constants END_REASON). */
const END_REASONS: Record<string, string> = {
  WAGERING_MET: 'Wagering met',
  NO_WAGERING: 'No wagering required',
  WAGERING_LOCK_OFF: 'Bonus lock off',
  EXPIRED: 'Expired',
  WITHDRAWAL: 'Forfeited on withdrawal',
  MANUAL: 'Forfeited by staff'
}

const Progress = ({ b }: { b: PlayerBonus }) => (
  <div className='flex min-w-36 flex-col gap-1'>
    <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
      <div className='bg-primary h-full rounded-full' style={{ width: `${Math.min(100, b.progress)}%` }} />
    </div>
    <span className='text-muted-foreground font-mono text-xs tabular-nums'>
      {b.progress}% · <Money value={b.wagered} currency={b.currency} /> / <Money value={b.requiredWager} currency={b.currency} />
    </span>
  </div>
)

const Forfeit = ({ b, invalidate }: { b: PlayerBonus; invalidate: unknown[][] }) => {
  const [code, setCode] = useState('')

  const forfeit = useApiMutation({
    fn: () => api.post(`admin/user/bonus-balance/${b.id}/forfeit`, { transactionPassword: code }),
    invalidate: invalidate as never,
    success: 'Bonus forfeited'
  })

  if (b.status !== 'active') return null

  return (
    <Can permission='wallet:adjust'>
      <ConfirmDialog
        trigger={
          <Button variant='outline' size='sm'>
            <BanIcon /> Forfeit
          </Button>
        }
        title='Forfeit this bonus?'
        description='The locked bonus is removed from the player’s bonus balance and will never become cash. This cannot be undone and is written to the audit log.'
        confirmLabel='Forfeit'
        destructive
        confirmDisabled={!code}
        onConfirm={() => forfeit.mutateAsync()}
      >
        <TxnCodeInput id={`bf-tp-${b.id}`} value={code} onChange={setCode} />
      </ConfirmDialog>
    </Can>
  )
}

const columnsFor = (invalidate: unknown[][], withPlayer: boolean): Column<PlayerBonus>[] => [
  ...(withPlayer
    ? [
        {
          key: 'user',
          header: 'Player',
          cell: (r: PlayerBonus) => (
            <Link href={`/users/${r.userId}`} className='text-sm hover:underline'>
              {r.userName ?? `#${r.userId}`}
            </Link>
          )
        }
      ]
    : []),
  { key: 'source', header: 'Source', cell: r => <Badge variant='outline'>{SOURCES[r.source] ?? titleCase(r.source)}</Badge> },
  { key: 'amount', header: 'Bonus', align: 'right', cell: r => <Money value={r.amount} currency={r.currency} /> },
  {
    key: 'x',
    header: 'Wager',
    cell: r =>
      r.unlockMode === 'gradual' ? (
        <span className='flex flex-col font-mono text-xs tabular-nums'>
          <span>
            Unlocked <Money value={r.unlocked ?? '0'} currency={r.currency} />
          </span>
          <span className='text-muted-foreground'>
            Claimed <Money value={r.claimed ?? '0'} currency={r.currency} />
          </span>
        </span>
      ) : (
        <span className='font-mono text-sm tabular-nums'>{r.wagerMultiplier}x</span>
      )
  },
  { key: 'progress', header: 'Progress', cell: r => <Progress b={r} /> },
  {
    key: 'status',
    header: 'Status',
    cell: r => (
      <span className='flex flex-col gap-0.5'>
        <StatusBadge value={r.status} />
        {r.endReason && <span className='text-muted-foreground text-xs'>{END_REASONS[r.endReason] ?? titleCase(r.endReason.toLowerCase())}</span>}
      </span>
    )
  },
  { key: 'granted', header: 'Granted', cell: r => <DateTime value={r.grantedAt} /> },
  { key: 'expires', header: 'Expires', cell: r => (r.expiresAt ? <DateTime value={r.expiresAt} /> : <span className='text-muted-foreground'>—</span>) },
  { key: 'actions', header: '', align: 'right', cell: r => <Forfeit b={r} invalidate={invalidate} /> }
]

/** The player detail tab: every bonus of one player. */
export const PlayerBonusesTab = ({ userId }: { userId: string }) => {
  const path = `admin/user/bonus-balance/users/${userId}`
  const q = useApi<PlayerBonus[]>(path)
  const active = (q.data ?? []).filter(b => b.status === 'active')
  const gradual = (q.data ?? []).some(b => b.unlockMode === 'gradual')
  const rollover = (q.data ?? []).some(b => b.unlockMode !== 'gradual')

  return (
    <div className='flex flex-col gap-4'>
      <p className='text-muted-foreground text-sm'>
        {gradual && 'Gradual bonuses unlock bet by bet: the unlocked part is claimable as cash any time and they never block a withdrawal. '}
        {(rollover || !gradual) &&
          `${gradual ? 'Rollover bonuses' : 'Bonuses'} sit in a locked bonus balance and become cash only when their wagering is met; until then they are not withdrawable and a withdrawal while one is active forfeits it.`}
        {active.length > 0 && ` ${active.length} active.`}
      </p>
      <DataTable
        columns={columnsFor([['api', path]], false)}
        rows={q.data}
        rowKey={r => r.id}
        loading={q.isLoading}
        error={q.error}
        dense
        emptyMessage='No bonuses granted to this player.'
      />
    </div>
  )
}

/** The bonuses report. */
const BonusBalances = () => {
  const { state, set, query } = useListState(['status', 'source', 'userId'], { status: 'all', source: 'all' })

  // The charts' filter bar sets the period for the table and totals too (granted between those UTC days).
  const f = useStatsFilters({ defaultPreset: '30d' })

  // A new period starts the table again at page 1 (not on first load: keep a deep link).
  const periodKey = `${f.from}|${f.to}`
  const lastPeriodKey = useRef(periodKey)

  useEffect(() => {
    if (lastPeriodKey.current === periodKey) return
    lastPeriodKey.current = periodKey
    set({ page: 1 })
  }, [periodKey, set])

  const filters = {
    status: state.status && state.status !== 'all' ? state.status : undefined,
    source: state.source && state.source !== 'all' ? state.source : undefined,
    userId: state.userId || undefined,
    from: `${f.from}T00:00:00.000Z`,
    to: `${f.to}T23:59:59.999Z`
  }

  const list = usePagedApi<PlayerBonus>('admin/user/bonus-balance', { channel: 'direct', limit: query.limit, page: query.page, ...filters })
  const sums = useApi<Report>('admin/user/bonus-balance', { channel: 'direct', limit: 1, ...filters })

  const sumOf = (status: string) => (sums.data?.totals ?? []).filter(t => t.status === status)

  const stat = (status: string) => {
    const rows = sumOf(status)

    if (!rows.length) return '0'

    return (
      <span className='flex flex-col'>
        {rows.map(t => (
          <span key={t.currency}>
            <Money value={t.amount} currency={t.currency} />
          </span>
        ))}
      </span>
    )
  }

  const count = (status: string) => sumOf(status).reduce((n, t) => n + t.count, 0)

  return (
    <div>
      <PageHeader
        title='Bonus balances'
        description='Every first-deposit and spin-wheel bonus granted to players. A bonus is locked until its wagering requirement (bonus × multiplier) is met, then moved to cash. Expired, forfeited and withdrawn-with bonuses never become cash.'
      />
      <RewardStats section='bonus-balances' filters={f} />
      <h2 className='mb-3 text-sm font-medium'>Bonuses granted in this period, by status</h2>
      <div className='mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {STATUSES.map(s => (
          <StatCard key={s} label={`${s[0].toUpperCase()}${s.slice(1)} (${count(s)})`} loading={sums.isLoading} value={stat(s)} />
        ))}
      </div>
      <DataTable
        columns={columnsFor([['paged', 'admin/user/bonus-balance'], ['api', 'admin/user/bonus-balance']], true)}
        rows={list.data?.rows}
        rowKey={r => r.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        emptyMessage='No bonuses match.'
        toolbar={
          <>
            <Input className='w-40' placeholder='User id' inputMode='numeric' value={String(state.userId ?? '')} onChange={e => set({ userId: e.target.value.replace(/\D/g, '') })} />
            <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v })}>
              <SelectTrigger className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All statuses</SelectItem>
                {STATUSES.map(s => (
                  <SelectItem key={s} value={s} className='capitalize'>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(state.source || 'all')} onValueChange={v => v && set({ source: v })}>
              <SelectTrigger className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All sources</SelectItem>
                {Object.entries(SOURCES).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
    </div>
  )
}

export default BonusBalances
