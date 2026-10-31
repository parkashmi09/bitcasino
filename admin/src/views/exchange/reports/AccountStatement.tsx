'use client'

import { useState, type FormEvent } from 'react'

import { FileSpreadsheetIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import { DateRangePicker } from '@/components/ui/date-picker'
import { api, errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { exportPdf } from '../exportList'
import {
  ActionButtons,
  ClientSearch,
  clientBody,
  daysBetween,
  defaultRange,
  EntriesBar,
  FilterField,
  formatDisplay,
  GAME_TYPES,
  Pager,
  Pick,
  ReportCard,
  ReportTable,
  SPORTS_LIST,
  withMinimumDelay,
  type Client,
  type ReportColumn,
  rangeError
} from './reportKit'
import StatementBetDetail, { type BetDetail } from './StatementBetDetail'

type StatementRow = {
  id: string
  date: string
  credit: number | string
  debit: number | string
  closing: number | string
  description: string
  fromto: string
  betId: string | null
  category: string | null
}

type StatementPage = { rows: StatementRow[]; total: number; totalPages: number; page: number }
type BetSheet = { filename: string; columns: string[]; rows: string[][] }

const RANGE_NOTICE = 'Sorry for inconvenience! You will see statement of 10 days date range in 3 months timeslot.'

const TYPE_OPTIONS: [string, string][] = [['2', 'Deposit/Withdraw Report'], ['3', 'Game Report']]

const TRANSACTION_STATEMENTS: [string, string][] = [
  ['all', 'All'],
  ['allcredit', 'Credit - All'],
  ['creditupper', 'Credit - Upper'],
  ['creditdown', 'Credit - Down'],
  ['allbalance', 'pts - All'],
  ['balanceupper', 'pts - Upper'],
  ['balancedown', 'pts - Down']
]

// Game Report me zip ka "Casino" option nahi (is project me casino exchange nahi).
const GAME_STATEMENTS: [string, string][] = [['all', 'All'], ['sport', 'Sports']]

/** Jis row ke peeche asli bet hai — click par Details, Remark ke aage Excel icon. */
const hasBets = (r: StatementRow) => Boolean(r.betId) && r.category === 'SPORTS'

/** CSV field: comma / quote / newline wali value quote me (excel ka rule). */
const csvCell = (v: unknown) => {
  const t = v == null ? '' : String(v)

  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

const downloadCsv = (fileName: string, lines: unknown[][]) => {
  const csv = lines.map(r => r.map(csvCell).join(',')).join('\n')
  const a = document.createElement('a')

  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = fileName
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * Account Statement — zip ka `reports/AccountStatement.jsx`.
 *
 * Deposit/Withdraw Report = point ledger ki Credit/Debit/Bank entries, Game Report = bet settlement.
 * Client na chuno to apna statement. Pehli row "Opening pts" (From date se pehle ka balance).
 * Game row par click = us market ke bets (Details), Excel icon = bets ki CSV.
 */
const AccountStatement = () => {
  const initial = defaultRange()
  const [client, setClient] = useState<Client | null>(null)
  const [range, setRange] = useState(initial)
  const [typeVal, setTypeVal] = useState('2')
  const [statementVal, setStatementVal] = useState('all')
  const [sportVal, setSportVal] = useState('0')
  const [gameTypeVal, setGameTypeVal] = useState('all')

  const [limit, setLimit] = useState(25)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [data, setData] = useState<StatementPage | null>(null)
  const [loading, setLoading] = useState(false)

  const [detail, setDetail] = useState<BetDetail | null>(null)
  const [busyBet, setBusyBet] = useState<string | null>(null)

  const fetchPage = async (pageNo: number, pageLimit: number) => {
    // 10 din se lamba range kabhi load nahi hota (Load par notice).
    if (daysBetween(range.from, range.to) > 10) return null

    // Agent Management: direct users never show here (only the Super Admin sees them, elsewhere).
    return api.post<StatementPage>('admin/exchange/reports/statement', {
      ...clientBody(client),
      channel: 'agent',
      reportType: typeVal === '3' ? 'SPORTS' : 'TRANSACTION',
      fromDate: range.from,
      toDate: range.to,
      page: pageNo,
      limit: pageLimit,
      statement: statementVal,
      sportId: sportVal,
      gameType: gameTypeVal
    })
  }

  const load = async (pageNo: number, withDelay: boolean, pageLimit = limit) => {
    setLoading(true)

    try {
      const work = fetchPage(pageNo, pageLimit)

      setData(await (withDelay ? withMinimumDelay(work) : work))
    } catch (err) {
      toast.error(errorMessage(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  // Page ya entries badle to wahi filters dobara (sirf jab ek baar Load ho chuka).
  const changePage = (p: number) => {
    setPage(p)
    if (data) void load(p, false)
  }

  const changeLimit = (l: number) => {
    setLimit(l)
    setPage(1)
    if (data) void load(1, false, l)
  }

  const handleLoad = (e: FormEvent) => {
    e.preventDefault()

    // Server (`statement` validator): From ≤ To and at most 7 days.
    const badRange = daysBetween(range.from, range.to) > 10 ? RANGE_NOTICE : rangeError(range, { maxDays: 7, threeMonths: false })

    if (badRange) {
      toast.error(badRange)
      setData(null)
      setPage(1)

      return
    }

    setPage(1)
    void load(1, true)
  }

  // Reset table bhi saaf karta hai — data sirf Load par wapas aata hai.
  const handleReset = () => {
    setClient(null)
    setRange(defaultRange())
    setTypeVal('2')
    setStatementVal('all')
    setSportVal('0')
    setGameTypeVal('all')
    setSearch('')
    setPage(1)
    setLoading(true)
    setTimeout(() => {
      setData(null)
      setLoading(false)
    }, 1000)
  }

  const changeType = (value: string) => {
    setTypeVal(value)
    setStatementVal('all')
    setSportVal('0')
    setGameTypeVal('all')
  }

  const rows = (data?.rows ?? []).filter(
    r => !search || (r.description || '').toLowerCase().includes(search.toLowerCase()) || (r.fromto || '').toLowerCase().includes(search.toLowerCase())
  )

  // Game row par click → loader, phir Details modal (data aane ke baad hi khulta hai).
  const openDetail = async (r: StatementRow) => {
    if (!hasBets(r) || busyBet) return
    setBusyBet(r.betId)

    try {
      setDetail(await api.post<BetDetail>('admin/exchange/reports/statement/bet-detail', { betId: Number(r.betId), category: r.category }))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyBet(null)
    }
  }

  // Remark ke aage Excel icon → us row ke peeche ke saare bets CSV me.
  const downloadBets = async (r: StatementRow) => {
    if (!hasBets(r) || busyBet) return
    setBusyBet(r.betId)

    try {
      const sheet = await api.post<BetSheet>('admin/exchange/reports/statement/bet-export', { betId: Number(r.betId), category: r.category })

      if (!sheet.rows.length) toast.info('No bets found for this entry')
      else downloadCsv(sheet.filename, [sheet.columns, ...sheet.rows])
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyBet(null)
    }
  }

  const handleExcel = () => {
    const today = new Date().toISOString().slice(0, 10)

    downloadCsv(`account_statement_${today}.csv`, [
      ['Date', 'Credit', 'Debit', 'Closing', 'Description', 'From/To'],
      ...rows.map(r => [
        formatDisplay(r.date),
        r.credit !== 0 && r.credit != null ? r.credit : '',
        r.debit !== 0 && r.debit != null ? r.debit : '',
        r.closing ?? '-',
        (r.description || '-').replace(/,/g, ' '),
        r.fromto || '-'
      ])
    ])
  }

  const handlePdf = () =>
    exportPdf(
      'accountstatement',
      'Account Statement',
      ['Date', 'Sr No', 'Credit', 'Debit', 'pts', 'Remark', 'Fromto'],
      rows.map((r, i) => [formatDisplay(r.date), i + 1, Number(r.credit) || '', Number(r.debit) || '', r.closing ?? '', r.description || '', r.fromto || ''])
    )

  const columns: ReportColumn<StatementRow>[] = [
    { key: 'date', header: 'Date', cell: r => <span className='whitespace-nowrap'>{formatDisplay(r.date)}</span> },
    { key: 'sr', header: 'Sr No', align: 'right', cell: (_, i) => i + 1 },
    {
      key: 'credit',
      header: 'Credit',
      align: 'right',
      cell: r => {
        const credit = Number(r.credit) || 0

        return <span className={cn(credit !== 0 && 'text-success')}>{credit !== 0 ? credit.toLocaleString() : ''}</span>
      }
    },
    {
      key: 'debit',
      header: 'Debit',
      align: 'right',

      // Debit hamesha minus me dikhe, API ka sign kuch bhi ho.
      cell: r => {
        const debit = Number(r.debit) || 0

        return <span className={cn(debit !== 0 && 'text-danger')}>{debit !== 0 ? (-Math.abs(debit)).toLocaleString() : ''}</span>
      }
    },
    {
      key: 'pts',
      header: 'pts',
      align: 'right',

      // negative laal, positive hara, 0 saada
      cell: r => {
        const closing = Number(r.closing)

        return <span className={cn(closing < 0 && 'text-danger', closing > 0 && 'text-success')}>{r.closing != null ? closing.toLocaleString() : ''}</span>
      }
    },
    {
      key: 'remark',
      header: 'Remark',
      cell: r => (
        <span className='inline-flex items-center gap-1'>
          {r.description || ''}
          {hasBets(r) && (
            <button
              type='button'
              title='Download bets'
              className='text-success'
              disabled={busyBet === r.betId}
              onClick={e => {
                e.stopPropagation()
                void downloadBets(r)
              }}
            >
              {busyBet === r.betId ? <Loader2Icon className='size-4 animate-spin' /> : <FileSpreadsheetIcon className='size-4' />}
            </button>
          )}
        </span>
      )
    },
    { key: 'fromto', header: 'Fromto', cell: r => r.fromto || '' }
  ]

  return (
    <div>
      <PageHeader title='Account Statement' />

      <ReportCard>
        <form onSubmit={handleLoad} className='space-y-4 border-b p-4'>
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-6'>
            <FilterField label='Search By Client Name' className='lg:col-span-1'>
              <ClientSearch value={client} onChange={setClient} channel='agent' />
            </FilterField>
            <FilterField label='Select Date Range' className='lg:col-span-1'>
              <DateRangePicker from={range.from} to={range.to} max={defaultRange().to} clearable={false} onChange={r => setRange({ from: r.from, to: r.to })} />
            </FilterField>
            <FilterField label='Type'>
              <Pick value={typeVal} onChange={changeType} options={TYPE_OPTIONS} />
            </FilterField>
            <FilterField label='Statement'>
              <Pick
                value={statementVal}
                onChange={v => {
                  setStatementVal(v)
                  setSportVal('0')
                  setGameTypeVal('all')
                }}
                options={typeVal === '3' ? GAME_STATEMENTS : TRANSACTION_STATEMENTS}
              />
            </FilterField>
            {typeVal === '3' && statementVal === 'sport' && (
              <>
                <FilterField label='Sports List'>
                  <Pick value={sportVal} onChange={setSportVal} options={[['0', 'All'], ...SPORTS_LIST]} />
                </FilterField>
                <FilterField label='Game Type'>
                  <Pick value={gameTypeVal} onChange={setGameTypeVal} options={[['all', 'All'], ...GAME_TYPES]} />
                </FilterField>
              </>
            )}
          </div>
          <ActionButtons busy={loading} onReset={handleReset} canExport={rows.length > 0} onExcel={handleExcel} onPdf={handlePdf} />
        </form>

        <EntriesBar
          limit={limit}
          onLimit={changeLimit}
          search={search}
          onSearch={setSearch}
        />
        <ReportTable columns={columns} rows={rows} rowKey={r => r.id} onRowClick={openDetail} canClick={hasBets} />
        <Pager page={page} totalPages={data?.totalPages ?? 1} onPage={changePage} />
      </ReportCard>

      <StatementBetDetail key={detail?.bets[0]?.id ?? 'closed'} detail={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

export default AccountStatement
