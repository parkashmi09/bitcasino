'use client'

import { useRouter } from 'next/navigation'

import { LockIcon, ReceiptTextIcon, ShieldIcon, TrendingDownIcon, TrendingUpIcon, UsersIcon, WalletIcon } from 'lucide-react'

import useReportMoney from '@/components/shared/ReportMoney'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useApi, useListState, usePagedApi } from '@/hooks/use-api'
import { Chip, StatCard, StatusChip, UserCell, pnlOf, type Channel, type UserRow, type UsersSummary } from './shared'

type Props = {
  channel: Exclude<Channel, 'all'>
  title: string

  /** Agent System: "Parent Staff" column. */
  showStaffColumn?: boolean
  onOpenRisk: (row: UserRow) => void
  onOpenBalanceSheet: (row: UserRow) => void
}

/**
 * Reference admin ka UsersTable: upar 5 card (Total / Active / Deposits / Withdrawals / Locked),
 * neeche table — # · User · Risk · Email · UID · Phone · [Parent Staff] · [Deposits · Withdrawals · PNL] · Status.
 * Risk column: Risk Management aur Balance Sheet dialog.
 *
 * Agent System ke user bahar se (app se) deposit / withdraw nahi karte — unhe balance system ke
 * andar (points) se milta hai. Isliye agent tab me Deposits / Withdrawals / PNL (deposit − withdraw)
 * ke cards aur columns nahi dikhte; sirf Direct Users me.
 */
const UsersTable = ({ channel, title, showStaffColumn, onOpenRisk, onOpenBalanceSheet }: Props) => {
  const money = useReportMoney()
  const router = useRouter()
  const { state, set, query } = useListState()
  const summary = useApi<UsersSummary>('admin/reports/players/summary', { channel })
  const list = usePagedApi<UserRow>('admin/reports/user-list', { ...query, channel, sort: undefined, order: undefined })

  const s = summary.data
  const showMoney = channel === 'direct'
  const page = list.data?.pagination
  const offset = page ? (page.page - 1) * page.limit : 0

  const columns: Column<UserRow>[] = [
    { key: 'n', header: '#', cell: (_r, i) => <span className='text-muted-foreground'>{offset + (i ?? 0) + 1}</span> },
    { key: 'user', header: 'User', cell: r => <UserCell row={r} /> },
    {
      key: 'risk',
      header: 'Risk',
      cell: r => (
        <div className='flex gap-0.5' onClick={e => e.stopPropagation()}>
          <Button size='icon-sm' variant='ghost' className='hover:text-warning' title='Risk management' aria-label='Risk management' onClick={() => onOpenRisk(r)}>
            <ShieldIcon />
          </Button>
          <Button size='icon-sm' variant='ghost' className='hover:text-primary' title='Balance sheet' aria-label='Balance sheet' onClick={() => onOpenBalanceSheet(r)}>
            <ReceiptTextIcon />
          </Button>
        </div>
      )
    },
    { key: 'email', header: 'Email', cell: r => <span className='text-muted-foreground block max-w-52 truncate text-sm'>{r.email || '—'}</span> },
    { key: 'uid', header: 'UID', cell: r => <span className='bg-info/10 text-info rounded px-1.5 py-0.5 font-mono text-xs'>{r.id}</span> },
    { key: 'phone', header: 'Phone', cell: r => <span className='text-muted-foreground text-sm whitespace-nowrap'>{r.phone || '—'}</span> },
    ...(showStaffColumn
      ? [
          {
            key: 'staff',
            header: 'Parent Staff',
            cell: (r: UserRow) =>
              r.parentStaff ? (
                <div className='min-w-0'>
                  <p className='truncate text-sm font-semibold'>{r.parentStaff.name}</p>
                  <p className='text-muted-foreground truncate text-xs'>{r.parentStaff.email}</p>
                </div>
              ) : (
                '—'
              )
          }
        ]
      : []),
    ...(showMoney
      ? [
          { key: 'dep', header: 'Deposits', cell: (r: UserRow) => <Chip tone='success'>{money.format(r.totalDeposited)}</Chip> },
          { key: 'wd', header: 'Withdrawals', cell: (r: UserRow) => <Chip tone='danger'>{money.format(r.totalWithdrawn)}</Chip> },
          { key: 'pnl', header: 'PNL', cell: (r: UserRow) => <Chip tone={pnlOf(r) >= 0 ? 'success' : 'danger'}>{money.format(pnlOf(r))}</Chip> }
        ]
      : []),
    { key: 'status', header: 'Status', cell: r => <StatusChip row={r} /> }
  ]

  return (
    <div className='flex flex-col gap-4'>
      <div className={showMoney ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5' : 'grid gap-4 sm:grid-cols-3'}>
        <StatCard label='Total Users' value={(s?.totalUsers ?? 0).toLocaleString('en-IN')} icon={<UsersIcon />} tone='primary' loading={summary.isLoading} />
        <StatCard label='Active Users (30 days)' value={(s?.activeUsers ?? 0).toLocaleString('en-IN')} icon={<TrendingUpIcon />} tone='success' loading={summary.isLoading} />
        {showMoney && (
          <>
            <StatCard label='Total Deposits' value={money.format(s?.totalDeposits)} icon={<WalletIcon />} tone='warning' loading={summary.isLoading} />
            <StatCard label='Total Withdrawals' value={money.format(s?.totalWithdrawals)} icon={<TrendingDownIcon />} tone='danger' loading={summary.isLoading} />
          </>
        )}
        <StatCard label='Locked' value={(s?.lockedUsers ?? 0).toLocaleString('en-IN')} icon={<LockIcon />} tone='info' loading={summary.isLoading} />
      </div>

      <Card className='gap-0 p-4'>
        <h2 className='mb-2 font-bold'>
          {title} <span className='text-muted-foreground text-sm font-normal'>({(page?.total ?? 0).toLocaleString('en-IN')} results)</span>
        </h2>
        <DataTable
          columns={columns}
          rows={list.data?.rows}
          rowKey={r => r.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          pagination={page}
          onPageChange={p => set({ page: p })}
          onLimitChange={limit => set({ limit })}
          search={String(state.search ?? '')}
          onSearchChange={search => set({ search })}
          searchPlaceholder='Search by name, email, UID…'
          onRowClick={r => router.push(`/users/${r.id}`)}
        />
      </Card>
    </div>
  )
}

export default UsersTable
