'use client'

import { useState, type ReactNode } from 'react'

import { ChevronDownIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FeedMarket, FeedOdds, FeedSection } from './api'
import { lookupExposure, type ExposureIndex } from './exposureIndex'

/**
 * Game Details ke market blocks — zip ke `GameDetails.jsx` (Market1 … Market13).
 *
 * Block market ke `dtype` se chunta hai, markets aur runners `sno` se sorted:
 *   1        Market1Block   — sirf Back, cards ek line me
 *   2-5,11,13 TieredMarket  — Back / Lay, tno ke hisaab se 3 tak tiers
 *   6 / 7 / 8 FancyPair     — No|Yes, Back|Lay, Odd|Even + runner ka Min/Max
 *   9        NumberMarket   — sirf Back, header me pehle runner ka Min/Max
 *   10       KhadoMarket    — Back, naam me lay odds ("… - 11")
 *   12       RacingMarket   — saddlecloth (draw) + naam, removed runner
 * Suspended: market gscode != 1 → poora body dhak jata hai (market.status);
 * runner gscode != 1 → wo row (section.gstatus). Odds badalne pe cell green/red flash.
 */

export type BlockProps = {
  market: FeedMarket
  oldMarket?: FeedMarket
  exposure: ExposureIndex | null
  onBetLock: (market: FeedMarket) => void
  onUserBook: (market: FeedMarket) => void
}

// ── chhote helpers (zip jaise) ──────────────────────────────────────────

export const sortBySno = <T extends { sno?: number }>(list: T[] | undefined) =>
  [...(list ?? [])].sort((a, b) => (Number(a.sno) || 0) - (Number(b.sno) || 0))

const oddsOf = (s: FeedSection, key: string, field: 'otype' | 'oname' = 'otype') =>
  (s.odds ?? []).filter(o => String(o[field] || '').toUpperCase() === key)

const oddsDesc = (s: FeedSection, key: string, field: 'otype' | 'oname' = 'otype') =>
  oddsOf(s, key, field).sort((a, b) => (b.tno || 0) - (a.tno || 0))

const oddsAsc = (s: FeedSection, key: string) => oddsOf(s, key).sort((a, b) => (a.tno || 0) - (b.tno || 0))

const suspendedRow = (m: FeedMarket, s: FeedSection) => Number(m.gscode) === 1 && Number(s.gscode) !== 1
const suspendedFull = (m: FeedMarket) => Number(m.gscode) !== 1

/** 0 → "—", warna odds jaise hain. */
const oddsText = (v: number | undefined) => (v && Number(v) !== 0 ? v : '—')

/** < 1000 jaisa, 1000+ → "12.34K", 1 lakh+ → "1.23L" (zip v-kval). */
export function kval(v: number | string | undefined) {
  const n = Number(v)

  if (!Number.isFinite(n)) return ''
  if (n >= 100000) return `${Number.parseFloat((n / 100000).toFixed(2))}L`
  if (n >= 1000) return `${Number.parseFloat((n / 1000).toFixed(2))}K`

  return String(Number.parseFloat(String(n)))
}

/** Book: integer, minus ke saath. */
const bookText = (v: number | null) => (!v ? '0' : String(Math.round(v)))
const bookColor = (v: number | null) => (!v ? 'text-muted-foreground' : v < 0 ? 'text-destructive' : 'text-success')

/** Pichhle poll se odds badla? upar = green, neeche = red. */
function flash(old: FeedSection | undefined, otype: string, tno: number, odds: number) {
  if (!old) return ''
  const prev = (old.odds ?? []).find(o => String(o.otype || '').toUpperCase() === otype && Number(o.tno || 0) === Number(tno || 0))?.odds ?? odds

  if (prev < odds) return 'ring-2 ring-inset ring-success'
  if (prev > odds) return 'ring-2 ring-inset ring-destructive'

  return ''
}

/** Pichhle poll ka wahi runner — sid se, warna usi position pe. */
const oldSectionOf = (old: FeedMarket | undefined, s: FeedSection, i: number) => {
  const list = sortBySno(old?.section)

  return list.find(x => String(x.sid) === String(s.sid)) ?? list[i]
}

