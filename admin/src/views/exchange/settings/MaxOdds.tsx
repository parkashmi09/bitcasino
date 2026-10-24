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
import { CONFIG_API, Note, ToggleGroupButtons, ToneBadge, errorText, useZip, zipApi } from './shared'
import { check } from '@/lib/validate'

/**
 * Max Odds — zip `pages/settings/MaxOdds.jsx` (sirf owner).
 *
 * Jis bet ka rate saved value se UPAR ho wo refuse: "Bet Not Accept Rate Over <max> on <Sport>".
 * Match Odds = decimal odds (1.85), Bookmaker = board ka apna scale (93 matlab 1.93).
 * Fancy pe kabhi cap nahi. 0 = koi cap nahi.
 * League rows: Inherit = sport ka cap, Own = league ka apna (0 = us league me cap nahi).
 * Cricket me "Oneday & T20 only" — Test match chhoot jaate hain.
 */

type Rule = { max_odds: number | string; limited_overs_only: boolean }
type Cell = Rule & { state?: 'set' | 'inherit'; inherited?: Rule | null }
type League = { key: string; label: string; is_default: boolean; rules?: Record<string, Cell> }
type Sport = { sport_id: number; name: string; enabled: boolean; rules?: Record<string, Cell>; leagues?: League[] }
type MaxOddsResponse = { sports?: Sport[]; categories?: string[]; max_value?: number; limited_overs_sport_id?: number }

const CATEGORY_LABELS: Record<string, string> = {
  match_odds: 'Match Odds',
  bookmaker: 'Bookmaker'
}

const EMPTY_RULE: Rule = { max_odds: 0, limited_overs_only: false }

const describe = (rule?: Rule | null) =>
  Number(rule?.max_odds) > 0 ? `max ${Number(rule!.max_odds).toFixed(2)}${rule!.limited_overs_only ? ' (Oneday & T20 only)' : ''}` : 'no limit'

