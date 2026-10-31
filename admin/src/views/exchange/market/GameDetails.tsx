'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import { ChevronDownIcon } from 'lucide-react'

import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useApi } from '@/hooks/use-api'
import { api, errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { MARKET_API, SPORTS_USER, fmtDateTime, isLay, plain, rateOf, type AnalysisResponse, type Bet, type FeedMarket, type MatchMeta } from './api'
import BetLockDialog from './BetLockDialog'
import EventsTree from './EventsTree'
import { buildExposureIndex } from './exposureIndex'
import { MarketBlock, sortBySno } from './marketBlocks'
import MoreMarketDialog, { type MoreMarketRow } from './MoreMarketDialog'
import UserBookDialog from './UserBookDialog'
import ViewMoreBetsDialog from './ViewMoreBetsDialog'

type Props = { sportId: string; eventId: string }

// zip ka SPORTS_STREAM_BASE (Live Match iframe)
const STREAM_BASE = process.env.NEXT_PUBLIC_SPORTS_STREAM_BASE || 'https://stream-s-43.uhdmovies.online/sports-stream?id='

const DEAD_LIMIT = 5 // itni baar khali/fail → page chup
const DEAD_REDIRECT_MS = 3000 // phir 3s me bahar

/** Feed ka response kabhi array, kabhi { data: [] } — markets nikaalo. */
function extractMarkets(res: unknown): FeedMarket[] {
  const d = (res as { data?: unknown })?.data ?? res

  if (Array.isArray(d)) return d as FeedMarket[]
  if (d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data)) return (d as { data: FeedMarket[] }).data

  return []
}

/**
 * Feed ka stime IST me "9/22/2026 5:00:00 PM" — dekhne wale ke time me DD/MM/YYYY HH:mm:ss
 * (zip formatMatchTime).
 */
function formatMatchTime(raw: string | undefined) {
  if (!raw) return ''
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(raw.trim())

  if (!m) return fmtDateTime(raw)
  let hour = Number(m[4]) % 12

  if (/pm/i.test(m[7])) hour += 12
  const ist = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6]))

  return fmtDateTime(new Date(ist - 5.5 * 3600 * 1000).toISOString())
}

/** Score animation — meta.gtv ho to score-url ek hi baar mangwao (token single use). */
function ScoreAnimation({ gmid, etid }: { gmid: string; etid: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const asked = useRef<string | null>(null)

  useEffect(() => {
    if (asked.current === gmid) return
    asked.current = gmid
    api
      .get<{ url?: string }>(`${SPORTS_USER}/cricket/score-url`, { gmid, etid })
      .then(r => setUrl(r?.url ?? null))
      .catch(() => setUrl(null))
  }, [gmid, etid])

  return <div className='bg-muted mb-2 h-44 overflow-hidden rounded-md'>{url && <iframe src={url} title='Live Score Card' className='h-full w-full border-0' />}</div>
}

/** Cricket scorecard (meta.scard == 1) — score-card url ka iframe. */
function CricketScore({ gmid }: { gmid: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    api
      .post<{ score_url?: string }>(`${SPORTS_USER}/cricket/score-card`, { gmid, sid: '4' })
      .then(r => setUrl(r?.score_url ?? null))
      .catch(() => setUrl(null))
  }, [gmid])

  if (!url) return null

  return (
    <Card size='sm' className='overflow-hidden p-0'>
      <iframe src={url} title='Scorecard' className='h-40 w-full border-0' />
    </Card>
  )
}

/**
 * Game Details — zip ka `pages/game-details/GameDetails.jsx`.
 *
 * Odds har 2s, bets / book / meta har 5s. Book = Market Analysis wahi data, sirf is event ka.
 * Cricket pe poora board; baaki sports pe ek market (match_odds → winners → 1x2 → pehla),
 * "More Market" se badlo. 5 baar khali/fail → polls band, 3s baad dashboard.
 */
