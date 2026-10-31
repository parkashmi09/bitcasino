'use client'

import { Fragment, useMemo, useState } from 'react'

import { ChevronDownIcon, ChevronRightIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { check } from '@/lib/validate'
import { CONFIG_API, Note, ToneBadge, errorText, useZip, zipApi } from './shared'

/**
 * Bet Limits — zip `pages/settings/BetLimits.jsx` (sirf owner).
 *
 * Feed ke har live / upcoming event ki list; ek kholo to uske markets, feed ki min / max
 * ("default") ke saath override boxes. Box khaali chhodo to us side feed ki value chalti hai.
 * Jo save ho wo player ke bet slip me dikhta hai aur bet lagte waqt API bhi check karti hai.
 * Zip ka Casino tab yahan nahi hai (casino is section me nahi aata).
 */

type BetEvent = {
  event_id: string
  sport_id: number
  sport_name: string
  event_name?: string
  competition?: string
  inplay?: boolean
  has_overrides?: boolean
}

type EventMarket = {
  market_id: string
  market_name?: string
  gtype?: string
  category?: string
  feed_min?: number
  feed_max?: number
  override_id: number | null
  min_stake: number | null
  max_stake: number | null
}

type Draft = { min?: string; max?: string }

const LIMITS_API = `${CONFIG_API}/betting-config/bet-limits`

// '' / null khaali box (= override nahi).
const boxValue = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))

/** Ek horizontal strip — sport tabs, "All sports" sabse pehle. */
const TabStrip = ({
  tabs,
  active,
  onSelect,
  allLabel,
  allCount
}: {
  tabs: { id: string; name: string; count: number }[]
  active: string
  onSelect: (id: string) => void
  allLabel: string
  allCount: number
}) => {
  const tab = (id: string, label: string, count: number) => (
    <button
      key={id || 'all'}
      type='button'
      onClick={() => onSelect(id)}
      className={cn('rounded-md px-2 py-1 text-sm whitespace-nowrap', active === id ? 'bg-accent text-foreground shadow-sm ring-1 ring-border' : 'hover:bg-muted')}
    >
      {label}
      <span className='bg-background/80 text-foreground ml-1 rounded px-1.5 text-xs'>{count}</span>
    </button>
  )

  return (
    <div className='flex gap-1 overflow-x-auto'>
      {tab('', allLabel, allCount)}
      {tabs.map(t => tab(t.id, t.name, t.count))}
    </div>
  )
}

