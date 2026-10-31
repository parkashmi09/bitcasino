'use client'

import { useState, type FormEvent } from 'react'

import { toast } from 'sonner'

import type { Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import { api, errorMessage } from '@/lib/api/client'
import { exportExcel, exportPdf } from '../exportList'
import { ActionButtons, EntriesBar, fmt, Pager, Pick, ReportCard, ReportTable, usePaged, withMinimumDelay, type ReportColumn } from './reportKit'

type PartyRow = {
  key: string
  username: string
  level: string
  sport_pts: number
  casino_pts: number
  original_pts: number
  profit_loss: number
  ptype: string
}

const EXPORT_COLS = ['No', 'User Name', 'Level', 'Sport pts', 'Casino pts', 'Original pts', 'Profit/Loss', 'Ptype']

/**
 * Party Win Loss — zip ka `reports/ProfitLoss.jsx` (`GET /admin/profitloss/all`).
 *
 * Tree ke sab players ka game P/L (point ledger se). Upar mera + mere staff (points 0,
 * kyunki staff ka number players ka hi jod hai), phir players. "User" = sirf players.
 * Poora set ek baar aata hai — paging, search aur totals browser me.
 */
const PartyWinLossReport = ({ channel }: { channel: Channel }) => {
  const [filterType, setFilterType] = useState('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(25)
  const [rows, setRows] = useState<PartyRow[]>([])
  const [loading, setLoading] = useState(false)

  const handleLoad = async (e?: FormEvent) => {
    e?.preventDefault()
    setLoading(true)

    try {
      setRows(await withMinimumDelay(api.get<PartyRow[]>('admin/exchange/reports/party-win-loss', { type: filterType, search: search || undefined, channel })))
    } catch (err) {
      toast.error(errorMessage(err))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setFilterType('all')
    setSearch('')
    setLoading(true)
    setTimeout(() => {
      setRows([])
      setLoading(false)
    }, 1000)
  }

  const filtered = search ? rows.filter(r => (r.username || '').toLowerCase().includes(search.toLowerCase())) : rows
  const { page, setPage, totalPages, start, pageRows } = usePaged(filtered, limit)

  // Footer totals aur export poore filtered set par, sirf page par nahi.
  const totals = filtered.reduce(
    (acc, r) => ({
      sport: acc.sport + (Number(r.sport_pts) || 0),
      casino: acc.casino + (Number(r.casino_pts) || 0),
      original: acc.original + (Number(r.original_pts) || 0),
      pl: acc.pl + (Number(r.profit_loss) || 0)
    }),
    { sport: 0, casino: 0, original: 0, pl: 0 }
  )

  const exportRows = () =>
    filtered.map((r, i) => [i + 1, r.username || '-', r.level || '-', fmt(r.sport_pts), fmt(r.casino_pts), fmt(r.original_pts), fmt(r.profit_loss), r.ptype || 'Point'])

  const columns: ReportColumn<PartyRow>[] = [
    { key: 'no', header: 'No', cell: (_, i) => start + i + 1 },
    { key: 'username', header: 'User Name', cell: r => r.username || '-' },
    { key: 'level', header: 'Level', cell: r => r.level || '-' },
    { key: 'sport', header: 'Sport pts', align: 'right', cell: r => fmt(r.sport_pts) },
    { key: 'casino', header: 'Casino pts', align: 'right', cell: r => fmt(r.casino_pts) },
    { key: 'original', header: 'Original pts', align: 'right', cell: r => fmt(r.original_pts) },
    { key: 'pl', header: 'Profit/Loss', align: 'right', cell: r => fmt(r.profit_loss) },
    { key: 'ptype', header: 'Ptype', cell: r => r.ptype || 'Point' }
  ]

  return (
    <div>

      <ReportCard>
        <form onSubmit={handleLoad} className='flex flex-wrap items-center gap-4 border-b p-4'>
          <Pick value={filterType} onChange={setFilterType} options={[['all', 'All'], ['user', 'User']]} className='w-48' />
          <ActionButtons
            busy={loading}
            onReset={handleReset}
            canExport={filtered.length > 0}
            onExcel={() => exportExcel('partywinloss', EXPORT_COLS, exportRows())}
            onPdf={() => exportPdf('partywinloss', 'Party Win Loss', EXPORT_COLS, exportRows())}
          />
        </form>

        <EntriesBar limit={limit} onLimit={setLimit} search={search} onSearch={setSearch} />
        <ReportTable
          columns={columns}
          rows={pageRows}
          rowKey={r => r.key}
          emptyMessage={search ? 'There are no records matching your request' : 'There are no records to show'}
          footer={['', '', '', fmt(totals.sport), fmt(totals.casino), fmt(totals.original), fmt(totals.pl), '']}
        />
        <Pager page={page} totalPages={totalPages} onPage={setPage} />
      </ReportCard>
    </div>
  )
}

/** Agent Management: sirf Agent Users (`channel=agent`) — direct users ka tab yahan nahi. */
const PartyWinLoss = () => (
  <div>
    <PageHeader title='Party Win Loss' />
    <PartyWinLossReport channel='agent' />
  </div>
)

export default PartyWinLoss
