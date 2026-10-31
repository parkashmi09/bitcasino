'use client'

import { useState } from 'react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { fmt, formatDisplay } from './reportKit'

export type DetailBet = {
  id: string
  username: string
  nation: string
  rate: number | null
  bhav: number | string | null
  amount: number | null
  win: number | null
  date: string
  ip: string
  browser: string
  side: 'BACK' | 'LAY' | null
  deleted: boolean
  badlo: boolean
}

export type BetDetail = {
  breadcrumb: string
  winner: string | null
  gameTime: string | null
  totalBets: number
  totalWin: number
  bets: DetailBet[]
}

const FILTERS: [string, string][] = [['all', 'All'], ['back', 'Back'], ['lay', 'Lay'], ['deleted', 'Deleted']]

const isLay = (b: DetailBet) => b.side === 'LAY'

/** Win / Amount — khaali par kuch nahi. */
const amount = (v: number | string | null | undefined) => (v == null || v === '' ? '' : fmt(v))

/**
 * Account Statement ki game row ka "Details" modal — zip `StatementBetDetailModal` + `RoundBetsTable`.
 * Breadcrumb, Winner / Game Time, All-Back-Lay-Deleted radios, Total Bets / Total Win,
 * phir bets (Username / Nation / Rate / Bhav / Amount / Win / Date / IP / B Details / Action).
 * Rows tick karne par totals sirf unke; koi tick nahi = saari dikhti rows.
 */
const StatementBetDetail = ({ detail, onClose }: { detail: BetDetail | null; onClose: () => void }) => {
  const [filter, setFilter] = useState('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [openBrowser, setOpenBrowser] = useState<string | null>(null)

  const bets = detail?.bets ?? []

  // Deleted bets sirf apne tab me — All/Back/Lay me nahi.
  const visible = bets.filter(b => {
    if (filter === 'deleted') return b.deleted
    if (b.deleted) return false
    if (filter === 'all') return true

    return filter === 'lay' ? isLay(b) : !isLay(b)
  })

  const counted = picked.size ? visible.filter(b => picked.has(b.id)) : visible
  const totalWin = Math.round(counted.reduce((sum, b) => sum + (Number(b.win) || 0), 0) * 100) / 100

  const changeFilter = (value: string) => {
    setFilter(value)
    setPicked(new Set())
    setOpenBrowser(null)
  }

  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev)

      if (next.has(id)) next.delete(id)
      else next.add(id)

      return next
    })

  return (
    <Dialog open={detail !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className='sm:max-w-6xl'>
        <DialogHeader>
          <DialogTitle>Details</DialogTitle>
        </DialogHeader>

        <div className='space-y-1 text-sm'>
          <div>{detail?.breadcrumb}</div>
          <div className='flex justify-between gap-4'>
            <div>Winner: {detail?.winner ?? ''}</div>
            <div className='text-right'>
              <div>Game Time:</div>
              <div>{formatDisplay(detail?.gameTime)}</div>
            </div>
          </div>
        </div>

        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex flex-wrap gap-4 text-sm'>
            {FILTERS.map(([value, label]) => (
              <label key={value} className='flex cursor-pointer items-center gap-1.5'>
                <input type='radio' name='stmt-bet-filter' checked={filter === value} onChange={() => changeFilter(value)} />
                {label}
              </label>
            ))}
          </div>
          <h5 className='ml-auto font-semibold'>
            Total Bets: <span className='text-success mr-2'>{counted.length}</span> Total Win:{' '}
            <span className={totalWin < 0 ? 'text-danger' : 'text-success'}>{fmt(totalWin)}</span>
          </h5>
        </div>

        <div className='max-h-[55vh] overflow-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Nation</TableHead>
                <TableHead className='text-right'>Rate</TableHead>
                <TableHead className='text-right'>Rate</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
                <TableHead className='text-right'>Win</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>B Details</TableHead>
                <TableHead className='text-right'>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className='text-center'>
                    No records found
                  </TableCell>
                </TableRow>
              ) : (
                visible.flatMap(b => {
                  const win = Number(b.win)

                  // Back = neeli patti, Lay = gulabi (zip back-border / lay-border); badlo par koi patti nahi.
                  const strip = b.badlo ? '' : isLay(b) ? 'border-l-4 border-l-pink-400' : 'border-l-4 border-l-sky-400'

                  const row = (
                    <TableRow key={b.id} className={strip}>
                      <TableCell>{b.username}</TableCell>
                      <TableCell>{b.nation}</TableCell>
                      <TableCell className='text-right tabular-nums'>{amount(b.rate)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{b.bhav == null || b.bhav === '' ? '-' : amount(b.bhav)}</TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {b.badlo && isLay(b) ? amount(-Math.abs(Number(b.amount) || 0)) : amount(b.amount)}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', b.win != null && (win < 0 ? 'text-danger' : 'text-success'))}>
                        {b.win == null ? '' : amount(win)}
                      </TableCell>
                      <TableCell className='whitespace-nowrap'>{formatDisplay(b.date)}</TableCell>
                      <TableCell>{b.ip}</TableCell>
                      <TableCell>
                        <button type='button' className='text-success' title={b.browser} onClick={() => setOpenBrowser(cur => (cur === b.id ? null : b.id))}>
                          Detail
                        </button>
                      </TableCell>
                      <TableCell className='text-right'>
                        <Checkbox checked={picked.has(b.id)} onCheckedChange={() => toggle(b.id)} aria-label='Select bet' />
                      </TableCell>
                    </TableRow>
                  )

                  return openBrowser === b.id
                    ? [
                        row,
                        <TableRow key={`${b.id}-browser`}>
                          <TableCell colSpan={10} className='text-muted-foreground'>
                            {b.browser || 'No browser details'}
                          </TableCell>
                        </TableRow>
                      ]
                    : [row]
                })
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default StatementBetDetail
