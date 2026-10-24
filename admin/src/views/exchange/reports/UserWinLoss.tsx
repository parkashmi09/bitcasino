'use client'

import { useState, type FormEvent } from 'react'

import { toast } from 'sonner'

import type { Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import { DateRangePicker } from '@/components/ui/date-picker'
import { api, errorMessage } from '@/lib/api/client'
import { exportExcel, exportPdf } from '../exportList'
import {
  ActionButtons,
  ClientSearch,
  clientBody,
  defaultRange,
  EntriesBar,
  FilterField,
  fmt,
  ReportCard,
  ReportTable,
  withMinimumDelay,
  type Client,
  type ReportColumn,
  rangeError
} from './reportKit'

type WinLossRow = { user_id: string; username: string; sports_pts: number; casino_pts: number; original_pts: number; total: number }

// Zip ka SportBookpts column yahan nahi (sportbook hamare yahan nahi).
const EXPORT_COLS = ['No', 'User Name', 'Sportpts', 'Casinopts', 'Originalpts', 'Profit/Loss']

/**
 * User Win Loss — zip ka `reports/UserWinLoss.jsx` (`POST /admin/reports/point-category-report`).
 *
 * Range ke andar har player ka category-wise point P/L (point ledger ka SUM).
 * Client = staff → uske neeche ke players, player → sirf wahi.
 */
const UserWinLossReport = ({ channel }: { channel: Channel }) => {
  const [client, setClient] = useState<Client | null>(null)
  const [range, setRange] = useState(defaultRange())
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<WinLossRow[]>([])
  const [loading, setLoading] = useState(false)

  const handleLoad = async (e: FormEvent) => {
    e.preventDefault()
    const badRange = rangeError(range)

    if (badRange) {
      toast.error(badRange)

      return
    }

    setLoading(true)

    try {
      // Direct users ki point entry nahi banti — unka report bets + sports ledger se (alag API, INR = pts).
      const res = await withMinimumDelay(
        channel === 'direct'
          ? api.post<{ rows: WinLossRow[] }>('admin/exchange/reports/direct-user-win-loss', { ...clientBody(client), fromDate: range.from, toDate: range.to })
          : api.post<{ rows: WinLossRow[] }>('admin/exchange/reports/user-win-loss', { ...clientBody(client), channel, fromDate: range.from, toDate: range.to })
      )

      setRows(res.rows)
    } catch (err) {
      toast.error(errorMessage(err))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setClient(null)
    setRange(defaultRange())
    setSearch('')
    setLoading(true)
    setTimeout(() => {
      setRows([])
      setLoading(false)
    }, 1000)
  }

  const filtered = search ? rows.filter(r => (r.username || '').toLowerCase().includes(search.toLowerCase())) : rows

  const totals = filtered.reduce(
    (acc, r) => ({
      sport: acc.sport + (Number(r.sports_pts) || 0),
      casino: acc.casino + (Number(r.casino_pts) || 0),
      original: acc.original + (Number(r.original_pts) || 0),
      total: acc.total + (Number(r.total) || 0)
    }),
    { sport: 0, casino: 0, original: 0, total: 0 }
  )

  const exportRows = () =>
    filtered.map((r, i) => [i + 1, r.username, fmt(r.sports_pts), fmt(r.casino_pts), fmt(r.original_pts), fmt(r.total)])

  const columns: ReportColumn<WinLossRow>[] = [
    { key: 'no', header: 'No', cell: (_, i) => i + 1 },
    { key: 'username', header: 'User Name', cell: r => r.username },
    { key: 'sport', header: 'Sportpts', align: 'right', cell: r => fmt(r.sports_pts) },
    { key: 'casino', header: 'Casinopts', align: 'right', cell: r => fmt(r.casino_pts) },
    { key: 'original', header: 'Originalpts', align: 'right', cell: r => fmt(r.original_pts) },
    { key: 'pl', header: 'Profit/Loss', align: 'right', cell: r => fmt(r.total) }
  ]

  return (
    <div>

      <ReportCard>
        <form onSubmit={handleLoad} className='grid items-end gap-4 border-b p-4 md:grid-cols-3'>
          <FilterField label='Search By Client Name'>
            <ClientSearch value={client} onChange={setClient} channel={channel} />
          </FilterField>
          <FilterField label='Select Date Range'>
            <DateRangePicker from={range.from} to={range.to} max={defaultRange().to} clearable={false} onChange={r => setRange({ from: r.from, to: r.to })} />
          </FilterField>
          <ActionButtons
            busy={loading}
            onReset={handleReset}
            canExport={filtered.length > 0}
            onExcel={() => exportExcel('userwinloss', EXPORT_COLS, exportRows())}
            onPdf={() => exportPdf('userwinloss', 'User Win Loss', EXPORT_COLS, exportRows())}
          />
        </form>

        <EntriesBar search={search} onSearch={setSearch} searchLabel='Search:' />
        <ReportTable
          columns={columns}
          rows={filtered}
          rowKey={r => r.user_id}
          emptyMessage={search ? 'There are no records matching your request' : 'There are no records to show'}
          footer={['', '', fmt(totals.sport), fmt(totals.casino), fmt(totals.original), fmt(totals.total)]}
        />
      </ReportCard>
    </div>
  )
}

/** Agent Management: sirf Agent Users (`channel=agent`) — direct users ka tab yahan nahi. */
const UserWinLoss = () => (
  <div>
    <PageHeader title='User Win Loss' />
    <UserWinLossReport channel='agent' />
  </div>
)

export default UserWinLoss
