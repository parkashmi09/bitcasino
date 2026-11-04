'use client'

import { useState } from 'react'

import Link from 'next/link'

import DataTable, { type Column } from '@/components/shared/DataTable'
import ExportButtons from '@/components/shared/ExportButtons'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { DateRangePicker } from '@/components/ui/date-picker'
import { useApi } from '@/hooks/use-api'
import { defaultRange } from '@/views/exchange/reports/reportKit'

import { windowOf, type Branch, type BranchTotals } from './BranchView'

type Row = { branch: Branch; players: number; currency: string; totals: BranchTotals }

/** The last row: every branch summed. */
const TOTAL = 0

type Report = { currency: string | null; rows: Row[]; total: BranchTotals & { players: number } }

/** Every branch side by side over one period — the Dashboard's figures for each branch's players. */
const BranchReport = () => {
  const [range, setRange] = useState(defaultRange())
  const q = useApi<Report>('admin/branches/report', windowOf(range))
  const cur = q.data?.currency

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Branch',
      cell: r => (r.branch.id === TOTAL ? <span className='font-semibold'>All branches</span> : <Link href={`/branches/${r.branch.id}`} className='font-medium hover:underline'>{r.branch.name}</Link>)
    },
    { key: 'status', header: 'Status', cell: r => (r.branch.id === TOTAL ? null : <StatusBadge value={r.branch.status} />) },
    { key: 'players', header: 'Players', align: 'right', cell: r => r.players },
    { key: 'new', header: 'New', align: 'right', cell: r => r.totals.registrations },
    { key: 'dep', header: 'Deposit', align: 'right', cell: r => <Money value={r.totals.deposits} currency={cur} /> },
    { key: 'wd', header: 'Withdraw', align: 'right', cell: r => <Money value={r.totals.withdrawals} currency={cur} /> },
    { key: 'net', header: 'Net', align: 'right', cell: r => <Money value={r.totals.net} currency={cur} signed /> },
    { key: 'casino', header: 'Casino bets', align: 'right', cell: r => <Money value={r.totals.casinoWagered} currency={cur} /> },
    { key: 'casinoGgr', header: 'Casino GGR', align: 'right', cell: r => <Money value={r.totals.casinoGgr} currency={cur} signed /> },
    { key: 'sports', header: 'Sports bets', align: 'right', cell: r => <Money value={r.totals.sportsStaked} currency={cur} /> },
    { key: 'sportsGgr', header: 'Sports GGR', align: 'right', cell: r => <Money value={r.totals.sportsGgr} currency={cur} signed /> }
  ]

  const total = q.data?.total
  const rows = q.data && total ? [...q.data.rows, { branch: { id: TOTAL } as Branch, players: total.players, currency: cur ?? '', totals: total }] : undefined

  return (
    <div>
      <PageHeader title='Branch Report' description="Players, deposits, withdrawals and play of every branch for the period. Other coins are converted at today's rate." />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.branch.id}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        emptyMessage='No branches yet.'
        toolbar={
          <div className='flex flex-wrap items-center gap-2'>
            <DateRangePicker from={range.from} to={range.to} max={defaultRange().to} clearable={false} onChange={r => setRange({ from: r.from, to: r.to })} />
            <ExportButtons
              fileName={`branch-report-${range.from}_to_${range.to}`}
              title={`Branch report ${range.from} to ${range.to}${cur ? ` (${cur})` : ''}`}
              head={['Branch', 'Status', 'Players', 'New', 'Deposit', 'Withdraw', 'Net', 'Casino bets', 'Casino GGR', 'Sports bets', 'Sports GGR']}
              disabled={!rows}
              rows={() =>
                (rows ?? []).map(r => [
                  r.branch.id === TOTAL ? 'All branches' : r.branch.name,
                  r.branch.id === TOTAL ? '' : r.branch.status,
                  r.players,
                  r.totals.registrations,
                  r.totals.deposits,
                  r.totals.withdrawals,
                  r.totals.net,
                  r.totals.casinoWagered,
                  r.totals.casinoGgr,
                  r.totals.sportsStaked,
                  r.totals.sportsGgr
                ])
              }
            />
          </div>
        }
      />
    </div>
  )
}

export default BranchReport
