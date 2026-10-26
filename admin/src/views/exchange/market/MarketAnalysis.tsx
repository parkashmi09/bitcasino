'use client'

import { useEffect, useMemo, useState } from 'react'

import Link from 'next/link'

import { RefreshCwIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'
import { MARKET_API, commas, fmtDateTime, type AnalysisResponse, type BookEvent, type BookMarket } from './api'

// Racing ka title "Naas - Oct 11 2026 8:10PM" — zip sirf venue dikhata hai
const RACE_TIME_SUFFIX = / - [A-Z][a-z]{2} \d{1,2} \d{4} \d{1,2}:\d{2}\s?[AP]M$/
const displayTitle = (t: string) => String(t || '').replace(RACE_TIME_SUFFIX, '')

/** Game Details ka link — sport id bets se aata hai, na ho to link nahi. */
export const eventHref = (event: Pick<BookEvent, 'sportId' | 'eventId'>) =>
  event.sportId && event.eventId ? `/exchange/events/${event.sportId}/${event.eventId}` : null

/** Ek market ka card: upar naam, neeche runner | value. */
const MarketCard = ({ market }: { market: BookMarket }) => (
  <div className='overflow-hidden rounded-md border'>
    <table className='w-full text-sm'>
      <thead>
        <tr className='bg-muted'>
          <th colSpan={2} className='px-3 py-2 text-left font-semibold'>
            {market.label || market.name}
          </th>
        </tr>
      </thead>
      <tbody>
        {market.rows.map(row => (
          <tr key={row.label} className='border-t'>
            <td className='px-3 py-1.5'>{row.label}</td>
            <td className='px-3 py-1.5 text-right tabular-nums'>{commas(row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

/** Ek event ka block — title (Game Details link) + date, phir market cards. */
export const EventBlock = ({ event }: { event: BookEvent }) => {
  const href = eventHref(event)
  const title = displayTitle(event.title)

  return (
    <Card size='sm' className='gap-3 p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {href ? (
          <Link href={href} className='text-primary font-semibold hover:underline'>
            {title}
          </Link>
        ) : (
          <span className='font-semibold'>{title}</span>
        )}
        <span className='text-muted-foreground text-sm tabular-nums'>{fmtDateTime(event.eventDate)}</span>
      </div>
      <div className='grid gap-3 md:grid-cols-2 lg:grid-cols-3'>
        {event.markets.map(market => (
          <MarketCard key={market.name} market={market} />
        ))}
      </div>
    </Card>
  )
}

// start time ke hisaab se, naya pehle; bina date wale aakhir me (zip jaisa)
const byStart = (a: BookEvent, b: BookEvent) => String(b.eventDate || '').localeCompare(String(a.eventDate || ''))

/**
 * Market Analysis — zip ka `pages/MarketAnalysis.jsx`.
 * Downline ka open book event wise. Refresh icon + "Search Event" (title pe filter).
 */
const MarketAnalysis = () => {
  const [search, setSearch] = useState('')
  const [spinning, setSpinning] = useState(false)
  const { data, error, refetch, isFetching, isPending } = useApi<AnalysisResponse>(`${MARKET_API}/analysis`)

  // zip: refresh pe icon kam se kam ek poora chakkar (2s) ghoomta hai
  useEffect(() => {
    if (!spinning) return
    const t = setTimeout(() => setSpinning(false), 2000)

    return () => clearTimeout(t)
  }, [spinning])

  const refresh = () => {
    setSpinning(true)
    void refetch()
  }

  const events = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = [...(data?.events ?? [])].sort(byStart)

    return term ? list.filter(e => e.title.toLowerCase().includes(term)) : list
  }, [data, search])

  return (
    <div>
      <div className='mb-6 flex flex-wrap items-center justify-between gap-3'>
        <h1 className='text-foreground flex items-center gap-2 text-xl font-semibold tracking-tight'>
          Market Analysis
          <button type='button' title='Refresh Data' onClick={refresh} className='text-muted-foreground hover:text-foreground'>
            <RefreshCwIcon className={cn('size-4', (spinning || isFetching) && 'animate-spin')} />
          </button>
        </h1>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search Event' className='w-full sm:w-64' />
      </div>

      {error ? (
        <ErrorState error={error} />
      ) : (
        <div className='flex flex-col gap-4'>
          {events.map(event => (
            <EventBlock key={event.eventId} event={event} />
          ))}
          {!isPending && events.length === 0 && (
            <Card size='sm' className='text-muted-foreground p-6 text-center text-sm'>
              {search.trim() ? 'No event matches your search.' : 'No open bets in your downline right now.'}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

export default MarketAnalysis