// back tno 0 sabse gehra (beech wala), lay bhi
const SHADES = {
  back: ['bg-sky-300', 'bg-sky-200', 'bg-sky-100'],
  lay: ['bg-pink-300', 'bg-pink-200', 'bg-pink-100']
}

const CELL = 'w-14 shrink-0 sm:w-16'

/** Ek odds box. */
function OddsBox({ o, side, old, showSize = true, suspended }: { o: Partial<FeedOdds>; side: 'back' | 'lay'; old?: FeedSection; showSize?: boolean; suspended?: boolean }) {
  const otype = side.toUpperCase()

  return (
    <div
      className={cn(
        CELL,
        'flex flex-col items-center justify-center border-l border-white/60 py-1 text-slate-900',
        SHADES[side][Math.min(Number(o.tno) || 0, 2)],
        !o.odds && 'opacity-60',
        suspended && 'opacity-40',
        flash(old, otype, Number(o.tno) || 0, Number(o.odds) || 0)
      )}
    >
      <span className='text-sm font-semibold'>{oddsText(o.odds)}</span>
      {showSize && o.size ? <span className='text-[11px]'>{kval(o.size)}</span> : null}
    </div>
  )
}

/** Runner ki line jab wo suspended ho — upar text overlay. */
function RowShell({ suspendedText, children, className }: { suspendedText?: string | false; children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative flex min-h-11 items-stretch border-t', className)}>
      {children}
      {suspendedText ? (
        <div className='bg-background/70 text-destructive absolute inset-y-0 right-0 left-1/3 flex items-center justify-center text-xs font-bold uppercase'>
          {suspendedText}
        </div>
      ) : null}
    </div>
  )
}