const GameDetails = ({ sportId, eventId }: Props) => {
  const router = useRouter()

  // now = abhi ka poll, old = pichhla (odds flash ke liye), hadData = kabhi markets aaye?
  const [feed, setFeed] = useState<{ now: FeedMarket[]; old: FeedMarket[]; hadData: boolean }>({ now: [], old: [], hadData: false })
  const strikes = useRef(0)
  const hadData = useRef(false)
  const [dead, setDead] = useState(false)
  const [noMarkets, setNoMarkets] = useState(false)

  const [tab, setTab] = useState<'matched' | 'unmatched'>('matched')
  const [liveOpen, setLiveOpen] = useState(false)
  const [lockMarket, setLockMarket] = useState<FeedMarket | null>(null)
  const [bookMarket, setBookMarket] = useState<string | null>(null)
  const [viewMore, setViewMore] = useState(false)
  const [moreRows, setMoreRows] = useState<MoreMarketRow[] | null>(null)
  const [selectedMid, setSelectedMid] = useState<string | null>(null)

  const slow = dead ? false : 5000
  const closeBook = useCallback(() => setBookMarket(null), [])

  // match meta — gtv (animation), scard, tv, naam, time
  const { data: metaRes } = useApi<{ data?: MatchMeta[] }>(`${SPORTS_USER}/v1/sports-gamedetailPrivate`, { gmid: eventId, etid: sportId }, { refetchInterval: slow })
  const meta = metaRes?.data?.[0]?.gmid ? metaRes.data[0] : null

  // downline bets is event pe
  const { data: betsRes, error: betsError } = useApi<{ rows: Bet[] }>(`${MARKET_API}/event-bets`, { eventId, limit: 100 }, { refetchInterval: slow })
  const openBets = useMemo(() => (betsRes?.rows ?? []).filter(b => !b.deleted), [betsRes])

  // First load of the bets failed — the tables would just look empty. (Refresh failures are toasted globally.)
  useEffect(() => {
    if (betsError && !betsRes) toast.error(`Could not load bets: ${errorMessage(betsError)}`, { id: `game-bets-${eventId}` })
  }, [betsError, betsRes, eventId])
  const matchedBets = openBets.filter(b => !b.unmatched)
  const unmatchedBets = openBets.filter(b => b.unmatched)

  // View More — 500 tak, khulne pe hi
  const viewMoreQuery = useApi<{ rows: Bet[] }>(viewMore ? `${MARKET_API}/event-bets` : null, { eventId, limit: 500 })

  // book (Market Analysis, sirf is event ka)
  const { data: bookRes } = useApi<AnalysisResponse>(`${MARKET_API}/analysis`, { eventId }, { refetchInterval: slow })
  const exposure = useMemo(() => buildExposureIndex(bookRes?.events.find(e => e.eventId === eventId) ?? bookRes?.events[0]), [bookRes, eventId])

  // odds — har 2s; pichhla poll flash ke liye rakho
  const fetchMarkets = useCallback(async () => {
    try {
      const list = extractMarkets(await api.post(`${SPORTS_USER}/cricket/get-match-private-data`, { gmid: eventId, sid: sportId }))

      if (list.length) {
        hadData.current = true
        strikes.current = 0
        setNoMarkets(false)
      } else if (++strikes.current >= (hadData.current ? DEAD_LIMIT : 1)) {
        setNoMarkets(true)
      }

      setFeed(prev => ({ now: list, old: prev.now, hadData: prev.hadData || list.length > 0 }))
    } catch {
      // match khatam (feed 404) — strike
      if (++strikes.current >= (hadData.current ? DEAD_LIMIT : 1)) setDead(true)
    }
  }, [eventId, sportId])

  // turant ek baar, phir har 2s. Page event pe keyed hai (naya event = naya mount), reset nahi chahiye.
  useEffect(() => {
    if (dead) return
    const first = setTimeout(() => void fetchMarkets(), 0)
    const id = setInterval(() => void fetchMarkets(), 2000)

    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [dead, fetchMarkets])

  // khali ya khatam match → 3s baad bahar (zip: home)
  useEffect(() => {
    if (!dead && !noMarkets) return

    // Say why the page is about to leave, instead of a silent blank → redirect.
    toast.info(dead ? 'This match is no longer on the feed — going back to the dashboard' : 'No open markets for this match — going back to the dashboard', { id: `game-${eventId}` })
    const t = setTimeout(() => router.push('/dashboard?tab=agent'), DEAD_REDIRECT_MS)

    return () => clearTimeout(t)
  }, [dead, noMarkets, router, eventId])

  const etid = String(meta?.etid ?? sportId)
  const isCricket = etid === '4'
  const allMarkets = useMemo(() => sortBySno(feed.now), [feed.now])

  // cricket pe sab; baaki pe ek market
  const visibleMarkets = useMemo(() => {
    if (isCricket) return allMarkets
    const named = (n: string) => allMarkets.find(m => String(m.mname || '').toLowerCase().trim() === n)
    const fallback = named('match_odds') ?? named('winners') ?? named('1x2') ?? allMarkets[0]
    const active = selectedMid && allMarkets.some(m => String(m.mid) === selectedMid) ? selectedMid : fallback ? String(fallback.mid) : null

    return allMarkets.filter(m => String(m.mid) === active)
  }, [allMarkets, isCricket, selectedMid])

  // More Market: list (band markets bhi) + har market pe downline ki open bets
  const openMoreMarket = async () => {
    let list: { mid: string | number; mname: string; sno?: number }[] = []

    try {
      const res = await api.post<{ mid: string; mname: string; sno?: number }[]>(`${SPORTS_USER}/cricket/market-list`, { gmid: eventId, sid: sportId })

      list = Array.isArray(res) ? res : []
    } catch {
      list = []
    }

    if (!list.length) list = allMarkets
    setMoreRows(sortBySno(list).map(m => ({ mid: String(m.mid), mname: m.mname, book: matchedBets.filter(b => String(b.matchId) === String(m.mid)).length })))
  }

  // header: data aane tak / khatam match pe khali
  const bare = dead || (!meta && !feed.hadData)
  const headerText = bare ? ' > ' : `${meta?.cname ?? ''} > ${meta?.ename ?? ''}`

  const betsTable = (bets: Bet[]) => (
    <table className='w-full text-xs'>
      <thead>
        <tr className='bg-muted'>
          <th className='px-2 py-1.5 text-left'>UserName</th>
          <th className='px-2 py-1.5 text-left'>Nation</th>
          <th className='px-2 py-1.5 text-right'>Rate</th>
          <th className='px-2 py-1.5 text-right'>Amount</th>
        </tr>
      </thead>
      <tbody>
        {bets.length === 0 ? (
          <tr>
            <td colSpan={4} className='px-2 py-2 text-center'>
              No records found
            </td>
          </tr>
        ) : (
          bets.map(b => {
            const side = isLay(b) ? 'border-l-pink-400 bg-pink-50 dark:bg-pink-950/30' : 'border-l-sky-400 bg-sky-50 dark:bg-sky-950/30'

            return (
              <Fragment key={b.id}>
                <tr className={cn('border-t border-l-4', side)}>
                  <td colSpan={4} className='px-2 pt-1'>
                    <b>{b.marketLabel || b.marketType}</b> <span className='float-right'>{fmtDateTime(b.createdAt)}</span>
                  </td>
                </tr>
                <tr className={cn('border-l-4', side)}>
                  <td className='px-2 pb-1'>{b.username}</td>
                  <td className='px-2 pb-1'>{b.selection || '-'}</td>
                  <td className='px-2 pb-1 text-right tabular-nums'>{rateOf(b)}</td>
                  <td className='px-2 pb-1 text-right tabular-nums'>{plain(b.stake)}</td>
                </tr>
              </Fragment>
            )
          })
        )}
      </tbody>
    </table>
  )

  return (
    <div className='grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]'>
      <Card size='sm' className='hidden self-start p-0 xl:flex'>
        <EventsTree activeSportId={sportId} activeEventId={eventId} />
      </Card>

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='min-w-0'>
          <div className='bg-primary text-primary-foreground mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 font-semibold'>
            <span>{headerText}</span>
            <div className='text-sm font-normal'>
              <span>{bare ? '' : formatMatchTime(meta?.stime)}</span>
              {etid === '10' && !bare && <span> | {meta?.mname ?? ''}</span>}
            </div>
          </div>

          {Number(meta?.gtv) > 0 && <ScoreAnimation gmid={eventId} etid={etid} />}

          {!isCricket && (
            <div className='mb-2 text-right'>
              <Button size='sm' variant='outline' onClick={() => void openMoreMarket()}>
                More Market
              </Button>
            </div>
          )}

          <div>
            {visibleMarkets.map((market, idx) => {
              const prev = feed.old
              const oldMarket = prev.find(p => String(p.mid) === String(market.mid)) ?? sortBySno(prev)[idx]

              return (
                <MarketBlock
                  key={String(market.mid)}
                  market={market}
                  oldMarket={oldMarket}
                  exposure={exposure}
                  onBetLock={setLockMarket}
                  onUserBook={m => setBookMarket(m.mname)}
                />
              )
            })}
          </div>
        </div>

        <div className='flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start'>
          {meta?.tv ? (
            <Card size='sm' className='gap-0 p-0'>
              <button type='button' onClick={() => setLiveOpen(o => !o)} className='flex items-center gap-1 px-3 py-2 text-left font-semibold'>
                <ChevronDownIcon className={cn('size-4 transition-transform', !liveOpen && '-rotate-90')} /> Live Match
              </button>
              {liveOpen && <iframe key={eventId} src={`${STREAM_BASE}${eventId}`} title='Live Match' className='h-52 w-full border-0' allowFullScreen />}
            </Card>
          ) : null}

          {etid === '4' && Number(meta?.scard) === 1 && <CricketScore gmid={eventId} />}

          <Card size='sm' id='my-game-bets' className='gap-2 p-0'>
            <div className='flex items-center justify-between px-3 pt-3'>
              <h6 className='font-semibold'>My Bets</h6>
              <Button size='xs' variant='outline' onClick={() => setViewMore(true)}>
                View More
              </Button>
            </div>
            <div className='flex gap-1 px-3'>
              {(['matched', 'unmatched'] as const).map(t => (
                <button
                  key={t}
                  type='button'
                  onClick={() => setTab(t)}
                  className={cn('border-b-2 px-2 py-1 text-xs', tab === t ? 'border-primary text-primary font-semibold' : 'border-transparent')}
                >
                  {t === 'matched' ? 'Matched Bets' : 'Unmatched Bets'}
                </button>
              ))}
            </div>
            <div className='max-h-[60vh] overflow-auto'>{betsTable(tab === 'matched' ? matchedBets : unmatchedBets)}</div>
          </Card>
        </div>
      </div>

      {/* phone pe neeche bets ka counter — click = My Bets tak scroll */}
      <button
        type='button'
        className='bg-primary text-primary-foreground fixed right-4 bottom-4 z-40 flex size-14 flex-col items-center justify-center rounded-full text-xs shadow-lg lg:hidden'
        onClick={() => document.getElementById('my-game-bets')?.scrollIntoView({ behavior: 'smooth' })}
      >
        <span className='text-base font-bold'>{Math.min(matchedBets.length, 10)}</span>
        Bets
      </button>

      <MoreMarketDialog
        open={moreRows !== null}
        rows={moreRows ?? []}
        onClose={() => setMoreRows(null)}
        onPick={row => {
          setSelectedMid(row.mid)
          setMoreRows(null)
        }}
      />
      <ViewMoreBetsDialog open={viewMore && !viewMoreQuery.isLoading} bets={viewMoreQuery.data?.rows ?? []} onClose={() => setViewMore(false)} onReload={() => void viewMoreQuery.refetch()} />
      <UserBookDialog eventId={eventId} gameType={bookMarket} onClose={closeBook} />
      <BetLockDialog key={lockMarket ? String(lockMarket.mid) : 'none'} eventId={eventId} market={lockMarket} onClose={() => setLockMarket(null)} />
    </div>
  )
}

export default GameDetails
