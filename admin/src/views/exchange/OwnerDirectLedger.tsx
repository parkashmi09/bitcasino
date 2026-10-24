'use client'

import { useState } from 'react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import Money from '@/components/shared/Money'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePagedApi } from '@/hooks/use-api'
import type { DirectLedgerRow } from './types'

/** Entry type ka naam, jaisa owner ko padhna chahiye. */
const TYPE_LABEL: Record<string, string> = {
  add: 'Added by you',
  user_deposit: 'Given to user',
  user_withdraw: 'Taken from user',
  points_settle: 'Points settle'
}

const columns: Column<DirectLedgerRow>[] = [
  { key: 'when', header: 'When', cell: r => <DateTime value={r.createdAt} /> },
  {
    key: 'type',
    header: 'Type',
    cell: r => <Badge variant={r.type === 'add' ? 'default' : 'outline'}>{TYPE_LABEL[r.type] ?? r.type}</Badge>
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cell: r => <Money value={r.direction === 'credit' ? r.amount : `-${r.amount}`} signed className='font-medium' />
  },
  { key: 'after', header: 'Balance', align: 'right', cell: r => <Money value={r.balanceAfter} /> },
  {
    key: 'got',
    header: 'User got',
    align: 'right',
    cell: r => (r.currency && r.currencyAmount ? `${Number(r.currencyAmount).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${r.currency}` : '—')
  },
  { key: 'user', header: 'User', cell: r => (r.user ? (r.user.name ?? `#${r.user.id}`) : '—') },
  { key: 'note', header: 'Note', cell: r => <span className='text-muted-foreground text-xs'>{r.note ?? '—'}</span> }
]

/**
 * Super Admin ke main Direct User wallet (`staff_balances`) ka ledger — header ke balance pe
 * click karke khulta hai. Har badlav: kab, kya (khud add / user ko diya / liya / points settle),
 * kitna, aur uske baad ka balance. `GET admin/exchange/owner/direct-ledger`.
 */
const OwnerDirectLedger = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)

  const list = usePagedApi<DirectLedgerRow>(open ? 'admin/exchange/owner/direct-ledger' : null, { page, limit })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Direct User wallet ledger</DialogTitle>
          <DialogDescription>Everything that went into or out of your Direct User wallet, newest first.</DialogDescription>
        </DialogHeader>
        <DataTable
          columns={columns}
          rows={list.data?.rows}
          rowKey={r => r.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          pagination={list.data?.pagination}
          onPageChange={setPage}
          onLimitChange={l => {
            setLimit(l)
            setPage(1)
          }}
          emptyMessage='Nothing yet. Use Add Balance to put money in this wallet.'
          dense
        />
      </DialogContent>
    </Dialog>
  )
}

export default OwnerDirectLedger
