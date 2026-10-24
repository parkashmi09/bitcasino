'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/hooks/use-api'
import { errorMessage } from '@/lib/api/client'
import { fmt } from './accountMoney'
import type { AccountRow, CreditHistoryRow } from './types'

/** Zip ki date: 15/10/2026 */
const fmtDate = (d?: string | null) => {
  if (!d) return ''
  const dt = new Date(d)

  if (Number.isNaN(dt.getTime())) return String(d)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`
}

/** Credit History — zip ka CreditHistory (More modal me). */
const CreditHistory = ({ row }: { row: AccountRow }) => {
  const { data, isLoading, error } = useApi<CreditHistoryRow[]>('admin/exchange/credit-history', {
    accountType: row.accountType,
    accountId: row.accountId,
    limit: 25,
    offset: 0
  })

  const rows = data ?? []

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Super User</TableHead>
          <TableHead>User</TableHead>
          <TableHead>Transfer From</TableHead>
          <TableHead className='text-right'>Amount</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className={error ? 'text-destructive text-center' : 'text-center'}>
              {isLoading ? 'Loading...' : error ? `Could not load credit history: ${errorMessage(error)}` : 'There are no records to show'}
            </TableCell>
          </TableRow>
        ) : (
          rows.map(r => (
            <TableRow key={r.id}>
              <TableCell>{r.superUser || '-'}</TableCell>
              <TableCell>{r.user || '-'}</TableCell>
              <TableCell>{r.transferFrom || '-'}</TableCell>
              <TableCell className='text-right'>{fmt(r.amount)}</TableCell>
              <TableCell>{fmtDate(r.createdAt)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

export default CreditHistory
