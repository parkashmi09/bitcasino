'use client'

import { Fragment, useMemo, useState } from 'react'

import { toast } from 'sonner'

import { Loader2Icon } from 'lucide-react'

import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  CONFIG_API,
  LeagueTabs,
  Note,
  SportHeader,
  ToggleGroupButtons,
  ToneBadge,
  cellKey,
  errorText,
  groupMarkets,
  useZip,
  zipApi,
  type GridSport,
  type League,
  type Market
} from './shared'
import { check } from '@/lib/validate'

/**
 * Buffer Time — zip `pages/settings/BufferTime.jsx` (sirf owner).
 *
 * Bet slip "Place Bet" ke baad itne second live price dekhta hai, phir bet book hoti hai.
 * Grid wahi jo Commission ka: sport → league ('default' + variants) → market.
 * Variant league ka cell "Inherit" pe ho to main sport ki value chalti hai, "Own" pe apni.
 * 0 = set nahi, site ka default chalega.
 * Zip ka Casino tab yahan nahi hai (casino is section me nahi aata).
 */

type Cell = { state: 'set' | 'inherit'; seconds: number | string; inherited?: number }
type Sport = GridSport<Cell>
type BufferResponse = { sports?: Sport[]; markets?: Market[]; max_seconds?: number }

const BufferTime = () => {
  const grid = useZip<BufferResponse>(`${CONFIG_API}/betting-config/buffer/sports`)
  const sports = useMemo(() => grid.data?.sports || [], [grid.data])
  const markets = useMemo(() => grid.data?.markets || [], [grid.data])
  const maxSeconds = grid.data?.max_seconds || 60
  const [search, setSearch] = useState('')

  // undefined = pehla sport khula (zip jaisa), null = sab band
  const [openSportState, setOpenSport] = useState<number | null | undefined>(undefined)
  const openSport = openSportState === undefined ? (sports[0]?.sport_id ?? null) : openSportState

  // sport_id → league_key jo us sport ki tab strip me khula hai
  const [openLeague, setOpenLeague] = useState<Record<number, string>>({})

  // "Set all markets" ka input
  const [bulkSeconds, setBulkSeconds] = useState('')
  const [saving, setSaving] = useState(false)

  // Draft edits "<sportId>:<leagueKey>:<marketKey>" → cell. Save pe hi jaate hain.
  const [drafts, setDrafts] = useState<Record<string, Cell>>({})

  // Save ke baad dobara load, drafts saaf.
  const load = async () => {
    await grid.refetch()
    setDrafts({})
  }

  const validSeconds = (raw: string) => {
    const value = Number(raw)

    if (raw === '' || !Number.isFinite(value) || value < 0 || value > maxSeconds) {
      toast.error(`Buffer must be between 0 and ${maxSeconds} seconds`)

      return null
    }

    return value
  }

  // ── draft helpers ──
  const savedCell = (league: League<Cell>, marketKey: string): Cell =>
    league.cells?.[marketKey] || { state: league.is_default ? 'set' : 'inherit', seconds: 0, inherited: 0 }

  const cellOf = (key: string, saved: Cell) => drafts[key] ?? saved

  const isCellDirty = (key: string, saved: Cell) => {
    const d = drafts[key]

    if (d === undefined) return false
    if (d.state !== saved.state) return true

    return d.state === 'set' && Number(d.seconds) !== Number(saved.seconds)
  }

  const setCellDraft = (key: string, saved: Cell, patch: Partial<Cell>) =>
    setDrafts(prev => ({ ...prev, [key]: { ...(prev[key] ?? saved), ...patch } }))

  // Inheritance ke baad slip asal me kitna rukega.
  const effectiveOf = (cell: Cell) => Number(cell.state === 'inherit' ? cell.inherited : cell.seconds) || 0

  const ownCount = (league: League<Cell>) => markets.filter(m => savedCell(league, m.key).state === 'set').length

  // Har dirty cell ek baar.
  const dirtyCells = () => {
    const list: { sport: Sport; league: League<Cell>; market: Market; cell: Cell }[] = []

    for (const sport of sports) {
      for (const league of sport.leagues || []) {
        for (const market of markets) {
          const key = cellKey(sport.sport_id, league.key, market.key)
          const saved = savedCell(league, market.key)

          if (isCellDirty(key, saved)) list.push({ sport, league, market, cell: cellOf(key, saved) })
        }
      }
    }

    return list
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dirtyCount = useMemo(() => dirtyCells().length, [drafts, sports, markets])

  // ── save ──
  const saveAll = async () => {
    const items = []
    const resets = []

    for (const { sport, league, market, cell } of dirtyCells()) {
      const payload = { sport_id: sport.sport_id, league_key: league.key, market_key: market.key }

      // "Inherit" matlab row hi nahi — isliye DELETE, save nahi.
      if (cell.state === 'inherit') {
        resets.push(payload)
        continue
      }

      const seconds = Number(cell.seconds)

      if (cell.seconds === '' || !Number.isFinite(seconds) || seconds < 0 || seconds > maxSeconds) {
        toast.error(`${sport.name} / ${league.label} — ${market.label}: buffer must be 0–${maxSeconds}s`)

        return
      }

      items.push({ ...payload, buffer_seconds: seconds })
    }

    if (!items.length && !resets.length) return

    setSaving(true)

    try {
      for (const payload of resets) await zipApi('DELETE', `${CONFIG_API}/betting-config/buffer/sports`, payload)
      if (items.length) await zipApi('POST', `${CONFIG_API}/betting-config/buffer/sports/bulk`, { items })
      toast.success(`Saved ${items.length + resets.length} cell(s)`)
      await load()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  // Dikh rahi league ke har market pe ek hi patch.
  const applyToLeague = (sport: Sport, league: League<Cell>, patch: Partial<Cell>) => {
    setDrafts(prev => {
      const next = { ...prev }

      for (const market of markets) {
        const key = cellKey(sport.sport_id, league.key, market.key)

        next[key] = { ...(next[key] ?? savedCell(league, market.key)), ...patch }
      }

      return next
    })
  }

  // League ka naam bhi match ho, taaki "t10" se Cricket mile.
  const visibleSports = useMemo(() => {
    const term = search.trim().toLowerCase()

    if (!term) return sports

    return sports.filter(
      s => s.name.toLowerCase().includes(term) || (s.leagues || []).some(l => !l.is_default && l.label.toLowerCase().includes(term))
    )
  }, [sports, search])

  const leagueOf = (sport: Sport) => {
    const wanted = openLeague[sport.sport_id]

    return (sport.leagues || []).find(l => l.key === wanted) || sport.leagues?.[0]
  }

  // Band sport header ki chhoti line.
  const sportSummary = (sport: Sport) => {
    const parts = []

    for (const league of sport.leagues || []) {
      if (league.is_default) {
        const n = markets.filter(m => effectiveOf(savedCell(league, m.key)) > 0).length

        parts.push(n ? `${n} of ${markets.length} markets set` : 'Site default')
      } else {
        const own = ownCount(league)

        if (own) parts.push(`${league.label}: ${own} own`)
      }
    }

    return parts.join(' · ')
  }

  const groupedMarkets = useMemo(() => groupMarkets(markets), [markets])

  const renderMarketRow = (sport: Sport, league: League<Cell>, market: Market) => {
    const key = cellKey(sport.sport_id, league.key, market.key)
    const saved = savedCell(league, market.key)
    const cell = cellOf(key, saved)
    const eff = effectiveOf(cell)
    const inheriting = cell.state === 'inherit'

    return (
      <TableRow key={key} className={cn(isCellDirty(key, saved) && 'bg-warning-soft')}>
        <TableCell className='whitespace-normal'>
          <div>{market.label}</div>
          {market.hint && <small className='text-muted-foreground text-xs'>{market.hint}</small>}
        </TableCell>
        <TableCell>
          <div className='flex items-center justify-center gap-1.5'>
            {!league.is_default && (
              <ToggleGroupButtons
                value={inheriting ? 'inherit' : 'set'}
                options={[
                  { value: 'inherit', label: 'Inherit', activeClass: 'bg-info text-white' },
                  { value: 'set', label: 'Own', activeClass: 'bg-primary text-primary-foreground' }
                ]}
                onChange={v => {
                  if (v === 'inherit') setCellDraft(key, saved, { state: 'inherit' })
                  else if (inheriting) setCellDraft(key, saved, { state: 'set', seconds: cell.inherited ?? 0 })
                }}
              />
            )}
            <Input
              type='number'
              min={0}
              max={maxSeconds}
              step={0.5}
              className='h-8 w-20'
              disabled={inheriting}
              aria-invalid={!inheriting && check.number(cell.seconds, 'Buffer', { min: 0, max: maxSeconds }) ? true : undefined}
              value={inheriting ? (cell.inherited ?? 0) : cell.seconds}
              onChange={e => setCellDraft(key, saved, { state: 'set', seconds: e.target.value })}
            />
          </div>
        </TableCell>
        <TableCell>
          {eff > 0 ? <ToneBadge tone='success'>waits {eff}s</ToneBadge> : <ToneBadge tone='muted'>site default</ToneBadge>}
          {inheriting && <small className='text-muted-foreground block text-xs'>following the main sport</small>}
        </TableCell>
      </TableRow>
    )
  }

  const renderSportBody = (sport: Sport, league: League<Cell>) => (
    <div className='border-t px-3.5 py-3'>
      {(sport.leagues || []).length > 1 && (
        <LeagueTabs
          leagues={sport.leagues || []}
          active={league.key}
          badgeOf={k => {
            const l = (sport.leagues || []).find(x => x.key === k)!

            return l.is_default ? (l.configured_count ?? 0) : ownCount(l)
          }}
          onSelect={k => setOpenLeague(p => ({ ...p, [sport.sport_id]: k }))}
        />
      )}

      <div className='mb-2 flex flex-wrap items-center gap-2'>
        <small className='text-muted-foreground'>
          {league.is_default ? 'Applies to every league of this sport that has no tab of its own.' : 'Cells on Inherit follow the main sport tab.'}
        </small>
        <div className='ml-auto flex items-center gap-1.5'>
          <Input
            type='number'
            min={0}
            max={maxSeconds}
            step={0.5}
            className='h-8 w-20'
            placeholder='sec'
            value={bulkSeconds}
            onChange={e => setBulkSeconds(e.target.value)}
          />
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              const value = validSeconds(bulkSeconds)

              if (value !== null) applyToLeague(sport, league, { state: 'set', seconds: value })
            }}
          >
            Set all markets
          </Button>
          {!league.is_default && (
            <Button size='sm' variant='outline' onClick={() => applyToLeague(sport, league, { state: 'inherit' })}>
              All Inherit
            </Button>
          )}
        </div>
      </div>

      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='min-w-[230px]'>Market</TableHead>
              <TableHead className='w-[260px] text-center'>Buffer (seconds)</TableHead>
              <TableHead className='min-w-[170px]'>Effective</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedMarkets.map(group => (
              <Fragment key={`${league.key}-${group.group}`}>
                <TableRow className='bg-muted/50'>
                  <TableCell colSpan={3} className='text-muted-foreground text-xs font-medium'>
                    {group.group}
                  </TableCell>
                </TableRow>
                {group.items.map(market => renderMarketRow(sport, league, market))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader title='Buffer Time' />

      <Card>
        <CardContent className='space-y-3'>
          <p className='text-muted-foreground text-xs'>
            Seconds the bet slip tracks the live price before booking the bet. Leave 0 to keep the site default. Maximum {maxSeconds}s.
          </p>
          <p className='text-muted-foreground text-xs'>
            <b>Match Odds</b> means only the market actually named Match Odds — Over/Under, Correct Score, Match Result and Inning
            EvenOdd sit under <b>Other Main Markets</b>. A league with its own tab (Wrestling&apos;s <b>WWE Virtual</b>) can
            stay on <b>Inherit</b> to follow the main sport, or pick <b>Own</b> to give that league its own buffer.
          </p>

          <div className='flex flex-wrap items-center gap-3'>
            <Input
              type='search'
              className='h-8 max-w-[260px]'
              placeholder='Search sport or league…'
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className='ml-auto flex items-center gap-2'>
              {dirtyCount > 0 && (
                <Button size='sm' variant='secondary' disabled={saving} onClick={() => setDrafts({})}>
                  Discard
                </Button>
              )}
              <Button size='sm' disabled={dirtyCount === 0 || saving} onClick={saveAll}>
                {saving && <Loader2Icon className='animate-spin' />}
                {saving ? 'Saving…' : `Save changes${dirtyCount ? ` (${dirtyCount})` : ''}`}
              </Button>
            </div>
          </div>

          {grid.isLoading ? (
            <Note>Loading...</Note>
          ) : grid.error ? (
            <Note className='text-danger'>{errorText(grid.error)}</Note>
          ) : visibleSports.length === 0 ? (
            <Note>no records found</Note>
          ) : (
            <div className='space-y-2'>
              {visibleSports.map(sport => {
                const isOpen = openSport === sport.sport_id
                const league = leagueOf(sport)

                return (
                  <div key={sport.sport_id} className='rounded-md border'>
                    <SportHeader
                      sport={sport}
                      open={isOpen}
                      summary={sportSummary(sport)}
                      onToggle={() => setOpenSport(isOpen ? null : sport.sport_id)}
                    />
                    {isOpen && league && renderSportBody(sport, league)}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default BufferTime
