'use client'

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { currency, fmtDateTime, isLay, rateOf, type Bet } from './api'

type Props = {
  open: boolean
  bets: Bet[]
  onClose: () => void
  onReload: () => void
}

type Status = 'matched' | 'unmatched' | 'deleted'
type Search = { username: string; amountFrom: string; amountTo: string; ip: string }

const EMPTY_SEARCH: Search = { username: '', amountFrom: '', amountTo: '', ip: '' }
const statusOf = (b: Bet): Status => (b.deleted ? 'deleted' : b.unmatched ? 'unmatched' : 'matched')
const marketOf = (b: Bet) => b.marketType || b.gameType || ''

const PILLS: [Status, string][] = [
  ['matched', 'Matched Bets'],
  ['unmatched', 'Unmatched Bets'],
  ['deleted', 'Deleted Bets']
]

/**
 * View More — zip ka `components/ViewMoreBetsModal.jsx`.
 *
 * Upar market tabs (MATCH_ODDS, Normal …), phir Matched / Unmatched / Deleted. Search form
 * (username, amount, IP) sirf Search dabane pe lagta hai; radio (All/Back/Lay/Deleted) turant.
 * Tab me koi bet hi na ho to sirf "No records found" (Matched pe) — form bhi nahi.
 */
const ViewMoreBetsDialog = ({ open, bets, onClose, onReload }: Props) => {
  const [pickedMarket, setPickedMarket] = useState<string | null>(null)
  const [tab, setTab] = useState<Status>('matched')
  const [search, setSearch] = useState<Search>(EMPTY_SEARCH)
  const [applied, setApplied] = useState<Search>(EMPTY_SEARCH)
  const [radio, setRadio] = useState('')

  const markets = useMemo(() => [...new Set(bets.map(marketOf).filter(Boolean))], [bets])
  const market = pickedMarket && markets.includes(pickedMarket) ? pickedMarket : markets[0]

  // tab ki apni bets (search se pehle) — form dikhana hai ya nahi
  const tabBets = useMemo(() => bets.filter(b => marketOf(b) === market && statusOf(b) === tab), [bets, market, tab])

  const rows = useMemo(
    () =>
      tabBets.filter(b => {
        const amount = Number.parseFloat(b.stake) || 0

        if (applied.username && !b.username.toLowerCase().includes(applied.username.toLowerCase())) return false
        if (applied.amountFrom && amount < Number.parseFloat(applied.amountFrom)) return false
        if (applied.amountTo && amount > Number.parseFloat(applied.amountTo)) return false
        if (applied.ip && !b.ip.includes(applied.ip)) return false
        if (radio === 'back' && isLay(b)) return false
        if (radio === 'lay' && !isLay(b)) return false
        if (radio === 'deleted' && !b.deleted) return false

        return true
      }),
    [tabBets, applied, radio]
  )

  const totalAmount = rows.reduce((sum, b) => sum + (Number.parseFloat(b.stake) || 0), 0)

  const resetAll = (nextRadio: string) => {
    setSearch(EMPTY_SEARCH)
    setApplied(EMPTY_SEARCH)
    setRadio(nextRadio)
  }

  const close = () => {
    setTab('matched')
    resetAll('')
    onClose()
  }

  // market tab: wapas Matched, search khali, radio All, phir reload (zip jaisa)
  const pickMarket = (m: string) => {
    setPickedMarket(m)
    setTab('matched')
    resetAll('all')
    onReload()
  }

  const field = (key: keyof Search, label: string, placeholder: string) => (
    <div className='flex flex-col gap-1'>
      <Label htmlFor={`vm-${key}`}>{label}</Label>
      <Input id={`vm-${key}`} placeholder={placeholder} value={search[key]} onChange={e => setSearch(s => ({ ...s, [key]: e.target.value }))} />
    </div>
  )

  const pane =
    tabBets.length === 0 ? (
      tab === 'matched' ? <p className='py-4 text-center'>No records found</p> : null
    ) : (
      <div className='flex flex-col gap-3'>
        <form
          className='grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-5'
          onSubmit={e => {
            e.preventDefault()
            setApplied(search)
          }}
        >
          {field('username', 'Username', 'Search Username')}
          {field('amountFrom', 'Amount From', 'Amount From')}
          {field('amountTo', 'Amount To', 'Amount To')}
          {field('ip', 'IP Address', 'IP Address')}
          <div className='flex gap-2'>
            <Button type='submit'>Search</Button>
            <Button type='button' variant='outline' onClick={() => resetAll('all')}>
              Reset
            </Button>
          </div>
        </form>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <RadioGroup value={radio} onValueChange={v => setRadio(String(v))} className='flex flex-wrap gap-4'>
            {[
              ['all', 'All'],
              ['back', 'Back'],
              ['lay', 'Lay'],
              ['deleted', 'Deleted']
            ].map(([v, label]) => (
              <Label key={v} className='flex items-center gap-1.5 font-normal'>
                <RadioGroupItem value={v} /> {label}
              </Label>
            ))}
          </RadioGroup>
          <h5 className='font-semibold'>
            Total Bets: <span className='text-success mr-2'>{rows.length}</span> Total Amount:{' '}
            <span className={totalAmount < 0 ? 'text-destructive' : 'text-success'}>{currency(totalAmount)}</span>
          </h5>
        </div>
        {rows.length === 0 ? (
          <p className='text-center'>No records found</p>
        ) : (
          <div className='overflow-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='bg-muted'>
                  {['Username', 'Nation', 'Rate', 'Amount', 'Date', 'IP', 'B Details', 'Action'].map(h => (
                    <th key={h} className={cn('px-3 py-2 text-left', ['Rate', 'Amount', 'Action'].includes(h) && 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(b => (
                  <tr key={b.id} className={cn('border-t border-l-4', isLay(b) ? 'border-l-pink-400' : 'border-l-sky-400')}>
                    <td className='px-3 py-1.5'>{b.username}</td>
                    <td className='px-3 py-1.5'>{b.selection || '-'}</td>
                    <td className='px-3 py-1.5 text-right tabular-nums'>{rateOf(b)}</td>
                    <td className='px-3 py-1.5 text-right tabular-nums'>{currency(b.stake)}</td>
                    <td className='px-3 py-1.5 whitespace-nowrap'>{fmtDateTime(b.createdAt)}</td>
                    <td className='text-primary px-3 py-1.5'>{b.ip || '-'}</td>
                    <td className='px-3 py-1.5'>
                      <span className='text-success cursor-help' title={b.browser}>
                        Detail
                      </span>
                    </td>
                    <td className='px-3 py-1.5 text-right'>
                      <Checkbox aria-label='Select bet' />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )

  return (
    <Dialog open={open} onOpenChange={o => !o && close()}>
      <DialogContent className='sm:max-w-6xl'>
        <DialogHeader>
          <DialogTitle>View More</DialogTitle>
        </DialogHeader>
        <div className='flex flex-wrap gap-1 border-b'>
          {markets.map(m => (
            <button
              key={m}
              type='button'
              onClick={() => pickMarket(m)}
              className={cn('-mb-px border-b-2 px-3 py-1.5 text-sm uppercase', m === market ? 'border-primary text-primary font-semibold' : 'border-transparent')}
            >
              {bets.find(b => marketOf(b) === m)?.marketLabel || m}
            </button>
          ))}
        </div>
        <div className='flex flex-wrap gap-1'>
          {PILLS.map(([v, label]) => (
            <Button
              key={v}
              size='sm'
              variant={tab === v ? 'default' : 'ghost'}
              onClick={() => {
                setTab(v)
                onReload()
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className='max-h-[60vh] overflow-auto'>{pane}</div>
      </DialogContent>
    </Dialog>
  )
}

export default ViewMoreBetsDialog
