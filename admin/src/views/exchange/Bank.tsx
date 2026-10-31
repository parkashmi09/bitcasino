'use client'

import { useState } from 'react'

import { ArrowRightIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { Channel } from '@/components/shared/ChannelTabs'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApi, useListState } from '@/hooks/use-api'
import { errorMessage } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { accountTypeLabel } from './AccountList'
import { exportExcel, exportPdf } from './exportList'
import { fmt, SETTLE_INVALIDATE, settleApi } from './accountMoney'
import type { AccountRow, AccountsResponse } from './types'

const num = (value: string) => <p className='mb-0 text-right tabular-nums'>{fmt(value)}</p>

const EXPORT_COLS = ['User Name', 'CR', 'pts', 'Client(P/L)', 'Exposure', 'Available pts', 'Account type']

/**
 * Bank — zip ka `reports/Bank.jsx`.
 *
 * Direct children ki list (CR, pts, Client(P/L), Exposure, Available pts). Har row me
 * "All →" pending ka ULTA sign box me bhar deta hai, Submit = points settlement:
 *   Client(P/L) −100 → box +100 (dena hai)  |  Client(P/L) +10 → box −10 (lena hai)
 * Transaction Code upar ek baar. Sirf Agent Users (`channel=agent`).
 */
const BankBody = ({ channel }: { channel: Channel }) => {
  const qc = useQueryClient()
  const { state, set, query } = useListState()
  const limit = Number(query.limit ?? 20)
  const page = Number(query.page ?? 1)

  const { data, isLoading, isFetching, error } = useApi<AccountsResponse>('admin/exchange/accounts', {
    limit,
    offset: (page - 1) * limit,
    search: query.search || undefined,
    channel
  })

  const rows = data?.rows ?? []
  const total = data?.pagination.total ?? 0

  const [masterPassword, setMasterPassword] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const keyOf = (r: AccountRow) => `${r.accountType}-${r.accountId}`
  const setAmount = (key: string, value: string) => setAmounts(prev => ({ ...prev, [key]: value }))

  // "All" = pending ka ulta sign (wahi jo API me jayega).
  const handleAll = (r: AccountRow) => setAmount(keyOf(r), (-(Number(r.settlementPoints) || 0)).toFixed(2))

  const submitRow = async (r: AccountRow) => {
    const key = keyOf(r)
    const raw = (amounts[key] ?? '').trim()
    const points = Number(raw)

    // Server (`exchange.validators.js settle`): points ≠ 0 and |points| ≤ 100,000,000.
    const problem = !raw
      ? 'Enter points'
      : check.number(raw, 'Points', { min: -100_000_000, max: 100_000_000, decimals: 2 }) || (points === 0 ? 'Points cannot be 0' : undefined)

    if (problem) {
      setStatus(prev => ({ ...prev, [key]: { ok: false, text: problem } }))
      toast.error(`${r.username}: ${problem}`)

      return
    }

    setBusy(key)

    try {
      await settleApi(r, points, masterPassword)
      setStatus(prev => ({ ...prev, [key]: { ok: true, text: 'Sucessful Balance Transfer' } }))
      toast.success(`${r.username}: settled ${points.toFixed(2)} points`)
      setAmount(key, '')
      for (const k of SETTLE_INVALIDATE) void qc.invalidateQueries({ queryKey: k })
    } catch (err) {
      setStatus(prev => ({ ...prev, [key]: { ok: false, text: errorMessage(err) } }))
      toast.error(`${r.username}: ${errorMessage(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<AccountRow>[] = [
    { key: 'username', header: 'User Name', cell: r => <span title={r.username}>{r.username}</span> },
    { key: 'cr', header: 'CR', align: 'right', cell: r => num(r.credit) },
    { key: 'pts', header: 'pts', align: 'right', cell: r => num(r.allPoint) },
    { key: 'pl', header: 'Client(P/L)', align: 'right', cell: r => num(r.settlementPoints) },
    { key: 'exposure', header: 'Exposure', align: 'right', cell: r => num(r.exposure) },
    { key: 'available', header: 'Available pts', align: 'right', cell: r => num(r.available) },
    { key: 'type', header: 'Account Type', cell: r => accountTypeLabel(r) },
    {
      key: 'action',
      header: 'Action',
      cell: r => (
        <div className='flex items-center gap-2'>
          <button type='button' className='text-success inline-flex items-center gap-1 text-sm' onClick={() => handleAll(r)}>
            All <ArrowRightIcon className='size-3' />
          </button>
          <Input
            type='number'
            placeholder='0'
            className='h-8 w-28'
            value={amounts[keyOf(r)] ?? ''}
            onChange={e => setAmount(keyOf(r), e.target.value)}
          />
          <Button size='sm' disabled={busy === keyOf(r)} onClick={() => submitRow(r)}>
            {busy === keyOf(r) && <Loader2Icon className='animate-spin' />}
            Submit
          </Button>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      cell: r => {
        const s = status[keyOf(r)]

        return s ? <span className={s.ok ? 'text-success text-sm' : 'text-destructive text-sm'}>{s.text}</span> : null
      }
    }
  ]

  const exportRows = () => rows.map(r => [r.username, r.credit, r.allPoint, r.settlementPoints, r.exposure, r.available, accountTypeLabel(r)])

  return (
    <div>
      <DataTable
        toolbar={
          <div className='ml-auto flex flex-wrap items-center gap-2'>
            <Button variant='outline' size='icon' disabled={!rows.length} onClick={() => exportExcel('bankuserlist', EXPORT_COLS, exportRows())} aria-label='Excel'>
              <FileSpreadsheetIcon />
            </Button>
            <Button variant='outline' size='icon' disabled={!rows.length} onClick={() => exportPdf('bankuserlist', 'Bank User List', EXPORT_COLS, exportRows())} aria-label='PDF'>
              <FileTextIcon />
            </Button>
            <Input
              type='password'
              placeholder='Transaction Code'
              className='w-44'
              value={masterPassword}
              onChange={e => setMasterPassword(e.target.value)}
            />
          </div>
        }
        columns={columns}
        rows={rows}
        rowKey={keyOf}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        search={String(state.search ?? '')}
        onSearchChange={value => set({ search: value, page: 1 })}
        searchPlaceholder='Search User'
        emptyMessage='There are no records to show'
        pagination={{ page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1), hasNext: page * limit < total, hasPrev: page > 1 }}
        onPageChange={p => set({ page: p })}
        onLimitChange={l => set({ limit: l, page: 1 })}
      />
    </div>
  )
}

const Bank = () => (
  <div>
    <PageHeader title='Bank' description='Settle the Client(P/L) of your accounts.' />
    <BankBody channel='agent' />
  </div>
)

export default Bank
