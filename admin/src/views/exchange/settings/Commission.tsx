'use client'

import { Fragment, useMemo, useState } from 'react'

import { toast } from 'sonner'

import { Loader2Icon } from 'lucide-react'

import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
 * Commission — zip `pages/settings/Commission.jsx` (sirf owner).
 *
 * User kisi sports market pe JEETE aur us cell pe commission ON ho, to settlement
 * NET win ka `percent` kaat leta hai — statement me alag "…- Comm" debit row.
 * Grid: sport → league ('default' + variants, Inherit / ON / OFF) → market.
 * OFF pe kuch nahi katta. Haar pe kabhi nahi.
 */

type RuleState = 'on' | 'off' | 'inherit'
type Rule = { state: RuleState; percent: number | string; inherited?: { state: RuleState; percent: number } | null }
type Sport = GridSport<Rule>
type CommissionResponse = { sports?: Sport[]; markets?: Market[]; max_percent?: number; default_percent?: number }

const STATE_META: Record<RuleState, { label: string; activeClass: string }> = {
  on: { label: 'ON', activeClass: 'bg-success text-white' },
  off: { label: 'OFF', activeClass: 'bg-muted-foreground text-background' },
  inherit: { label: 'Inherit', activeClass: 'bg-info text-white' }
}

const Commission = () => {
  const grid = useZip<CommissionResponse>(`${CONFIG_API}/commission-config/sports`)
  const sports = useMemo(() => grid.data?.sports || [], [grid.data])
  const markets = useMemo(() => grid.data?.markets || [], [grid.data])
  const maxPercent = grid.data?.max_percent || 50
  const defaultPercent = grid.data?.default_percent ?? 2
  const [search, setSearch] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)

  // undefined = pehla sport khula (zip jaisa), null = sab band
  const [openSportState, setOpenSport] = useState<number | null | undefined>(undefined)
  const openSport = openSportState === undefined ? (sports[0]?.sport_id ?? null) : openSportState

  // sport_id → league_key jo us sport ki tab strip me khula hai
  const [openLeague, setOpenLeague] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)

  // Draft edits "<sportId>:<leagueKey>:<marketKey>" → rule. Save pe hi jaate hain.
  const [drafts, setDrafts] = useState<Record<string, Rule>>({})

  // Save ke baad dobara load, drafts saaf.
  const load = async () => {
    await grid.refetch()
    setDrafts({})
  }

  // ── draft helpers ──
  const savedRule = (league: League<Rule>, marketKey: string): Rule =>
    league.rules?.[marketKey] || { state: 'off', percent: defaultPercent, inherited: null }

  const cellRule = (key: string, saved: Rule) => drafts[key] ?? saved

  const isDirty = (key: string, saved: Rule) => {
    const d = drafts[key]

    if (d === undefined) return false

    return d.state !== saved.state || Number(d.percent) !== Number(saved.percent)
  }

  const setDraft = (key: string, saved: Rule, patch: Partial<Rule>) =>
    setDrafts(prev => ({ ...prev, [key]: { ...(prev[key] ?? saved), ...patch } }))

  // Inheritance ke baad settlement asal me kya karega.
  const effectiveOf = (rule: Rule) => {
    if (rule.state === 'inherit') {
      const inh = rule.inherited || { state: 'off', percent: defaultPercent }

      return { on: inh.state === 'on', percent: inh.percent }
    }

    return { on: rule.state === 'on', percent: rule.percent }
  }

  // Har dirty cell ek baar.
  const dirtyCells = () => {
    const list: { sport: Sport; league: League<Rule>; market: Market; rule: Rule }[] = []

    for (const sport of sports) {
      for (const league of sport.leagues || []) {
        for (const market of markets) {
          const key = cellKey(sport.sport_id, league.key, market.key)
          const saved = savedRule(league, market.key)

          if (isDirty(key, saved)) list.push({ sport, league, market, rule: cellRule(key, saved) })
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

    for (const { sport, league, market, rule } of dirtyCells()) {
      const percent = Number(rule.percent)

      if (!Number.isFinite(percent) || percent < 0 || percent > maxPercent) {
        toast.error(`${sport.name} — ${market.label}: percent must be 0–${maxPercent}`)

        return
      }

      const payload = { sport_id: sport.sport_id, league_key: league.key, market_key: market.key }

      // "Inherit" matlab row hi nahi — isliye DELETE, save nahi.
      if (rule.state === 'inherit') resets.push(payload)
      else items.push({ ...payload, enabled: rule.state === 'on', percent })
    }

    if (!items.length && !resets.length) return

    setSaving(true)

    try {
      for (const payload of resets) await zipApi('DELETE', `${CONFIG_API}/commission-config/sports`, payload)
      if (items.length) await zipApi('POST', `${CONFIG_API}/commission-config/sports/bulk`, { items })
      toast.success(`Saved ${items.length + resets.length} cell(s)`)
      await load()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  // Dikh rahi league ke har market ko ek saath set karo.
  const applyToLeague = (sport: Sport, league: League<Rule>, state: RuleState) => {
    setDrafts(prev => {
      const next = { ...prev }

      for (const market of markets) {
        const key = cellKey(sport.sport_id, league.key, market.key)

        next[key] = { ...(next[key] ?? savedRule(league, market.key)), state }
      }

      return next
    })
  }

  const visibleSports = useMemo(() => {
    const term = search.trim().toLowerCase()
    let list = sports

    if (term) list = list.filter(s => s.name.toLowerCase().includes(term))
    if (onlyActive) list = list.filter(s => (s.leagues || []).some(l => (l.active_count ?? 0) > 0))

    return list
  }, [sports, search, onlyActive])

  const leagueOf = (sport: Sport) => {
    const wanted = openLeague[sport.sport_id]

    return (sport.leagues || []).find(l => l.key === wanted) || sport.leagues?.[0]
  }

  // Band sport header pe "kya ON hai" ki chhoti line.
  const sportSummary = (sport: Sport) => {
    const parts = []

    for (const league of sport.leagues || []) {
      const on = markets.filter(m => effectiveOf(savedRule(league, m.key)).on).map(m => m.label)

      if (!on.length) continue
      const text = on.length > 2 ? `${on.slice(0, 2).join(', ')} +${on.length - 2}` : on.join(', ')

      parts.push(league.is_default ? text : `${league.label}: ${text}`)
    }

    return parts.length ? parts.join(' · ') : 'No commission'
  }

  const groupedMarkets = useMemo(() => groupMarkets(markets), [markets])

  const renderMarketRow = (sport: Sport, league: League<Rule>, market: Market) => {
    const key = cellKey(sport.sport_id, league.key, market.key)
    const saved = savedRule(league, market.key)
    const rule = cellRule(key, saved)
    const eff = effectiveOf(rule)
    const states: RuleState[] = league.is_default ? ['on', 'off'] : ['inherit', 'on', 'off']

    return (
      <TableRow key={key} className={cn(isDirty(key, saved) && 'bg-warning-soft')}>
        <TableCell className='whitespace-normal'>
          <div>{market.label}</div>
          {market.hint && <small className='text-muted-foreground text-xs'>{market.hint}</small>}
        </TableCell>
        <TableCell className='text-center'>
          <ToggleGroupButtons
            value={rule.state}
            options={states.map(st => ({ value: st, ...STATE_META[st] }))}
            onChange={st => setDraft(key, saved, { state: st as RuleState })}
          />
        </TableCell>
        <TableCell>
          <div className='flex items-center justify-center gap-1'>
            <Input
              type='number'
              min={0}
              max={maxPercent}
              step={0.5}
              className='h-8 w-20'
              disabled={rule.state !== 'on'}
              aria-invalid={rule.state === 'on' && check.number(rule.percent, 'Percent', { min: 0, max: maxPercent }) ? true : undefined}
              value={rule.percent}
              onChange={e => setDraft(key, saved, { percent: e.target.value })}
            />
            <span>%</span>
          </div>
        </TableCell>
        <TableCell>
          {eff.on ? (
            <ToneBadge tone='success'>charges {eff.percent}% of net win</ToneBadge>
          ) : (
            <ToneBadge tone='muted'>no commission</ToneBadge>
          )}
          {rule.state === 'inherit' && <small className='text-muted-foreground block text-xs'>following the main sport</small>}
        </TableCell>
      </TableRow>
    )
  }

  const renderSportBody = (sport: Sport, league: League<Rule>) => (
    <div className='border-t px-3.5 py-3'>
      {(sport.leagues || []).length > 1 && (
        <LeagueTabs
          leagues={sport.leagues || []}
          active={league.key}
          badgeOf={k => (sport.leagues || []).find(l => l.key === k)?.active_count ?? 0}
          onSelect={k => setOpenLeague(p => ({ ...p, [sport.sport_id]: k }))}
        />
      )}

      <div className='mb-2 flex flex-wrap items-center gap-2'>
        <small className='text-muted-foreground'>
          {league.is_default ? 'Applies to every league of this sport that has no tab of its own.' : 'Cells on Inherit follow the main sport tab.'}
        </small>
        <div className='ml-auto flex gap-1'>
          <Button size='sm' variant='outline' onClick={() => applyToLeague(sport, league, 'on')}>
            All ON
          </Button>
          <Button size='sm' variant='outline' onClick={() => applyToLeague(sport, league, 'off')}>
            All OFF
          </Button>
          {!league.is_default && (
            <Button size='sm' variant='outline' onClick={() => applyToLeague(sport, league, 'inherit')}>
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
              <TableHead className='w-[210px] text-center'>Commission</TableHead>
              <TableHead className='w-[130px] text-center'>Percent</TableHead>
              <TableHead className='min-w-[190px]'>Effective</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedMarkets.map(group => (
              <Fragment key={`${league.key}-${group.group}`}>
                <TableRow className='bg-muted/50'>
                  <TableCell colSpan={4} className='text-muted-foreground text-xs font-medium'>
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
      <PageHeader title='Commission' />

      <Card>
        <CardContent className='space-y-3'>
          <p className='text-muted-foreground text-xs'>
            Commission is deducted from a user&apos;s <b>net win</b> on a settled market when the cell is ON, and shown in the account
            statement as a separate &quot;- Comm&quot; debit row. Losses are never charged. Maximum {maxPercent}%.
          </p>
          <p className='text-muted-foreground text-xs'>
            <b>Match Odds</b> means only the market actually named Match Odds — Over/Under, Correct Score, Match Result and Inning
            EvenOdd sit under <b>Other Main Markets</b>. A league with its own tab (Wrestling&apos;s <b>WWE Virtual</b>) can
            stay on <b>Inherit</b> to follow the main sport, or be set ON/OFF to charge it differently.
          </p>

          <div className='flex flex-wrap items-center gap-3'>
            <Input
              type='search'
              className='h-8 max-w-[260px]'
              placeholder='Search sport…'
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox checked={onlyActive} onCheckedChange={v => setOnlyActive(v === true)} />
              Only sports with commission ON
            </label>
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

export default Commission