const BetLimits = () => {
  // '' = sab sports. Ye already load hui list ko hi filter karta hai, naya request nahi.
  const [sportTab, setSportTab] = useState('')
  const [search, setSearch] = useState('')

  // Sab sports ek call me — sport tabs isi se bante hain.
  const eventsQuery = useZip<{ events?: BetEvent[] }>(`${LIMITS_API}/inplay`)
  const events = useMemo(() => eventsQuery.data?.events || [], [eventsQuery.data])
  const [openEvent, setOpenEvent] = useState<BetEvent | null>(null)


  // Khule event ke markets, feed ki min / max ke saath.
  const marketsQuery = useZip<{ markets?: EventMarket[] }>(
    openEvent ? `${LIMITS_API}/event/${openEvent.event_id}` : null,
    openEvent ? { sport_id: openEvent.sport_id } : undefined
  )

  const markets = marketsQuery.data?.markets || []

  // Draft edits "<market_id>" → { min, max }.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const loadEvents = () => {
    setOpenEvent(null)
    void eventsQuery.refetch()
  }

  const openMarkets = (event: BetEvent) => {
    setDrafts({})
    setOpenEvent(openEvent?.event_id === event.event_id ? null : event)
  }

  const clearDraft = (key: string) =>
    setDrafts(prev => {
      const next = { ...prev }

      delete next[key]

      return next
    })

  /** Same rules as the server (`parseLimit`): empty = feed default, else ≥ 0, and Min below Max. */
  const limitError = (market: EventMarket) => {
    const draft = drafts[market.market_id] || {}
    const min = draft.min !== undefined ? draft.min : boxValue(market.min_stake)
    const max = draft.max !== undefined ? draft.max : boxValue(market.max_stake)

    const bad = check.number(min, 'Min', { min: 0, decimals: 2, optional: true }) || check.number(max, 'Max', { min: 0, decimals: 2, optional: true })

    if (bad) return bad
    if (Number(min) > 0 && Number(max) > 0 && Number(min) >= Number(max)) return 'Min must be lower than Max'

    return undefined
  }

  const saveMarket = async (market: EventMarket) => {
    const key = market.market_id
    const draft = drafts[key] || {}
    const problem = limitError(market)

    if (problem) {
      toast.error(`${market.market_name || 'Market'}: ${problem}`)

      return
    }

    setSavingKey(key)

    try {
      await zipApi('POST', `${LIMITS_API}/event`, {
        sport_id: openEvent?.sport_id,
        event_id: openEvent?.event_id,
        event_name: openEvent?.event_name,
        market_id: market.market_id,
        market_name: market.market_name,
        gtype: market.gtype,
        min_stake: draft.min !== undefined ? draft.min : boxValue(market.min_stake),
        max_stake: draft.max !== undefined ? draft.max : boxValue(market.max_stake)
      })
      await marketsQuery.refetch()
      clearDraft(key)
      toast.success(`${market.market_name || 'Market'} limits saved`)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSavingKey(null)
    }
  }

  const resetMarket = async (market: EventMarket) => {
    if (!market.override_id) return
    setSavingKey(market.market_id)

    try {
      await zipApi('DELETE', `${LIMITS_API}/event/${market.override_id}`)
      await marketsQuery.refetch()
      clearDraft(market.market_id)
      toast.success(`${market.market_name || 'Market'} back to feed default`)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSavingKey(null)
    }
  }

  const setDraft = (key: string, side: 'min' | 'max', value: string) =>
    setDrafts(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [side]: value } }))

  // Sport tabs board pe chal rahe events se — jis sport me kuch nahi wo dikhta hi nahi.
  // Sabse busy sport pehle; live events order decide karte hain.
  const sportTabs = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number; live: number }>()

    for (const event of events) {
      const id = String(event.sport_id)
      const held = counts.get(id) || { id, name: event.sport_name, count: 0, live: 0 }

      held.count += 1
      if (event.inplay) held.live += 1
      counts.set(id, held)
    }

    return [...counts.values()].sort((a, b) => b.live - a.live || b.count - a.count)
  }, [events])

  const visibleEvents = useMemo(() => {
    const term = search.trim().toLowerCase()

    return events.filter(e => {
      if (sportTab && String(e.sport_id) !== sportTab) return false
      if (!term) return true

      return (
        (e.event_name || '').toLowerCase().includes(term) ||
        (e.competition || '').toLowerCase().includes(term) ||
        String(e.event_id).includes(term)
      )
    })
  }, [events, search, sportTab])

  // Sport tab badle to khula event band — warna markets table galat list ke niche latki rehti.
  const selectSportTab = (id: string) => {
    setSportTab(id)
    setOpenEvent(null)
  }

  const limitCell = (key: string, side: 'min' | 'max', saved: number | null, placeholder: string, invalid?: boolean) => (
    <Input
      type='number'
      min={0}
      step={1}
      aria-invalid={invalid ? true : undefined}
      className='h-8 w-[110px]'
      placeholder={placeholder}
      value={drafts[key]?.[side] !== undefined ? drafts[key][side] : boxValue(saved)}
      onChange={e => setDraft(key, side, e.target.value)}
    />
  )

  const renderMarkets = () => {
    if (marketsQuery.isLoading) return <Note className='p-3'>Loading markets...</Note>
    if (marketsQuery.error) return <Note className='text-danger p-3'>{errorText(marketsQuery.error)}</Note>
    if (markets.length === 0) return <Note className='p-3'>no markets in the feed for this match</Note>

    return (
      <div className='bg-background rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='min-w-[220px]'>Market</TableHead>
              <TableHead className='min-w-[110px]'>Type</TableHead>
              <TableHead className='min-w-[140px]'>Feed default</TableHead>
              <TableHead className='min-w-[120px]'>Min</TableHead>
              <TableHead className='min-w-[120px]'>Max</TableHead>
              <TableHead className='min-w-[150px]' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {markets.map(market => {
              const busy = savingKey === market.market_id
              const problem = drafts[market.market_id] ? limitError(market) : undefined

              return (
                <TableRow key={market.market_id}>
                  <TableCell>
                    {market.market_name || `#${market.market_id}`}
                    <small className='text-muted-foreground block'>{market.market_id}</small>
                  </TableCell>
                  <TableCell>
                    {market.gtype || '—'}
                    <small className='text-muted-foreground block'>{market.category}</small>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    {market.feed_min || 0} – {market.feed_max || 0}
                  </TableCell>
                  <TableCell>{limitCell(market.market_id, 'min', market.min_stake, String(market.feed_min || 0), Boolean(problem))}</TableCell>
                  <TableCell>
                    {limitCell(market.market_id, 'max', market.max_stake, String(market.feed_max || 0), Boolean(problem))}
                    {problem && <small className='text-destructive mt-1 block'>{problem}</small>}
                  </TableCell>
                  <TableCell>
                    <div className='flex gap-1'>
                      <Button size='sm' disabled={busy || Boolean(problem)} onClick={() => saveMarket(market)}>
                        {busy ? <Loader2Icon className='animate-spin' /> : 'Save'}
                      </Button>
                      <Button size='sm' variant='outline' disabled={!market.override_id || busy} onClick={() => resetMarket(market)}>
                        Reset
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title='Bet Limits' />

      <Card>
        <CardContent className='space-y-3'>
          <p className='text-muted-foreground text-xs'>
            Leave a box empty to keep the value the live feed quotes for that side. Saved limits show in the player&apos;s bet slip and are
            enforced when the bet is placed. A match&apos;s limits are cleared automatically a few minutes after the match finishes.
          </p>

          <TabStrip tabs={sportTabs} active={sportTab} onSelect={selectSportTab} allLabel='All sports' allCount={events.length} />

          <div className='flex flex-wrap gap-2'>
            <Input
              type='search'
              className='h-8 max-w-[320px]'
              placeholder='Search match…'
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <Button size='sm' variant='secondary' onClick={loadEvents}>
              Refresh
            </Button>
          </div>

          {eventsQuery.isLoading || eventsQuery.isFetching ? (
            <Note>Loading...</Note>
          ) : eventsQuery.error ? (
            <Note className='text-danger'>{errorText(eventsQuery.error)}</Note>
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='min-w-[260px]'>Match</TableHead>
                    <TableHead className='min-w-[120px]'>Sport</TableHead>
                    <TableHead className='min-w-[90px]'>Status</TableHead>
                    <TableHead className='min-w-[120px]'>Limits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleEvents.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className='text-center'>
                        no records found
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleEvents.map(event => {
                    const isOpen = openEvent?.event_id === event.event_id

                    return (
                      <Fragment key={event.event_id}>
                        <TableRow className='cursor-pointer' onClick={() => openMarkets(event)}>
                          <TableCell>
                            <div className='flex items-center gap-1'>
                              {isOpen ? <ChevronDownIcon className='size-4' /> : <ChevronRightIcon className='size-4' />}
                              {event.event_name || `#${event.event_id}`}
                            </div>
                            {event.competition && <small className='text-muted-foreground block pl-5'>{event.competition}</small>}
                          </TableCell>
                          <TableCell>{event.sport_name}</TableCell>
                          <TableCell>
                            {event.inplay ? <ToneBadge tone='danger'>LIVE</ToneBadge> : <ToneBadge tone='muted'>upcoming</ToneBadge>}
                          </TableCell>
                          <TableCell>
                            {event.has_overrides ? <ToneBadge tone='success'>set</ToneBadge> : <span className='text-muted-foreground'>default</span>}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={4} className='bg-muted/50'>
                              {renderMarkets()}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default BetLimits
