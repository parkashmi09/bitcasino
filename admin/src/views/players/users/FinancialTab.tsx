'use client'

import Link from 'next/link'

import { BanIcon, CircleCheckIcon, GaugeIcon, LockIcon, UsersIcon, WalletIcon } from 'lucide-react'

import useReportMoney from '@/components/shared/ReportMoney'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Chip, PlayerAvatar, StatCard } from './shared'

/**
 * Users → Financial → Withdrawal — reference admin (admin-structure.zip →
 * components/users/FinancialTab.tsx `WithdrawalControl`) jaisa:
 *
 *   Overview cards      withdrawals ON/OFF, direct users, locked, limit
 *   Per-user withdrawal lock table                         GET admin/withdrawal-control/users + POST admin/locks
 *
 * Global withdrawals ON / OFF sirf owner panel (Features & plan → Withdrawals) se; yahan sirf status.
 */

const API = 'admin/withdrawal-control'

type Summary = {
  enabled: boolean
  limit: { enabled: boolean; depositMultiplier: number; wagerBonus: boolean; wagerMultiplier: number; source: 'owner' }

  /** The owner's daily withdrawal limit per currency, rolling 24 hours (absent from an older backend). */
  dailyLimit?: { enabled: boolean; limits: Record<string, string> }
  directUsers: number
  lockedDirectUsers: number
}

type LockUser = {
  id: string
  name: string | null
  avatar: string | null
  email: string | null
  phone: string | null
  country: string | null
  created: string | null
  inrBalance: string
  withdrawLocked: boolean
  systemLocked: boolean
  deposited: string
  withdrawn: string
  wagered: string
  wagerBonus: string
  maxWithdrawable: string | null
}

const fmtMult = (n: number) => `${Number(n)}×`
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

const WithdrawalControl = () => {
  const summary = useApi<Summary>(API, undefined, { retry: false })
  const s = summary.data
  const loading = summary.isLoading

  const enabled = s?.enabled ?? true
  const limit = s?.limit
  const limitOn = Boolean(limit?.enabled)
  const m = limit?.depositMultiplier ?? 3

  return (
    <div className='flex flex-col gap-4'>
      {/* Overview */}
      <div className='grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4'>
        <StatCard label='Withdrawals' value={enabled ? 'Open' : 'Stopped'} icon={enabled ? <CircleCheckIcon /> : <BanIcon />} tone={enabled ? 'success' : 'danger'} loading={loading} />
        <StatCard label='Direct users' value={(s?.directUsers ?? 0).toLocaleString('en-IN')} icon={<UsersIcon />} tone='primary' loading={loading} />
        <StatCard label='Withdrawal locked' value={(s?.lockedDirectUsers ?? 0).toLocaleString('en-IN')} icon={<LockIcon />} tone='danger' loading={loading} />
        <StatCard label='Max withdrawal' value={limitOn ? `${fmtMult(m)} deposits` : 'No limit'} icon={<GaugeIcon />} tone='warning' loading={loading} />
      </div>

      {s && !enabled && (
        <p className='bg-danger/10 text-danger border-danger/30 flex items-center gap-2 rounded-md border px-3 py-2 text-sm'>
          <BanIcon className='size-4 shrink-0' />
          Withdrawals are OFF in the owner panel. No player can withdraw by any method until the owner switches them back on.
        </p>
      )}

      <LockTable locked={s?.lockedDirectUsers} />

    </div>
  )
}

