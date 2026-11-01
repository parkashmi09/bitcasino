'use client'

import { useMemo, useState } from 'react'

import { ChevronLeftIcon, ChevronRightIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon } from 'lucide-react'

import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { usePagedApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'
import { exportExcel, exportPdf } from '../exportList'
import { MARKET_API, fmtDateTime, isLay, plain, rateOf, type Bet } from './api'

const MATCH_STATUS = [
  ['matchbet', 'Matched'],
  ['unsettled', 'Unmatched'],
  ['deletebet', 'Deleted']
]

const BET_TYPES = [
  ['all', 'All'],
  ['back', 'Back'],
  ['lay', 'Lay']
]

const LIMITS = [25, 50, 75, 100, 125, 150]

/** "Detail" dabane pe ek bet ki poori jaankari. */
function BetDetail({ bet, onClose }: { bet: Bet; onClose: () => void }) {
  const rows: [string, string | null][] = [
    ['User Name', bet.username],
    ['Event Type', bet.sportName],
    ['Event Name', bet.eventName],
    ['Market', bet.marketLabel || bet.marketType],
    ['Nation', bet.selection],
    ['Side', isLay(bet) ? 'Lay' : 'Back'],
    ['U Rate', rateOf(bet)],
    ['Amount', plain(bet.stake)],
    ['Status', bet.deleted ? 'Deleted' : bet.unmatched ? 'Unmatched' : 'Matched'],
    ['Place Date', fmtDateTime(bet.createdAt)],
    ['IP', bet.ip],
    ['Browser', bet.browser],
    ['Bet ID', bet.id]
  ]

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bet Detail</DialogTitle>
        </DialogHeader>
        <table className='w-full text-sm'>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className='border-b last:border-0'>
                <th className='text-muted-foreground py-1.5 pr-3 text-left font-normal whitespace-nowrap'>{k}</th>
                <td className='py-1.5 break-all'>{v || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  )
}

const COLUMNS = ['Event Type', 'Event Name', 'User Name', 'M Name', 'Nation', 'U Rate', 'Amount', 'Place Date', 'IP', 'Browser', 'Action']
const EXPORT_COLS = COLUMNS.slice(0, 10)

/** Radio ki ek line. */
function Radios({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[][] }) {
  return (
    <RadioGroup value={value} onValueChange={v => onChange(String(v))} className='flex w-auto flex-wrap gap-4'>
      {options.map(([v, label]) => (
        <Label key={v} className='flex items-center gap-1.5 font-normal'>
          <RadioGroupItem value={v} /> {label}
        </Label>
      ))}
    </RadioGroup>
  )
}

/**
 * Current Bets — zip ka `pages/reports/CurrentBets.jsx` (sirf Sports tab).
 *
 * Data sirf "Load" dabane pe aata hai. Search box loaded rows pe hi filter karta hai (API ko
 * nahi jaata). Total Bets / Total Amount = dikh rahi rows ka. Back = blue border, Lay = pink.
 * Upar Direct Users | Agent Users tab — dono ki bets alag (API ko `channel`).
 */
const BetsList = ({ channel }: { channel: Channel }) => {
  const [matchStatus, setMatchStatus] = useState('matchbet')
  const [betType, setBetType] = useState('all')
  const [limit, setLimit] = useState(25)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<Bet | null>(null)

  // Load dabane pe filters yahan "lock" hote hain — tabhi API chalti hai
  const [loaded, setLoaded] = useState<{ matchStatus: string; betType: string } | null>(null)

  const { data, isFetching, error, refetch } = usePagedApi<Bet>(loaded ? `${MARKET_API}/current-bets` : null, {
    matchStatus: loaded?.matchStatus,
    betType: loaded?.betType,
    channel,
    limit,
    page
  })

  const rows = useMemo(() => (loaded ? (data?.rows ?? []) : []), [data, loaded])
  const totalPages = Math.max(1, data?.pagination.totalPages ?? 1)

  // search: dikhne wale saare columns pe, case-insensitive
  const term = search.trim().toLowerCase()

  const filtered = term
    ? rows.filter(b =>
        [b.sportName, b.eventName, b.username, b.marketLabel || b.marketType, b.selection, rateOf(b), b.stake, fmtDateTime(b.createdAt), b.ip, b.browser].some(v =>
          String(v ?? '').toLowerCase().includes(term)
        )
      )
    : rows

  const totalAmount = filtered.reduce((sum, b) => sum + (Number.parseFloat(b.stake) || 0), 0)

  // same filters + page 1 pe dobara Load = refetch
  const load = () => {
    if (loaded && loaded.matchStatus === matchStatus && loaded.betType === betType && page === 1) void refetch()
    setPage(1)
    setLoaded({ matchStatus, betType })
  }

  const exportRows = () =>
    rows.map(b => [b.sportName ?? '', b.eventName ?? '', b.username, b.marketLabel || b.marketType || '', b.selection ?? '', rateOf(b), Number(b.stake).toLocaleString(), fmtDateTime(b.createdAt), b.ip, b.browser])

  return (
      <Card size='sm' className='gap-4 p-4'>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <Radios value={matchStatus} onChange={setMatchStatus} options={MATCH_STATUS} />
          <div className='flex flex-wrap items-center gap-3'>
            <Radios value={betType} onChange={setBetType} options={BET_TYPES} />
            <Button title='Refresh Data' onClick={load} disabled={isFetching}>
              {isFetching && <Loader2Icon className='animate-spin' />} Load
            </Button>
            <Button variant='outline' size='icon' disabled={!rows.length} onClick={() => exportExcel('currentbets', EXPORT_COLS, exportRows())} aria-label='Excel'>
              <FileSpreadsheetIcon />
            </Button>
            <Button variant='outline' size='icon' disabled={!rows.length} onClick={() => void exportPdf('currentbets', 'Current Bets', EXPORT_COLS, exportRows())} aria-label='PDF'>
              <FileTextIcon />
            </Button>
          </div>
          <h5 className='font-semibold'>
            Total Bets: <span className='mr-2'>{filtered.length}</span> Total Amount: <span>{totalAmount.toLocaleString()}</span>
          </h5>
        </div>

        <div className='flex flex-wrap items-center justify-between gap-2'>
          <label className='flex items-center gap-2 text-sm'>
            Show
            <select
              className='border-input bg-background h-8 rounded-md border px-2'
              value={limit}
              onChange={e => {
                setLimit(Number(e.target.value))
                setPage(1)
              }}
            >
              {LIMITS.map(l => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            entries
          </label>
          <Input type='search' placeholder='Search...' value={search} onChange={e => setSearch(e.target.value)} className='w-full sm:w-56' />
        </div>

        {error ? (
          <ErrorState error={error} />
        ) : (
          <div className='overflow-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='bg-muted'>
                  {COLUMNS.map(c => (
                    <th key={c} className={cn('px-3 py-2 text-left whitespace-nowrap', (c === 'U Rate' || c === 'Amount') && 'text-right')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className='px-3 py-4 text-center'>
                      There are no records to show
                    </td>
                  </tr>
                ) : (
                  filtered.map(b => (
                    <tr key={b.id} className={cn('border-t border-l-4', isLay(b) ? 'border-l-pink-400' : 'border-l-sky-400')}>
                      <td className='px-3 py-1.5'>{b.sportName}</td>
                      <td className='min-w-48 px-3 py-1.5'>{b.eventName}</td>
                      <td className='px-3 py-1.5'>{b.username}</td>
                      <td className='px-3 py-1.5'>{b.marketLabel || b.marketType}</td>
                      <td className='px-3 py-1.5'>{b.selection}</td>
                      <td className='px-3 py-1.5 text-right tabular-nums'>{rateOf(b)}</td>
                      <td className='px-3 py-1.5 text-right tabular-nums'>{plain(b.stake)}</td>
                      <td className='px-3 py-1.5 whitespace-nowrap'>{fmtDateTime(b.createdAt)}</td>
                      <td className='px-3 py-1.5'>{b.ip}</td>
                      <td className='px-3 py-1.5'>
                        <button type='button' className='text-success cursor-pointer hover:underline' title={b.browser || undefined} onClick={() => setDetail(b)}>
                          Detail
                        </button>
                      </td>
                      <td className='px-3 py-1.5'>
                        <Checkbox aria-label='Select bet' />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className='flex items-center justify-end gap-2 text-sm'>
          <Button variant='outline' size='icon-sm' disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label='Previous page'>
            <ChevronLeftIcon />
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button variant='outline' size='icon-sm' disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} aria-label='Next page'>
            <ChevronRightIcon />
          </Button>
        </div>
        {detail && <BetDetail bet={detail} onClose={() => setDetail(null)} />}
      </Card>
  )
}

const CurrentBets = () => (
  <div>
    <PageHeader title='Current Bets' />

    <div className='mb-3 flex border-b'>
      <span className='border-primary text-primary -mb-px border-b-2 px-4 py-2 text-sm font-semibold'>Sports</span>
    </div>

    <ChannelTabs>{channel => <BetsList channel={channel} />}</ChannelTabs>
  </div>
)

export default CurrentBets