/** Market ka dabba: header (toggle + naam + right side buttons) aur body. */
function MarketShell({ market, right, children }: { market: FeedMarket; right?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const full = suspendedFull(market)

  return (
    <div className='mb-3 overflow-hidden rounded-md border'>
      <div className='bg-muted flex items-center justify-between gap-2 px-3 py-1.5'>
        <button type='button' onClick={() => setOpen(v => !v)} className='flex min-w-0 items-center gap-1 text-left font-semibold'>
          <ChevronDownIcon className={cn('size-4 shrink-0 transition-transform', !open && '-rotate-90')} />
          <span className='truncate'>{market.mname}</span>
        </button>
        <div className='flex shrink-0 items-center gap-1.5'>{right}</div>
      </div>
      {open && (
        <div className='relative'>
          {children}
          {full ? (
            <div className='bg-background/75 text-destructive absolute inset-0 flex items-center justify-center text-sm font-bold uppercase'>
              {market.status || 'SUSPENDED'}
            </div>
          ) : null}
        </div>
      )}
      {market.rem ? <div className='text-muted-foreground border-t px-3 py-1 text-xs'>{market.rem}</div> : null}
    </div>
  )
}

/** Bet Lock (+ match / match1 pe User Book) buttons. */
function MarketButtons({ market, onBetLock, onUserBook, userBook = true }: Pick<BlockProps, 'market' | 'onBetLock' | 'onUserBook'> & { userBook?: boolean }) {
  return (
    <>
      <Button size='xs' variant='outline' onClick={() => onBetLock(market)}>
        Bet Lock
      </Button>
      {userBook && (market.gtype === 'match' || market.gtype === 'match1') && (
        <Button size='xs' variant='outline' onClick={() => onUserBook(market)}>
          User Book
        </Button>
      )}
    </>
  )
}

/**
 * 2 runner wale market pe book ke saath "%" badge — zip `v-sportbook`:
 * apna book / dusre ka book, positive, 2 decimal. Sab 0 ho to badge nahi.
 */
function BookFigure({ own, other, badge }: { own: number | null; other: number | null; badge: boolean }) {
  const ratio = Math.abs(Number((Number(own) / Number(other)).toFixed(2)))

  return (
    <span className={cn('tabular-nums', bookColor(own))}>
      {bookText(own)}
      {badge ? <span className='bg-foreground text-background ml-1 rounded px-1 text-[10px]'>{Number.isNaN(ratio) ? 0 : ratio}%</span> : null}
    </span>
  )
}

/** Right side point book — 0 pe chhupa (zip v-sportpointbook). */
const PointFigure = ({ v }: { v: number | null }) => (v ? <span className={cn('tabular-nums', bookColor(v))}>{bookText(v)}</span> : null)

const hasBadge = (books: (number | null)[]) => books.length === 2 && books.some(b => Number(b) !== 0)

/** Header ka max bet text (match1 → Min/Max, match → value, baaki "Max:"). */
function limitsText(market: FeedMarket, maxVal: number | undefined) {
  if (market.gtype === 'match1') return `Min: ${kval(market.min)}  Max: ${kval(market.max)}`
  if (market.gtype === 'match') return kval(maxVal)

  return `Max: ${kval(maxVal)}`
}

// ══════════════════════════════════════════════════════════════════════
//  Tiered (2, 3, 4, 5, 11, 13) + Racing (12)
// ══════════════════════════════════════════════════════════════════════

type TierConfig = { showButtons?: boolean; maxSource?: 'iplay' | 'maxb'; sizeNeedsOdds?: boolean; racing?: boolean }

function TieredMarket({ market, oldMarket, exposure, onBetLock, onUserBook, showButtons = true, maxSource = 'iplay', sizeNeedsOdds = false, racing = false }: BlockProps & TierConfig) {
  const sections = sortBySno(market.section)
  const books = sections.map(s => lookupExposure(exposure, [market.mname, market.gtype], s.nat))
  const badge = hasBadge(books)
  const maxVal = maxSource === 'maxb' ? market.maxb : market.iplay ? market.maxb : market.umaxbof
  const backCount = Math.max(1, ...sections.map(s => oddsOf(s, 'BACK').length))
  const layCount = Math.max(1, ...sections.map(s => oddsOf(s, 'LAY').length))

  return (
    <MarketShell market={market} right={showButtons ? <MarketButtons market={market} onBetLock={onBetLock} onUserBook={onUserBook} /> : null}>
      <div className='flex items-end border-t text-xs font-semibold'>
        <div className='text-muted-foreground min-w-0 flex-1 px-3 py-1 text-right'>{limitsText(market, maxVal)}</div>
        <div className='flex justify-end'>
          <div className={cn('py-1 text-center')} style={{ width: `${backCount * 4}rem` }}>
            Back
          </div>
          <div className='py-1 text-center' style={{ width: `${layCount * 4}rem` }}>
            Lay
          </div>
        </div>
      </div>

      {sections.map((s, i) => {
        const old = oldSectionOf(oldMarket, s, i)
        const removed = racing && String(s.gstatus || '').toLowerCase() === 'removed'
        const rowSuspended = racing ? Number(s.gscode) !== 1 : suspendedRow(market, s)
        const label = removed ? `${s.gstatus}  -  ${s.adfa}%,  ${s.rdt} (IST)` : s.gstatus
        const size = (o: FeedOdds) => (sizeNeedsOdds ? Boolean(o.size && o.odds) : true)

        return (
          <RowShell key={s.sid ?? i} suspendedText={rowSuspended && (label || 'SUSPENDED')} className={removed ? 'line-through opacity-60' : undefined}>
            <div className='min-w-0 flex-1 px-3 py-1.5'>
              <p className='truncate font-medium'>
                {racing ? (
                  <span className='text-muted-foreground mr-1'>
                    {s.cno} ({s.sdraw})
                  </span>
                ) : null}
                {s.nat}
              </p>
              <div className='flex justify-between text-xs'>
                <BookFigure own={books[i]} other={books[1 - i] ?? null} badge={badge} />
                {racing ? null : <PointFigure v={books[i]} />}
              </div>
            </div>
            {oddsDesc(s, 'BACK').map((o, ti) => (
              <OddsBox key={`b${ti}`} o={o} side='back' old={old} showSize={size(o)} />
            ))}
            {oddsAsc(s, 'LAY').map((o, ti) => (
              <OddsBox key={`l${ti}`} o={o} side='lay' old={old} showSize={size(o)} />
            ))}
          </RowShell>
        )
      })}
    </MarketShell>
  )
}

// ══════════════════════════════════════════════════════════════════════
//  dtype 1 — sirf Back, cards
// ══════════════════════════════════════════════════════════════════════

function Market1Block({ market, oldMarket, exposure, onBetLock, onUserBook }: BlockProps) {
  const sections = sortBySno(market.section)
  const books = sections.map(s => lookupExposure(exposure, [market.mname, market.gtype], s.nat))
  const badge = hasBadge(books)
  const maxVal = market.iplay ? market.maxb : market.umaxbof

  return (
    <MarketShell
      market={market}
      right={
        <>
          <span className='text-muted-foreground text-xs'>{market.gtype === 'match' ? kval(maxVal) : `Max: ${kval(maxVal)}`}</span>
          <MarketButtons market={market} onBetLock={onBetLock} onUserBook={onUserBook} />
        </>
      }
    >
      <div className='grid gap-2 border-t p-2 sm:grid-cols-2 lg:grid-cols-3'>
        {sections.map((s, i) => (
          <div key={s.sid ?? i} className='flex items-center justify-between gap-2 rounded border p-1.5'>
            <div className='min-w-0 text-sm'>
              <span className='font-medium'>{s.nat}</span>{' '}
              <BookFigure own={books[i]} other={books[1 - i] ?? null} badge={badge} /> <PointFigure v={books[i]} />
            </div>
            <div className='flex'>
              {oddsDesc(s, 'BACK').map((o, ti) => (
                <OddsBox key={ti} o={o} side='back' old={oldSectionOf(oldMarket, s, i)} showSize={false} suspended={suspendedRow(market, s)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </MarketShell>
  )
}

// ══════════════════════════════════════════════════════════════════════
//  dtype 6 / 7 / 8 — fancy pair
// ══════════════════════════════════════════════════════════════════════

type PairConfig = { titles: [string, string]; columns: { oname: string; side: 'back' | 'lay' }[] }

const PAIR_NO_YES: PairConfig = { titles: ['No', 'Yes'], columns: [{ oname: 'LAY1', side: 'lay' }, { oname: 'BACK1', side: 'back' }] }
const PAIR_BACK_LAY: PairConfig = { titles: ['Back', 'Lay'], columns: [{ oname: 'BACK1', side: 'back' }, { oname: 'LAY1', side: 'lay' }] }

// dtype 8 ke dono box blue (zip me bhi dono `back`)
const PAIR_ODD_EVEN: PairConfig = { titles: ['Odd', 'Even'], columns: [{ oname: 'BACK1', side: 'back' }, { oname: 'LAY1', side: 'back' }] }

/** Fancy runner ka Min/Max — right side chhota text. */
const MinMax = ({ s }: { s: FeedSection }) => (
  <div className='text-muted-foreground hidden w-28 shrink-0 flex-col justify-center px-2 text-[11px] sm:flex'>
    <span>Min: {kval(s.min)}</span>
    <span>Max: {kval(s.max)}</span>
  </div>
)

function FancyPairMarket({ market, oldMarket, exposure, onBetLock, onUserBook, titles, columns }: BlockProps & PairConfig) {
  const sections = sortBySno(market.section)

  return (
    <MarketShell market={market} right={<MarketButtons market={market} onBetLock={onBetLock} onUserBook={onUserBook} userBook={false} />}>
      <div className='flex border-t text-xs font-semibold'>
        <div className='flex-1' />
        {titles.map(t => (
          <div key={t} className={cn(CELL, 'py-1 text-center')}>
            {t}
          </div>
        ))}
        <div className='hidden w-28 sm:block' />
      </div>
      {sections.map((s, i) => {
        // fancy bets ka game_type gtype ("Normal") hai, mname nahi
        const book = lookupExposure(exposure, [market.gtype, market.mname], s.nat)
        const old = oldSectionOf(oldMarket, s, i)

        return (
          <div key={s.sid ?? i}>
            <RowShell suspendedText={suspendedRow(market, s) && (s.gstatus || 'SUSPENDED')}>
              <div className='min-w-0 flex-1 px-3 py-1.5'>
                <p className='font-medium'>{s.nat}</p>
                <p className={cn('text-xs tabular-nums', bookColor(book))}>{bookText(book)}</p>
              </div>
              {columns.map(col => (
                <OddsBox key={col.oname} o={oddsDesc(s, col.oname, 'oname')[0] ?? {}} side={col.side} old={old} />
              ))}
              <MinMax s={s} />
            </RowShell>
            {s.rem ? <div className='text-muted-foreground px-3 pb-1 text-xs'>{s.rem}</div> : null}
          </div>
        )
      })}
    </MarketShell>
  )
}

// ══════════════════════════════════════════════════════════════════════
//  dtype 9 (number) aur 10 (khado) — sirf Back
// ══════════════════════════════════════════════════════════════════════

function SingleBackMarket({ market, oldMarket, exposure, onBetLock, onUserBook, khado }: BlockProps & { khado?: boolean }) {
  const sections = sortBySno(market.section)
  const books = sections.map(s => lookupExposure(exposure, [market.gtype, market.mname], s.nat))
  const first = sections[0]

  return (
    <MarketShell market={market} right={<MarketButtons market={market} onBetLock={onBetLock} onUserBook={onUserBook} userBook={false} />}>
      <div className='flex border-t text-xs font-semibold'>
        <div className='text-muted-foreground flex-1 px-3 py-1 text-right'>{!khado && first ? `Min: ${kval(first.min)}  Max: ${kval(first.max)}` : ''}</div>
        <div className={cn(CELL, 'py-1 text-center')}>Back</div>
        {khado ? <div className='hidden w-28 sm:block' /> : null}
      </div>
      {sections.map((s, i) => {
        const lay = oddsOf(s, 'LAY')[0]
        const label = khado && lay ? `${s.nat} - ${lay.odds}` : s.nat
        const old = oldSectionOf(oldMarket, s, i)

        return (
          <div key={s.sid ?? i}>
            <RowShell>
              <div className='min-w-0 flex-1 px-3 py-1.5'>
                <p className='font-medium'>{label}</p>
                <p className={cn('text-xs tabular-nums', bookColor(books[i]))}>{bookText(books[i])}</p>
              </div>
              {oddsDesc(s, 'BACK').map((o, ti) => (
                <OddsBox key={ti} o={o} side='back' old={old} suspended={khado && suspendedRow(market, s)} />
              ))}
              {khado ? <MinMax s={s} /> : null}
            </RowShell>
            {s.rem ? <div className='text-muted-foreground px-3 pb-1 text-xs'>{s.rem}</div> : null}
          </div>
        )
      })}
    </MarketShell>
  )
}

// ══════════════════════════════════════════════════════════════════════

/** dtype → block. dtype na ho to gtype se: match/match1/bookmaker tiered, baaki fancy. */
export function MarketBlock(props: BlockProps) {
  switch (Number(props.market.dtype)) {
    case 1:
      return <Market1Block {...props} />
    case 2:
    case 3:
    case 4:
    case 11:
      return <TieredMarket {...props} />
    case 5:
      return <TieredMarket {...props} maxSource='maxb' />
    case 13:
      return <TieredMarket {...props} showButtons={false} sizeNeedsOdds />
    case 12:
      return <TieredMarket {...props} racing />
    case 6:
      return <FancyPairMarket {...props} {...PAIR_NO_YES} />
    case 7:
      return <FancyPairMarket {...props} {...PAIR_BACK_LAY} />
    case 8:
      return <FancyPairMarket {...props} {...PAIR_ODD_EVEN} />
    case 9:
      return <SingleBackMarket {...props} />
    case 10:
      return <SingleBackMarket {...props} khado />
    default:
      return props.market.gtype === 'match' || props.market.gtype === 'match1' || /bookmaker/i.test(props.market.mname || '') ? (
        <TieredMarket {...props} />
      ) : (
        <FancyPairMarket {...props} {...PAIR_NO_YES} />
      )
  }
}
