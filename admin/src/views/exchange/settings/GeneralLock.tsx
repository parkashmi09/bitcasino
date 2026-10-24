'use client'

import { Fragment, useState, type FormEvent, type ReactNode } from 'react'

import { ChevronDownIcon, ChevronRightIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api/client'
import ClientSearch, { type ClientRow } from './ClientSearch'
import { CONFIG_API, errorText, zipApi } from './shared'

/**
 * General Lock — zip `pages/settings/UserLock.jsx`.
 *
 * Client chuno + transaction code → Load. Phir Events ka tree (sport → league → match → market)
 * aata hai; kisi bhi level pe tick = us client ke liye wo lock (zip ka `/admin/sports-lock/*`).
 * Upar wala lock niche inherit hota hai: locked sport ke niche sab ticked + disabled.
 * Zip ka "Casino List" (table-casino locks) yahan nahi hai — casino is section me nahi aata.
 */

type TreeMatch = { gmid: string | number; name: string; etid?: number; sdatetime?: string }
type TreeSeries = { cid?: string | number; name: string; children?: TreeMatch[] }
type TreeSport = { etid: number | string; name: string; children?: (TreeSeries | TreeMatch)[] }

type MarketItem = { name: string; id: string | number }
type MarketGroups = Record<string, MarketItem[]>

type Target = { id: string; username: string; role: string }

type LockRow = { sport_id?: string; series_id?: string; match_id?: string; market_id?: string; is_locked: boolean }

// Match ke niche market groups ki heading aur order (zip jaisa).
const MARKET_GROUP_ORDER = ['match', 'match1', 'fancy', 'oddeven', 'khado', 'fancy1', 'meter']
const MARKET_GROUP_TITLES: Record<string, string> = { match: 'Match', match1: 'Match1', fancy: 'Fancy' }

// Server ka message na aaye tab ye.
const TXN_FALLBACK = 'Invalid transaction password'

// ── tree shape (zip `utils/sportsTreeShape.js` ka shapeSportsEvents) ──

// Racing (10 horse, 65 greyhound) ke race flat aate hain — country ke niche group karo.
const raceLabel = (etid: number | string, race: TreeMatch) => {
  const venue = String(race.name || '')
    .replace(/\s*\([A-Z]{2,3}\)\s*$/, '')
    .trim()

  if (String(etid) !== '10') return venue
  const m = String(race.sdatetime || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i)

  if (!m) return venue
  const [, mm, dd, yyyy, hhRaw, mi, ss, ap] = m
  let hh = Number(hhRaw)

  if (ap) {
    const up = ap.toUpperCase()

    if (up === 'PM' && hh !== 12) hh += 12
    if (up === 'AM' && hh === 12) hh = 0
  }

  return `${venue}-${String(hh).padStart(2, '0')}:${mi}:${ss} ${dd}/${mm}/${yyyy}`
}

const groupRaces = (sport: TreeSport): TreeSport => {
  const races = sport.children || []

  if (!races.length || 'children' in races[0]) return sport // pehle se nested
  const byCode = new Map<string, TreeMatch[]>()

  for (const race of races as TreeMatch[]) {
    const code = (String(race.name || '').match(/\(([A-Z]{2,3})\)\s*$/) || [null, 'ALL'])[1] as string

    if (!byCode.has(code)) byCode.set(code, [])
    byCode.get(code)!.push({ ...race, name: raceLabel(sport.etid, race) })
  }

  return {
    ...sport,
    children: [...byCode].map(([code, list]) => ({
      name: code,
      cid: `race-${sport.etid}-${code}`,
      children: [...list].sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'))
    }))
  }
}

// Har league ke andar match naam se (racing chhod ke).
const byName = (a: TreeMatch, b: TreeMatch) => {
  const x = String(a?.name ?? '').toLowerCase()
  const y = String(b?.name ?? '').toLowerCase()

  return x < y ? -1 : x > y ? 1 : 0
}

const sortMatchesByName = (sport: TreeSport): TreeSport => {
  if (String(sport.etid) === '10' || String(sport.etid) === '65') return sport

  return {
    ...sport,
    children: (sport.children || []).map(ser =>
      'children' in ser && Array.isArray(ser.children) ? { ...ser, children: [...ser.children].sort(byName) } : ser
    )
  }
}

const shapeSportsEvents = (sports: TreeSport[]) => (sports || []).map(groupRaces).map(sortMatchesByName)

// Feed ke markets → gtype ke group, har group me mid ke order me.
function groupMarketsByType(markets: { gtype?: string; mname?: string; marketName?: string; mid?: number | string; marketId?: string }[]) {
  const byGtype: Record<string, MarketItem[]> = {}

  for (const m of markets) {
    if (!m) continue
    const gtype = m.gtype || 'Other'

    if (!byGtype[gtype]) byGtype[gtype] = []
    byGtype[gtype].push({ name: String(m.mname || m.marketName), id: (m.mid || m.marketId) as string })
  }

  Object.values(byGtype).forEach(list => list.sort((a, b) => Number(a.id) - Number(b.id)))

  const ordered = [...MARKET_GROUP_ORDER.filter(g => byGtype[g]), ...Object.keys(byGtype).filter(g => !MARKET_GROUP_ORDER.includes(g))]
  const groups: MarketGroups = {}

  for (const g of ordered) groups[MARKET_GROUP_TITLES[g] || g] = byGtype[g]

  return groups
}

const sportsTargetType = (role?: string) => (role === 'USER' ? 'USER' : role === 'OWNER' ? 'OWNER' : 'STAFF')

/** Tree ki ek row: arrow (agar niche kuch hai) + checkbox + naam. */
const TreeRow = ({
  hasChildren,
  open,
  onToggle,
  checked,
  disabled,
  onCheck,
  label
}: {
  hasChildren: boolean
  open?: boolean
  onToggle?: () => void
  checked: boolean
  disabled?: boolean
  onCheck: () => void
  label: ReactNode
}) => (
  <div className='flex items-center gap-1.5 py-0.5'>
    {hasChildren ? (
      <button type='button' title='click here to expand' className='text-muted-foreground hover:text-foreground' onClick={onToggle}>
        {open ? <ChevronDownIcon className='size-4' /> : <ChevronRightIcon className='size-4' />}
      </button>
    ) : (
      <span className='inline-block w-4' />
    )}
    <label className='flex items-center gap-2 text-sm'>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={onCheck} />
      {label}
    </label>
  </div>
)

const GeneralLock = () => {
  const [clientName, setClientName] = useState('')
  const [targetUser, setTargetUser] = useState<Target | null>(null)
  const [transactionCode, setTransactionCode] = useState('')
  const [verified, setVerified] = useState(false)
  const [loadingVerify, setLoadingVerify] = useState(false)
  const [busy, setBusy] = useState(false)

  const [sportsTree, setSportsTree] = useState<TreeSport[]>([])

  // Har parent group me ek hi branch khuli (zip ka accordion).
  const [expanded, setExpanded] = useState<Record<string, string | null>>({})
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set())
  const [matchCache, setMatchCache] = useState<Record<string, MarketGroups>>({}) // gmid → market groups

  const loadEvents = async () => {
    try {
      const res = await zipApi<{ data?: { sports?: TreeSport[] } }>('GET', 'sports/user/all/sports/events')

      setSportsTree(shapeSportsEvents(res.data?.sports || []))
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  // Client ke saved sports locks → tick wale keys (sport+series+match+market jod ke, zip jaisa).
  const loadUserLocks = async (target: Target) => {
    try {
      const res = await zipApi<{ data?: LockRow[] }>('GET', `${CONFIG_API}/sports-lock/get/${target.id}`, {
        type: sportsTargetType(target.role)
      })

      const ids = new Set<string>()

      for (const l of res.data || []) {
        if (!l.is_locked) continue
        const key = `${l.sport_id ?? ''}${l.series_id ?? ''}${l.match_id ?? ''}${l.market_id ?? ''}`

        if (key) ids.add(key)
      }

      setLockedIds(ids)
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  type LockArgs = { key: string; sportId: string; seriesId?: string; matchId?: string; marketId?: string }

  const saveSportsLock = async ({ sportId, seriesId, matchId, marketId }: LockArgs, isLocked: boolean) => {
    const lockType = marketId ? 'MARKET' : matchId ? 'MATCH' : seriesId ? 'SERIES' : 'SPORT'

    await zipApi('POST', `${CONFIG_API}/sports-lock/update`, {
      targetId: targetUser!.id,
      targetType: sportsTargetType(targetUser?.role),
      sportId,
      seriesId: seriesId || null,
      matchId: matchId || null,
      marketId: marketId || null,
      isLocked,
      lockType
    })
  }

  const flipKey = (key: string, on: boolean) =>
    setLockedIds(prev => {
      const s = new Set(prev)

      if (on) s.add(key)
      else s.delete(key)

      return s
    })

  // Tick turant dikhao; save fail ho to wapas.
  const handleToggle = async (args: LockArgs) => {
    if (!targetUser) return
    const wasLocked = lockedIds.has(args.key)

    flipKey(args.key, !wasLocked)
    setBusy(true)

    try {
      await saveSportsLock(args, !wasLocked)
      toast.success(`${wasLocked ? 'Unlocked' : 'Locked'} for ${targetUser.username}`)
    } catch (err) {
      flipKey(args.key, wasLocked)
      toast.error(errorText(err) || 'Failed to update lock')
    } finally {
      setBusy(false)
    }
  }

  const isOpen = (group: string, key: string) => expanded[group] === key
  const toggleExpand = (group: string, key: string) => setExpanded(prev => ({ ...prev, [group]: prev[group] === key ? null : key }))

  const loadMatchMarkets = async (gmid: string, sportsId: number | string) => {
    if (matchCache[gmid]) return

    try {
      const res = await zipApi<{ data?: { data?: unknown } | unknown[] }>('POST', 'sports/user/cricket/get-match-private-data', {
        gmid,
        sid: sportsId
      })

      const d = res.data as { data?: unknown; mid?: unknown } | unknown[] | undefined
      let markets: unknown[] = []

      if (Array.isArray(d)) markets = d
      else if (d && Array.isArray(d.data)) markets = d.data
      else if (d && d.mid) markets = [d]

      setMatchCache(prev => ({ ...prev, [gmid]: groupMarketsByType(markets as Parameters<typeof groupMarketsByType>[0]) }))
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  const handleSelectUser = (u: ClientRow) => {
    setClientName(u.username)
    setTargetUser({ id: String(u.staff_id || u.user_id), username: u.username, role: u.user_type })
  }

  const handleLoad = async (e: FormEvent) => {
    e.preventDefault()

    // Zip jaisa: pehle code, phir client.
    if (!transactionCode) {
      toast.error('Transaction code is required')

      return
    }

    if (!targetUser) {
      toast.error('Please select a user first')

      return
    }

    setLoadingVerify(true)

    try {
      await api.post('admin/exchange-lookup/transaction-password/verify', { transactionPassword: transactionCode })
      setVerified(true)
      await loadEvents()
      await loadUserLocks(targetUser)
      toast.success('Verified. Events loaded.')
    } catch (err) {
      setVerified(false)
      toast.error(errorMessage(err) || TXN_FALLBACK)
    } finally {
      setLoadingVerify(false)
    }
  }

  const handleReset = () => {
    setClientName('')
    setTargetUser(null)
    setTransactionCode('')
    setVerified(false)
    setLockedIds(new Set())
    setExpanded({})
    setSportsTree([])
    setMatchCache({})
  }

  // ── tree render ──
  const renderMarkets = (etid: string, cid: string, gmid: string, matchCheckId: string, matchLocked: boolean) => {
    const markets = matchCache[gmid]

    if (!markets) return <div className='text-muted-foreground px-3 py-2 text-sm'>Loading markets...</div>

    return Object.entries(markets).map(([gtype, items]) => (
      <Fragment key={`${matchCheckId}-${gtype}`}>
        <h5 className='mt-1 text-sm font-semibold'>{gtype}</h5>
        {items.map(it => {
          const mktValue = String(it.id)
          const mktCheckId = `${matchCheckId}${mktValue}`

          return (
            <TreeRow
              key={mktCheckId}
              hasChildren={false}
              checked={matchLocked || lockedIds.has(mktCheckId)}
              disabled={matchLocked}
              onCheck={() => handleToggle({ key: mktCheckId, sportId: etid, seriesId: cid, matchId: gmid, marketId: mktValue })}
              label={it.name}
            />
          )
        })}
      </Fragment>
    ))
  }

  const renderMatch = (sport: TreeSport, etid: string, cid: string, uid: string, seriesCheckId: string, seriesLocked: boolean, match: TreeMatch) => {
    const gmid = String(match.gmid)
    const matchCheckId = `${seriesCheckId}${gmid}`
    const matchGroup = `match|${uid}`
    const matchKey = `match-${matchCheckId}`
    const open = isOpen(matchGroup, matchKey)
    const matchLocked = seriesLocked || lockedIds.has(matchCheckId)

    return (
      <li key={gmid}>
        <TreeRow
          hasChildren
          open={open}
          onToggle={() => {
            toggleExpand(matchGroup, matchKey)
            if (!matchCache[gmid]) void loadMatchMarkets(gmid, sport.etid)
          }}
          checked={matchLocked}
          disabled={seriesLocked}
          onCheck={() => handleToggle({ key: matchCheckId, sportId: etid, seriesId: cid, matchId: gmid })}
          label={match.name}
        />
        {open && <div className='pl-6'>{renderMarkets(etid, cid, gmid, matchCheckId, matchLocked)}</div>}
      </li>
    )
  }

  const renderSeries = (sport: TreeSport, etid: string, sportLocked: boolean, ser: TreeSeries, serIndex: number) => {
    const cid = String(ser.cid)

    // Backend ko lock ki pehchaan yahi jaati hai — zip jaisa.
    const seriesCheckId = `${etid}${cid}`

    // Sirf UI ke liye unique key (cid repeat ho sakta hai).
    const uid = `${etid}-${serIndex}-${cid}`
    const seriesGroup = `series|${etid}`
    const seriesKey = `series-${uid}`
    const open = isOpen(seriesGroup, seriesKey)
    const matches = ser.children || []
    const seriesLocked = sportLocked || lockedIds.has(seriesCheckId)

    return (
      <li key={uid}>
        <TreeRow
          hasChildren={matches.length > 0}
          open={open}
          onToggle={() => toggleExpand(seriesGroup, seriesKey)}
          checked={seriesLocked}
          disabled={sportLocked}
          onCheck={() => handleToggle({ key: seriesCheckId, sportId: etid, seriesId: cid })}
          label={ser.name}
        />
        {open && matches.length > 0 && (
          <ul className='pl-6'>{matches.map(match => renderMatch(sport, etid, cid, uid, seriesCheckId, seriesLocked, match))}</ul>
        )}
      </li>
    )
  }

  const renderSport = (sport: TreeSport) => {
    const etid = String(sport.etid)
    const sportKey = `sport-${etid}`
    const open = isOpen('sports', sportKey)
    const series = (sport.children || []) as TreeSeries[]

    // Locked sport ke niche sab ticked + disabled (zip jaisa).
    const sportLocked = lockedIds.has(etid)

    return (
      <li key={etid}>
        <TreeRow
          hasChildren={series.length > 0}
          open={open}
          onToggle={() => toggleExpand('sports', sportKey)}
          checked={sportLocked}
          onCheck={() => handleToggle({ key: etid, sportId: etid })}
          label={sport.name}
        />
        {open && series.length > 0 && <ul className='pl-6'>{series.map((ser, i) => renderSeries(sport, etid, sportLocked, ser, i))}</ul>}
      </li>
    )
  }

  return (
    <div>
      {(busy || loadingVerify) && (
        <div className='bg-background/40 fixed inset-0 z-50 flex items-center justify-center'>
          <Loader2Icon className='text-primary size-8 animate-spin' />
        </div>
      )}

      <PageHeader title='General Lock' />

      {/* overflow-visible: client search ki suggestion list card ke bahar tak dikhe (kate nahi). */}
      <Card className='overflow-visible'>
        <CardContent className='space-y-4'>
          <form onSubmit={handleLoad} className='flex flex-wrap items-start gap-3'>
            <div className='w-full md:w-64'>
              <ClientSearch
                placeholder='Search By Client Name'
                value={clientName}
                onChange={v => {
                  setClientName(v)
                  setTargetUser(null)
                }}
                onSelect={handleSelectUser}
              />
            </div>
            <Input
              type='password'
              placeholder='Transaction Code'
              className='w-full md:w-44'
              value={transactionCode}
              onChange={e => setTransactionCode(e.target.value)}
            />
            <div className='flex gap-2'>
              <Button type='submit' disabled={loadingVerify}>
                Load
              </Button>
              <Button type='button' variant='secondary' onClick={handleReset}>
                Reset
              </Button>
            </div>
          </form>

          {verified && (
            <div className='grid gap-6 lg:grid-cols-2'>
              <div>
                <h4 className='mb-2 text-base font-semibold'>Events</h4>
                <ul>
                  {sportsTree.length === 0 ? (
                    <li className='text-muted-foreground px-2 py-2 text-sm'>Loading sports...</li>
                  ) : (
                    sportsTree.map(renderSport)
                  )}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default GeneralLock
