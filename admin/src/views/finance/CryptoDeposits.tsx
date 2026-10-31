'use client'

import Link from 'next/link'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import Money from '@/components/shared/Money'
import { FilterBar, useStatsFilters } from '@/components/shared/charts'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSession } from '@/contexts/SessionContext'
import { useListState } from '@/hooks/use-api'
import { truncateId } from '@/lib/format'
import FinanceStatsPanel from './FinanceStatsPanel'
import ListStatsTabs from './ListStatsTabs'
import { usePageNumbered } from './shared'
import type { CryptoDepositRow } from './types'

const LIST = 'admin/user/history/crypto/deposits'

/** `"0.00100000"` → `"0.001"`: a coin amount keeps its precision but not the padding. */
const trimCoin = (value: string | null | undefined) => {
  if (value == null || value === '') return '—'

  return value.includes('.') ? value.replace(/\.?0+$/, '') : value
}

const columns: Column<CryptoDepositRow>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'user', header: 'User', cell: r => <Link href={`/users/${r.userId}`} className='font-mono text-xs hover:underline'>#{r.userId}</Link> },
  { key: 'chain', header: 'Chain', cell: r => <span className='text-sm'>{r.chain ?? '—'}</span> },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cell: r => (
      <div className='flex flex-col items-end'>
        <span className='font-mono text-sm tabular-nums'>
          {trimCoin(r.amount)} <span className='text-muted-foreground'>{r.coin ?? '—'}</span>
        </span>
        {r.amountUsd != null && (
          <span className='text-muted-foreground text-xs'>
            ≈ <Money value={r.amountUsd} currency='USD' />
          </span>
        )}
      </div>
    )
  },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  { key: 'order', header: 'Order', cell: r => <span className='font-mono text-xs' title={r.orderId ?? ''}>{truncateId(r.orderId)}</span> },
  { key: 'addr', header: 'Address', cell: r => <span className='font-mono text-xs' title={r.address ?? ''}>{truncateId(r.address, 6)}</span> },
  { key: 'at', header: 'Created', cell: r => <DateTime value={r.createdAt} /> }
]

const CryptoDeposits = () => {
  const { can } = useSession()
  const { state, set, query } = useListState(['status', 'chain', 'userid'])

  // One period for the charts and the table (every coin): the list takes inclusive days.
  const filters = useStatsFilters()
  const range = { startDate: filters.from, endDate: filters.to }
  const list = usePageNumbered<CryptoDepositRow>(LIST, { channel: 'direct', limit: query.limit, page: query.page, status: query.status, chain: query.chain, userid: query.userid, ...range })

  return (
    <div>
      <PageHeader
        title='Crypto deposits'
        description='On-chain deposits seen by the payment provider, scoped to your agent tree. Amounts are in the coin the chain moved; USD is at the current rate, where one is set.'
      />
      <FilterBar filters={filters} className='mb-4' />
      <ListStatsTabs stats={can('reports:read') ? <FinanceStatsPanel kind='deposits' rail='crypto' filters={filters} statusLabels={{ success: 'Successful', pending: 'Processing', failed: 'Failed' }} /> : null}>
        <DataTable
          columns={columns}
          rows={list.data?.rows}
          rowKey={r => r.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          pagination={list.data?.pagination}
          onPageChange={page => set({ page })}
          onLimitChange={limit => set({ limit })}
          toolbar={
            <>
              <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v === 'all' ? '' : v })}>
                <SelectTrigger className='w-36'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All statuses</SelectItem>
                  <SelectItem value='success'>Success</SelectItem>
                  <SelectItem value='pending'>Pending</SelectItem>
                  <SelectItem value='failed'>Failed</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder='Chain' aria-label='Chain' value={String(state.chain ?? '')} onChange={e => set({ chain: e.target.value })} className='w-28' />
              <Input placeholder='User id' aria-label='User id' inputMode='numeric' value={String(state.userid ?? '')} onChange={e => set({ userid: e.target.value.replace(/\D/g, '') })} className='w-28' />
            </>
          }
        />
      </ListStatsTabs>
    </div>
  )
}

export default CryptoDeposits
