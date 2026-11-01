'use client'

import { useState } from 'react'

import { DownloadIcon, FileTextIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import DataTable, { type Column } from '@/components/shared/DataTable'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api/client'

/** One product's line (backend common/whitelabelReport `assemble`). All amounts INR. */
export type StatementRow = {
  product: 'casino' | 'originals' | 'sports'
  label: string
  bets?: string
  wins?: string
  refunds?: string
  rollbacks?: string
  staked?: string | null
  betCount: number | null
  ggr: string | null
  sharePct: string
  share: string | null
}

export type Statement = {
  from: string
  to: string
  currency: 'INR'
  products: StatementRow[]
  totalGgr: string
  totalShare: string
  complete: boolean
  sportsError: string | null
  gateway: { deposits: string; depositCount: number; withdrawals: string; withdrawalCount: number; charges: string }
  transfers: { amount: string; count: number }
  account: Account | null
  unconverted: string[]
}

/** The account between the parent and the company, entry by entry (backend accountWithParent). */
export type AccountEntry = {
  at: string
  kind: 'transfer' | 'gateway_deposit' | 'gateway_withdrawal'
  provider: string | null
  reference: string
  currency: string
  amount: string
  charge: string
  net: string
  balance: string
}

export type Account = {
  opening: string
  closing: string
  entries: AccountEntry[]
  truncated: boolean
  totals: { given: string; deposits: string; withdrawals: string; charges: string }
}

const ENTRY_LABEL: Record<AccountEntry['kind'], string> = {
  transfer: 'Balance sent by the parent',
  gateway_deposit: 'Gateway deposit',
  gateway_withdrawal: 'Gateway withdrawal'
}

const GATEWAY_NAME: Record<string, string> = { ccpayment: 'CCPayment', f2pay: 'F2Pay', upi: 'UPI' }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export type Period = { from: string; to: string }

const inr = (v: string | null | undefined) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

/** `YYYY-MM` → the month as `{ from, to }` (`to` = the next month's first day, exclusive). */
export const monthPeriod = (month: string): Period => {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`

  return { from: `${month}-01`, to: `${next}-01` }
}

export const thisMonth = () => new Date().toISOString().slice(0, 7)

/** A month picker: statements run by calendar month (UTC). */
export const MonthPicker = ({ value, onChange }: { value: string; onChange: (month: string) => void }) => (
  <Input type='month' value={value} max={thisMonth()} onChange={e => e.target.value && onChange(e.target.value)} className='w-40' aria-label='Month' />
)

/** Download a CSV the backend builds (`path` answers text/csv). */
export const CsvButton = ({ path, period, fileName }: { path: string; period: Period; fileName: string }) => {
  const [busy, setBusy] = useState(false)

  const download = async () => {
    setBusy(true)

    try {
      const blob = await api.blob(path, period)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')

      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size='sm' variant='outline' disabled={busy} onClick={download}>
      {busy ? <Loader2Icon className='animate-spin' /> : <DownloadIcon />} CSV
    </Button>
  )
}

/** PDF amounts: jsPDF's built-in font has no ₹ glyph, so the code is spelled out. */
const pdfInr = (v: string | null | undefined) =>
  v == null ? '-' : `INR ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export type NamedStatement = Statement & { name?: string; slug?: string; status?: string }

/**
 * The statement(s) on screen as a PDF, built in the browser like the other exports
 * (views/exchange/exportList): a title, then per whitelabel its product table and summary.
 */
export async function statementPdf(fileName: string, title: string, statements: NamedStatement[], totals?: { totalGgr: string; totalShare: string }) {
  const { default: JsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new JsPDF('l', 'pt')
  const pageWidth = doc.internal.pageSize.getWidth()
  const head = { fillColor: [41, 128, 185] as [number, number, number], textColor: 255, fontStyle: 'bold' as const }
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60

  doc.setFontSize(15)
  doc.setTextColor(51, 51, 51)
  doc.text(title, pageWidth / 2, 32, { align: 'center' })
  doc.setFontSize(9)
  doc.setTextColor(110, 110, 110)
  doc.text(`Generated ${new Date().toLocaleString('en-IN')} · amounts in INR · reported, not collected`, pageWidth / 2, 47, { align: 'center' })
  let y = 62

  if (totals) {
    autoTable(doc, {
      startY: y,
      theme: 'plain',
      styles: { fontSize: 11, fontStyle: 'bold' },
      body: [[`All whitelabels — total GGR ${pdfInr(totals.totalGgr)}`, `Revenue share due ${pdfInr(totals.totalShare)}`]]
    })
    y = lastY() + 10
  }

  statements.forEach((st, i) => {
    if (i > 0 && y > doc.internal.pageSize.getHeight() - 200) {
      doc.addPage()
      y = 40
    }

    if (st.name) {
      doc.setFontSize(12)
      doc.setTextColor(51, 51, 51)
      doc.text(`${st.name}${st.slug ? ` (${st.slug})` : ''}${st.status ? ` · ${st.status}` : ''}`, 40, y + 12)
      y += 20
    }

    autoTable(doc, {
      startY: y,
      theme: 'striped',
      styles: { fontSize: 10, cellPadding: 5 },
      headStyles: head,
      head: [['Product', 'Bets / staked', 'Wins', 'GGR', 'Share %', 'Revenue share']],
      body: [
        ...st.products.map(r => [r.label, pdfInr(r.bets ?? r.staked ?? null), r.wins == null ? '-' : pdfInr(r.wins), r.ggr == null ? 'not available' : pdfInr(r.ggr), `${Number(r.sharePct)}%`, pdfInr(r.share)]),
        ['Total', '', '', pdfInr(st.totalGgr), '', pdfInr(st.totalShare)]
      ],
      didParseCell: data => {
        if (data.section === 'body' && data.row.index === st.products.length) data.cell.styles.fontStyle = 'bold'
      }
    })
    autoTable(doc, {
      startY: lastY() + 6,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      body: [
        ['Gateway deposits', `${pdfInr(st.gateway.deposits)} (${st.gateway.depositCount})`, 'Gateway withdrawals', `${pdfInr(st.gateway.withdrawals)} (${st.gateway.withdrawalCount})`],
        ['Gateway charges', pdfInr(st.gateway.charges), 'Balance sent by the parent', `${pdfInr(st.transfers.amount)} (${st.transfers.count})`],
        ...(st.sportsError ? [['Sports', `not available: ${st.sportsError}`, '', '']] : []),
        ...(st.unconverted.length ? [['No exchange rate (left out)', st.unconverted.join(', '), '', '']] : [])
      ]
    })

    if (st.account) {
      const a = st.account

      autoTable(doc, {
        startY: lastY() + 10,
        theme: 'striped',
        styles: { fontSize: 8.5, cellPadding: 4 },
        headStyles: head,
        head: [['Date', 'Entry', 'Gateway', 'Reference', 'Amount', 'Charge', 'Net', 'Balance']],
        body: [
          ['', 'Opening balance', '', '', '', '', '', pdfInr(a.opening)],
          ...a.entries.map(e => [when(e.at), ENTRY_LABEL[e.kind], e.provider ? GATEWAY_NAME[e.provider] ?? e.provider : '', e.reference, pdfInr(e.amount), e.charge === '0.00000000' ? '-' : pdfInr(e.charge), pdfInr(e.net), pdfInr(e.balance)]),
          ['', 'Closing balance', '', '', '', '', '', pdfInr(a.closing)],
          ['', `Given ${pdfInr(a.totals.given)}`, '', `Deposits ${pdfInr(a.totals.deposits)}`, `Withdrawals ${pdfInr(a.totals.withdrawals)}`, `Charges ${pdfInr(a.totals.charges)}`, '', '']
        ],
        didParseCell: data => {
          if (data.section === 'body' && (data.row.index === 0 || data.row.index >= a.entries.length + 1)) data.cell.styles.fontStyle = 'bold'
        }
      })
    }

    y = lastY() + 24
  })

  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text(
    'GGR = bets - wins (less refunds and rollbacks); the share is on a product\'s positive GGR only. Casino and original games from the parent site\'s record of every round; sports from the whitelabel\'s own books.',
    40,
    Math.min(y, doc.internal.pageSize.getHeight() - 20),
    { maxWidth: pageWidth - 80 }
  )
  doc.save(`${fileName}.pdf`)
}

/** PDF of what is on screen (nothing to fetch: `get` returns the loaded statements). */
export const PdfButton = ({ get, fileName, title }: { get: () => { statements: NamedStatement[]; totals?: { totalGgr: string; totalShare: string } } | null; fileName: string; title: string }) => {
  const [busy, setBusy] = useState(false)

  const download = async () => {
    const data = get()

    if (!data) return
    setBusy(true)

    try {
      await statementPdf(fileName, title, data.statements, data.totals)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size='sm' variant='outline' disabled={busy || !get()} onClick={download}>
      {busy ? <Loader2Icon className='animate-spin' /> : <FileTextIcon />} PDF
    </Button>
  )
}

const columns: Column<StatementRow>[] = [
  { key: 'product', header: 'Product', cell: r => r.label },
  { key: 'bets', header: 'Bets / staked', align: 'right', cell: r => inr(r.bets ?? r.staked ?? null) },
  { key: 'wins', header: 'Wins', align: 'right', cell: r => (r.wins == null ? '—' : inr(r.wins)) },
  { key: 'ggr', header: 'GGR', align: 'right', cell: r => (r.ggr == null ? <span className='text-muted-foreground'>not available</span> : inr(r.ggr)) },
  { key: 'pct', header: 'Share %', align: 'right', cell: r => `${Number(r.sharePct)}%` },
  { key: 'share', header: 'Revenue share', align: 'right', cell: r => <strong>{inr(r.share)}</strong> }
]

const accountColumns: Column<AccountEntry>[] = [
  { key: 'at', header: 'Date', cell: r => when(r.at) },
  { key: 'kind', header: 'Entry', cell: r => ENTRY_LABEL[r.kind] },
  { key: 'gateway', header: 'Gateway', cell: r => (r.provider ? GATEWAY_NAME[r.provider] ?? r.provider : '—') },
  { key: 'ref', header: 'Reference', cell: r => <span className='text-muted-foreground font-mono text-xs'>{r.reference}</span> },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => inr(r.amount) },
  { key: 'charge', header: 'Charge', align: 'right', cell: r => (Number(r.charge) ? inr(r.charge) : '—') },
  { key: 'net', header: 'Net', align: 'right', cell: r => <span className={Number(r.net) < 0 ? 'text-destructive' : ''}>{inr(r.net)}</span> },
  { key: 'balance', header: 'Balance', align: 'right', cell: r => <strong>{inr(r.balance)}</strong> }
]

/** The balance sheet: opening, every entry by date with its running balance, closing, totals. */
const AccountTable = ({ account }: { account: Account }) => (
  <div className='grid gap-2'>
    <div className='flex flex-wrap items-baseline justify-between gap-2'>
      <span className='text-sm font-medium'>Account with the parent</span>
      <span className='text-muted-foreground text-sm'>
        Opening {inr(account.opening)} → closing <strong className='text-foreground'>{inr(account.closing)}</strong>
      </span>
    </div>
    <DataTable columns={accountColumns} rows={account.entries} rowKey={r => `${r.kind}-${r.reference}`} loading={false} emptyMessage='No balance or gateway movements this month.' />
    <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm'>
      <span>Given: {inr(account.totals.given)}</span>
      <span>Gateway deposits: {inr(account.totals.deposits)}</span>
      <span>Gateway withdrawals: {inr(account.totals.withdrawals)}</span>
      <span>Gateway charges: {inr(account.totals.charges)}</span>
    </div>
    {account.truncated && <span className='text-muted-foreground text-xs'>Only the first 5,000 entries are listed; the balances count every entry.</span>}
  </div>
)

/** The statement: products, totals, gateway and transfers. `who` names the party in the note. */
export const StatementView = ({ statement, who }: { statement: Statement; who: 'parent' | 'company' }) => (
  <div className='grid gap-4'>
    <DataTable columns={columns} rows={statement.products} rowKey={r => r.product} loading={false} emptyMessage='No products in the plan.' />
    <div className='grid gap-2 text-sm sm:grid-cols-2'>
      <div>
        <span className='text-muted-foreground'>Total GGR: </span>
        <strong>{inr(statement.totalGgr)}</strong>
      </div>
      <div>
        <span className='text-muted-foreground'>{who === 'parent' ? 'Revenue share due to you: ' : 'Revenue share due to the parent site: '}</span>
        <strong>{inr(statement.totalShare)}</strong>
      </div>
      <div>
        <span className='text-muted-foreground'>Gateway deposits / withdrawals: </span>
        {inr(statement.gateway.deposits)} ({statement.gateway.depositCount}) / {inr(statement.gateway.withdrawals)} ({statement.gateway.withdrawalCount})
      </div>
      <div>
        <span className='text-muted-foreground'>Gateway charges: </span>
        {inr(statement.gateway.charges)}
      </div>
      <div>
        <span className='text-muted-foreground'>Balance sent by the parent: </span>
        {inr(statement.transfers.amount)} ({statement.transfers.count})
      </div>
    </div>
    {statement.account && <AccountTable account={statement.account} />}
    {statement.sportsError && (
      <Alert>
        <AlertDescription>Sports figure not available: {statement.sportsError}. The totals leave it out.</AlertDescription>
      </Alert>
    )}
    {statement.unconverted.length > 0 && (
      <Alert>
        <AlertDescription>Left out, no exchange rate: {statement.unconverted.join(', ')}.</AlertDescription>
      </Alert>
    )}
    <p className='text-muted-foreground text-xs'>
      GGR = bets − wins (less refunds and rollbacks); the share is on a product&apos;s positive GGR only. Reported, not collected. Casino and original games are counted
      from the parent site&apos;s record of every round; sports from the whitelabel&apos;s own books. Amounts in INR at today&apos;s rates.
    </p>
  </div>
)