/** Withdrawn vs max: amount + patli bar (hara → peela → laal jaise limit bharti hai). */
const WithdrawnBar = ({ withdrawn, max }: { withdrawn: string; max: string | null }) => {
  const money = useReportMoney()

  if (max === null)
    return (
      <div className='text-right whitespace-nowrap'>
        <p className='font-semibold tabular-nums'>{money.format(withdrawn)}</p>
        <p className='text-muted-foreground text-xs'>no limit</p>
      </div>
    )

  const cap = Number(max)
  const pct = cap > 0 ? Math.min(100, (Number(withdrawn) / cap) * 100) : 100

  return (
    <div className='ml-auto w-36'>
      <p className='text-right text-sm whitespace-nowrap tabular-nums'>
        <span className='font-semibold'>{money.format(withdrawn)}</span>
        <span className='text-muted-foreground'> / {money.format(max)}</span>
      </p>
      <div className='bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full'>
        <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-success')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Per-user withdrawal lock — direct users. Lock switch = `POST admin/locks`. Phone pe sirf user, balance, lock. */
const LockTable = ({ locked }: { locked?: number }) => {
  const money = useReportMoney()
  const { can } = useSession()
  const { state, set, query } = useListState(['status'])
  const status = query.status === 'locked' ? 'locked' : 'all'

  const list = usePagedApi<LockUser>(`${API}/users`, {
    limit: query.limit,
    page: query.page,
    search: query.search || undefined,
    status
  })

  const toggle = useApiMutation<{ id: string; locked: boolean }>({
    fn: ({ id, locked }) => api.post('admin/locks', { userId: Number(id), withdraw: locked }),
    invalidate: [['paged', `${API}/users`], ['api', API]],
    success: (_r, v) => `Withdrawals ${v.locked ? 'locked' : 'unlocked'}`
  })

  const columns: Column<LockUser>[] = [
    {
      key: 'user',
      header: 'User',
      cell: r => {
        const name = r.name || '—'

        return (
          <div className='flex min-w-0 items-center gap-3'>
            <PlayerAvatar name={r.name} avatar={r.avatar} />
            <div className='min-w-0'>
              <Link href={`/users/${r.id}`} className='block truncate font-semibold hover:underline'>
                {name}
              </Link>
              <p className='text-muted-foreground truncate text-xs'>
                <span className='font-mono'>{r.id}</span>
                {r.phone ? ` · ${r.phone}` : ''}
                {r.email ? ` · ${r.email}` : ''}
                {r.country ? ` · ${r.country}` : ''}
              </p>
            </div>
          </div>
        )
      }
    },
    { key: 'bal', header: 'Balance', align: 'right', cell: r => <span className='font-semibold tabular-nums'>{money.format(r.inrBalance)}</span> },
    {
      key: 'dep',
      header: 'Deposited',
      align: 'right',
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
      cell: r => <span className='text-success tabular-nums'>{money.format(r.deposited)}</span>
    },
    {
      key: 'wager',
      header: 'Wagered',
      align: 'right',
      className: 'hidden lg:table-cell',
      headerClassName: 'hidden lg:table-cell',
      cell: r => (
        <span className='tabular-nums'>
          {money.format(r.wagered)}
          {Number(r.wagerBonus) > 0 && <span className='text-info block text-xs'>+{money.format(r.wagerBonus)} bonus</span>}
        </span>
      )
    },
    {
      key: 'wd',
      header: 'Withdrawn / max',
      align: 'right',
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
      cell: r => <WithdrawnBar withdrawn={r.withdrawn} max={r.maxWithdrawable} />
    },
    {
      key: 'joined',
      header: 'Joined',
      className: 'hidden xl:table-cell',
      headerClassName: 'hidden xl:table-cell',
      cell: r => <span className='text-muted-foreground text-xs whitespace-nowrap'>{fmtDate(r.created)}</span>
    },
    {
      key: 'lock',
      header: 'Withdrawals',
      align: 'right',
      cell: r => (
        <div className='flex items-center justify-end gap-2.5'>
          {r.systemLocked ? (
            <Chip tone='danger'>Account locked</Chip>
          ) : r.withdrawLocked ? (
            <Chip tone='danger'>Locked</Chip>
          ) : (
            <Chip tone='success' className='hidden sm:inline-block'>
              Allowed
            </Chip>
          )}
          <Switch
            checked={r.withdrawLocked}
            disabled={!can('users:write') || toggle.isPending}
            onCheckedChange={locked => toggle.mutate({ id: r.id, locked })}
            aria-label={`Withdrawal lock for ${r.name ?? r.id}`}
          />
        </div>
      )
    }
  ]

  return (
    <div>
      <div className='mb-2 flex items-baseline justify-between gap-2'>
        <h2 className='font-bold'>Per-user withdrawal lock</h2>
        <p className='text-muted-foreground hidden text-xs sm:block'>Switch on to stop one player withdrawing.</p>
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.rows}
        rowKey={r => r.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={p => set({ page: p })}
        onLimitChange={limit => set({ limit })}
        search={String(state.search ?? '')}
        onSearchChange={search => set({ search })}
        searchPlaceholder='Search name, email, phone or ID'
        emptyMessage={status === 'locked' ? 'No player has withdrawals locked.' : undefined}
        toolbar={
          <div className='flex rounded-md border p-0.5'>
            {(['all', 'locked'] as const).map(v => (
              <button
                key={v}
                type='button'
                onClick={() => set({ status: v === 'all' ? '' : v, page: 1 })}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1 text-sm font-semibold capitalize',
                  status === v ? 'bg-accent text-foreground ring-border shadow-sm ring-1' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {v}
                {v === 'locked' && locked !== undefined && <span className='bg-muted rounded px-1.5 text-xs tabular-nums'>{locked}</span>}
              </button>
            ))}
          </div>
        }
      />
    </div>
  )
}

/** Financial tab — section chip "Withdrawal" (reference me abhi ek hi section). */
const FinancialTab = () => (
  <div className='flex flex-col gap-4'>
    <div className='flex'>
      <span className='bg-card flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold'>
        <WalletIcon className='size-4' /> Withdrawal
      </span>
    </div>
    <WithdrawalControl />
  </div>
)

export default FinancialTab