const MaxOdds = () => {
  const grid = useZip<MaxOddsResponse>(`${CONFIG_API}/betting-config/max-odds/sports`)
  const sports = useMemo(() => grid.data?.sports || [], [grid.data])
  const categories = grid.data?.categories || Object.keys(CATEGORY_LABELS)
  const maxValue = grid.data?.max_value || 1000
  const limitedOversSportId = grid.data?.limited_overs_sport_id || 4
  const [search, setSearch] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Draft edits "<sportId>:<leagueKey>:<category>" → cell. Save pe hi jaate hain.
  const [drafts, setDrafts] = useState<Record<string, Cell>>({})

  // Save ke baad chupchaap refresh — table "Loading..." pe nahi jaati.
  const load = () => grid.refetch()

  const leaguesOf = (sport: Sport): League[] =>
    sport.leagues?.length ? sport.leagues : [{ key: 'default', label: 'All other leagues', is_default: true, rules: sport.rules }]

  const savedRule = (league: League, category: string): Cell =>
    league.rules?.[category] || { state: league.is_default ? 'set' : 'inherit', ...EMPTY_RULE, inherited: EMPTY_RULE }

  const cellRule = (key: string, saved: Cell) => drafts[key] ?? saved

  const isDirty = (key: string, saved: Cell) => {
    const d = drafts[key]

    if (d === undefined) return false
    if ((d.state || 'set') !== (saved.state || 'set')) return true
    if (d.state === 'inherit') return false

    return Number(d.max_odds) !== Number(saved.max_odds) || !!d.limited_overs_only !== !!saved.limited_overs_only
  }

  const setDraft = (key: string, saved: Cell, patch: Partial<Cell>) =>
    setDrafts(prev => ({ ...prev, [key]: { ...(prev[key] ?? saved), ...patch } }))

  const clearDraft = (key: string) =>
    setDrafts(prev => {
      const next = { ...prev }

      delete next[key]

      return next
    })

  const save = async (sport: Sport, league: League, category: string) => {
    const key = `${sport.sport_id}:${league.key}:${category}`
    const rule = cellRule(key, savedRule(league, category))
    const label = `${sport.name}${league.is_default ? '' : ` / ${league.label}`} — ${CATEGORY_LABELS[category] || category}`

    setSavingKey(key)

    try {
      // "Inherit" matlab row hi nahi — isliye DELETE, save nahi.
      if (!league.is_default && rule.state === 'inherit') {
        await zipApi('DELETE', `${CONFIG_API}/betting-config/max-odds/sports`, {
          sport_id: sport.sport_id,
          league_key: league.key,
          category
        })
        clearDraft(key)
        await load()
        toast.success(`${label}: follows ${sport.name}`)

        return
      }

      const maxOdds = rule.max_odds === '' ? 0 : Number(rule.max_odds)

      if (!Number.isFinite(maxOdds) || maxOdds < 0 || maxOdds > maxValue) {
        toast.error(`${label}: max odds must be between 0 and ${maxValue}`)

        return
      }

      const response = await zipApi<{ max_odds?: number; limited_overs_only?: boolean }>('POST', `${CONFIG_API}/betting-config/max-odds/sports`, {
        sport_id: sport.sport_id,
        league_key: league.key,
        category,
        max_odds: maxOdds,
        limited_overs_only: sport.sport_id === limitedOversSportId && !!rule.limited_overs_only
      })

      clearDraft(key)

      // Reload: main row badli to har inherit wali league row bhi badalti hai.
      await load()
      toast.success(`${label}: ${describe({ max_odds: Number(response.max_odds) || 0, limited_overs_only: !!response.limited_overs_only })}`)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSavingKey(null)
    }
  }

  // League ka naam bhi match ho, taaki "t10" se Cricket mile.
  const visibleSports = useMemo(() => {
    const term = search.trim().toLowerCase()

    if (!term) return sports

    return sports.filter(
      s => s.name.toLowerCase().includes(term) || (s.leagues || []).some(l => !l.is_default && l.label.toLowerCase().includes(term))
    )
  }, [sports, search])

  const renderCell = (sport: Sport, league: League, category: string) => {
    const key = `${sport.sport_id}:${league.key}:${category}`
    const saved = savedRule(league, category)
    const rule = cellRule(key, saved)
    const inheriting = !league.is_default && rule.state === 'inherit'
    const dirty = isDirty(key, saved)
    const busy = savingKey === key
    const problem = !inheriting && dirty ? check.number(rule.max_odds, 'Max odds', { min: 0, max: maxValue, optional: true }) : undefined

    return (
      <TableCell key={category} className={cn('whitespace-normal', dirty && 'bg-warning-soft')}>
        {!league.is_default && (
          <div className='mb-1'>
            <ToggleGroupButtons
              value={inheriting ? 'inherit' : 'set'}
              options={[
                { value: 'inherit', label: 'Inherit', activeClass: 'bg-info text-white' },
                { value: 'set', label: 'Own', activeClass: 'bg-primary text-primary-foreground' }
              ]}
              onChange={v => {
                if (v === 'inherit') setDraft(key, saved, { state: 'inherit' })
                else if (inheriting)
                  setDraft(key, saved, {
                    state: 'set',
                    max_odds: saved.inherited?.max_odds ?? 0,
                    limited_overs_only: !!saved.inherited?.limited_overs_only
                  })
              }}
            />
          </div>
        )}
        {inheriting ? (
          <div className='flex items-center gap-2'>
            <small className='text-muted-foreground'>
              follows {sport.name}: {describe(saved.inherited)}
            </small>
            {dirty && (
              <Button size='sm' disabled={busy} onClick={() => save(sport, league, category)}>
                {busy ? <Loader2Icon className='animate-spin' /> : 'Save'}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className='flex items-center gap-2'>
              <Input
                type='number'
                min={0}
                max={maxValue}
                step={0.01}
                className='h-8 w-[100px]'
                aria-invalid={problem ? true : undefined}
                placeholder='0 = no limit'
                value={rule.max_odds}
                onChange={e => setDraft(key, saved, { state: 'set', max_odds: e.target.value })}
              />
              <Button size='sm' disabled={!dirty || busy || Boolean(problem)} onClick={() => save(sport, league, category)}>
                {busy ? <Loader2Icon className='animate-spin' /> : 'Save'}
              </Button>
            </div>
            {problem && <small className='text-destructive mt-1 block'>{problem}</small>}
            {sport.sport_id === limitedOversSportId && (
              <label className='mt-1 flex items-center gap-2 text-xs'>
                <Checkbox
                  checked={!!rule.limited_overs_only}
                  onCheckedChange={v => setDraft(key, saved, { state: 'set', limited_overs_only: v === true })}
                />
                Oneday &amp; T20 only (Test exempt)
              </label>
            )}
          </>
        )}
      </TableCell>
    )
  }

  return (
    <div>
      <PageHeader title='Max Odds' />

      <Card>
        <CardContent className='space-y-3'>
          <p className='text-muted-foreground text-xs'>
            A bet whose rate is <b>above</b> the saved value is refused with &quot;Bet Not Accept Rate Over 100.01 on Football&quot;. 0 = no
            limit. Bookmaker uses the board&apos;s own scale (93 means 1.93). Fancy markets are never limited. For Cricket, tick{' '}
            <b>Oneday &amp; T20 only</b> to exempt Test matches — the message then reads &quot;Bet Not Accept Rate Over 4.00 on Oneday
            and T20&quot;.
          </p>
          <p className='text-muted-foreground text-xs'>
            Wrestling&apos;s <b>WWE Virtual</b> has its own row under the sport. <b>Inherit</b> follows the sport&apos;s limit; <b>Own</b> sets a separate one for that
            league (0 = no limit there).
          </p>

          <Input
            type='search'
            className='h-8 max-w-[320px]'
            placeholder='Search sport or league…'
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {grid.isLoading ? (
            <Note>Loading...</Note>
          ) : grid.error ? (
            <Note className='text-danger'>{errorText(grid.error)}</Note>
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='min-w-[200px]'>Sport / League</TableHead>
                    {categories.map(category => (
                      <TableHead key={category} className='min-w-[260px] text-center'>
                        {CATEGORY_LABELS[category] || category}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleSports.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={categories.length + 1} className='text-center'>
                        no records found
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleSports.map(sport => {
                    const leagues = leaguesOf(sport)

                    return (
                      <Fragment key={sport.sport_id}>
                        {leagues.map(league => (
                          <TableRow key={`${sport.sport_id}:${league.key}`} className={cn(!league.is_default && 'bg-muted/40')}>
                            <TableCell className='align-top'>
                              {league.is_default ? (
                                <>
                                  {sport.name} <small className='text-muted-foreground'>#{sport.sport_id}</small>
                                  {sport.enabled && (
                                    <ToneBadge tone='success' className='ml-1'>
                                      live
                                    </ToneBadge>
                                  )}
                                  {leagues.length > 1 && <small className='text-muted-foreground block text-xs'>all other leagues</small>}
                                </>
                              ) : (
                                <span className='pl-4'>↳ {league.label}</span>
                              )}
                            </TableCell>
                            {categories.map(category => renderCell(sport, league, category))}
                          </TableRow>
                        ))}
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

export default MaxOdds
