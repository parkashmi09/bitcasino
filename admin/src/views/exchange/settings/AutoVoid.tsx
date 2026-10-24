'use client'

import { Fragment, useEffect, useState, type FormEvent } from 'react'

import Link from 'next/link'

import { toast } from 'sonner'

import { Loader2Icon } from 'lucide-react'

import ConfirmDialog from '@/components/shared/ConfirmDialog'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { CONFIG_API, ToneBadge, errorText, useZip, zipApi, type Tone } from './shared'
import { check } from '@/lib/validate'

/**
 * Auto Void — zip `pages/settings/AutoVoid.jsx` (sirf owner).
 *
 * Feed ne event ka Match Odds ya Bookmaker declare kar diya, to results cron neeche
 * wala delay rukta hai, phir us event ki har bet jo abhi bhi open hai aur jiska
 * apna result nahi aaya, void ho jaati hai (Settlement → Void Market jaisa:
 * exposure free, stake wapas). Default OFF.
 * Niche Pending Result Tracker aur Result Source Links bhi, zip jaise.
 */

const AUTO_VOID_API = `${CONFIG_API}/betting-config/auto-void`
const TRACKER_POLL_MS = 15000
const URGENT_SEC = 600

// Sport etid → naam (zip `config/sportsList.js`)
const SPORTS_LIST: [string, string][] = [
  ['1', 'Football'], ['2', 'Tennis'], ['3', 'Mixed Martial Arts'], ['4', 'Cricket'],
  ['5', 'Golf'], ['6', 'Boxing'], ['7', 'Beach Volleyball'], ['8', 'Table Tennis'],
  ['9', 'Futsal'], ['10', 'Horse Racing'], ['15', 'Basketball'],
  ['16', 'MotoGP'], ['17', 'Chess'], ['18', 'Volleyball'], ['19', 'Ice Hockey'],
  ['22', 'Badminton'], ['25', 'Hockey'], ['29', 'Cycling'], ['32', 'Motorbikes'],
  ['33', 'Athletics'], ['35', 'Basketball 3X3'], ['37', 'Sumo'], ['38', 'Virtual sports'],
  ['39', 'Handball'], ['52', 'Motor Sports'], ['53', 'Baseball'],
  ['54', 'Rugby Union'], ['55', 'Rugby League'], ['57', 'Darts'], ['58', 'American Football'],
  ['59', 'Snooker'], ['62', 'Soccer'], ['64', 'Esports'], ['65', 'Greyhound Racing'],
  ['66', 'Kabaddi'], ['67', 'Boat Racing'], ['68', 'Esoccer'], ['69', 'Wrestling']
]

type Settings = {
  enabled: boolean
  delay_seconds: number
  on_match_odds: boolean
  on_bookmaker: boolean
  min_delay_seconds?: number
  max_delay_seconds?: number
}

type ResultLink = { id: number; name: string; url: string; sport_id: string | null; sort_order?: number; active?: boolean }

type TrackerBet = {
  id: number
  username?: string
  user_id?: number
  bet_type?: string
  selection_name?: string
  odds: number | string
  stake: number
  status?: string
  unmatched?: boolean
  created_at?: string
}

type TrackerMarket = {
  match_id: string
  market_type: string
  market_name: string
  game_type?: string
  bet_count: number
  users: number
  manual_count: number
  total_stake: number
  bets: TrackerBet[]
}

type TrackerEvent = {
  eventid: string
  sport_id?: string | number
  match_title?: string
  anchor_market?: string
  anchor_status?: string
  anchor_seen_at?: string
  void_at: string
  last_error?: string
  bet_count: number
  manual_count: number
  users: number
  total_stake: number
  markets: TrackerMarket[]
}

type Tracker = { enabled: boolean; server_time: string; events: TrackerEvent[]; links?: ResultLink[] }

// ── chhote formatters ──
const fmtDelay = (sec: number | string) => {
  const s = Number(sec) || 0
  const m = Math.floor(s / 60)
  const r = s % 60

  if (!m) return `${r} sec`

  return r ? `${m} min ${r} sec` : `${m} min`
}

const fmtLeft = (sec: number) => {
  const s = Math.abs(Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

const fmtTime = (t?: string) => (t ? new Date(t).toLocaleString('en-IN', { hour12: false }) : '-')
const fmtAmt = (n: number | string) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

// ── ek open market ke liye "kya dhoondna hai" ──
// Fancy Settlement jaise har market family declare hoti hai, waisa hi.
const RUN_MARKETS = new Set(['Normal', 'Over By Over', 'Ball By Ball', 'khado', 'meter'])
const isLineMarket = (t?: string) => /\bline$/i.test(String(t || '').trim())

type Kind = 'runs' | 'yesno' | 'oddeven' | 'winner'

const KINDS: Record<Kind, { order: number; title: string; hint: string; tone: Tone }> = {
  runs: {
    order: 1,
    title: 'Find the final RUNS / number',
    hint: 'Look up the final figure (runs, wickets, boundaries...) and enter that number when you declare.',
    tone: 'info'
  },
  yesno: { order: 2, title: 'Find if it HAPPENED - Yes or No', hint: 'Did the event in the market name happen? Declare Yes or No.', tone: 'info' },
  oddeven: { order: 3, title: 'Find ODD or EVEN', hint: 'Look up the final runs. Odd = declare Yes, Even = declare No.', tone: 'info' },
  winner: { order: 4, title: 'Find the WINNER', hint: 'Look up which option won and pick it when you declare.', tone: 'muted' }
}

const marketKind = (m: TrackerMarket): Kind => {
  if (m.market_type === 'fancy1') return 'yesno'
  if (m.market_type === 'oddeven') return 'oddeven'
  if (m.game_type === 'FAN' && (RUN_MARKETS.has(m.market_type) || isLineMarket(m.market_type))) return 'runs'

  return 'winner'
}

// Line markets ka runner generic hota hai ("Total Runs") — naam market type hi hai.
const marketTitle = (m: TrackerMarket) => (isLineMarket(m.market_type) ? m.market_type : m.market_name)

// Fancy markets Fancy Settlement me (market type ke tab me), baaki Match Settlement me.
const whereToDeclare = (m: TrackerMarket) =>
  m.game_type === 'FAN'
    ? { to: '/exchange/settlement?tab=fancy', text: `Fancy Settlement → ${m.market_type} tab` }
    : { to: '/exchange/settlement', text: 'Match Settlement' }

// Bets kin positions pe hain — taaki team ko pata ho kaunse number maayne rakhte hain.
const positions = (m: TrackerMarket, kind: Kind) => {
  const map = new Map<string, { label: string; bets: number; stake: number }>()

  for (const b of m.bets) {
    const side = String(b.bet_type || '').toLowerCase()
    let label

    if (kind === 'runs') label = side === 'no' ? `NO under ${b.odds}` : `YES ${b.odds}+`
    else if (kind === 'winner' && m.game_type !== 'FAN') label = `${b.selection_name} (${side})`
    else label = `${side.toUpperCase()} @ ${b.odds}`
    const cur = map.get(label) || { label, bets: 0, stake: 0 }

    cur.bets++
    cur.stake += b.stake
    map.set(label, cur)
  }

  return [...map.values()]
}

// Result Source Links: {match} / {market} me event aur market ka naam bharta hai.
const fillUrl = (url: string, ev: TrackerEvent, m?: TrackerMarket) =>
  url.replace(/\{match\}/g, encodeURIComponent(ev.match_title || '')).replace(/\{market\}/g, encodeURIComponent(m ? marketTitle(m) : ''))

const isMarketLink = (l: ResultLink) => l.url.includes('{market}')

const linksForSport = (links: ResultLink[] | undefined, sportId?: string | number) =>
  (links || []).filter(l => !l.sport_id || String(l.sport_id) === String(sportId))

const sportName = (id: string | number) => (SPORTS_LIST.find(([sid]) => sid === String(id)) || [null, 'All sports'])[1]

// ── ek event ki checklist (tracker row kholne pe) ──
const ResultChecklist = ({ ev, autoVoidOn, links }: { ev: TrackerEvent; autoVoidOn: boolean; links?: ResultLink[] }) => {
  const sportLinks = linksForSport(links, ev.sport_id)
  const eventLinks = sportLinks.filter(l => !isMarketLink(l))
  const marketLinks = sportLinks.filter(isMarketLink)
  const [showBets, setShowBets] = useState<Record<string, boolean>>({})

  const items = ev.markets
    .map(m => ({ m, kind: marketKind(m) }))
    .sort((a, b) => KINDS[a.kind].order - KINDS[b.kind].order || b.m.total_stake - a.m.total_stake)

  const groups: { kind: Kind; items: typeof items }[] = []

  for (const it of items) {
    const g = groups[groups.length - 1]

    if (g && g.kind === it.kind) g.items.push(it)
    else groups.push({ kind: it.kind, items: [it] })
  }

  return (
    <div className='bg-muted/40 space-y-3 p-3 whitespace-normal'>
      <Alert className='border-warning bg-warning-soft'>
        <AlertDescription className='text-foreground'>
          <span>
            <b>
              {ev.markets.length} result{ev.markets.length === 1 ? '' : 's'} to find
            </b>{' '}
            for <b>{ev.match_title || ev.eventid}</b>. Find each result below and declare it
            {autoVoidOn ? (
              <>
                {' '}
                before <b>{fmtTime(ev.void_at)}</b>. Anything still open then is refunded to the players.
              </>
            ) : (
              <>. Auto Void is OFF, so these bets stay open until someone declares or voids them.</>
            )}
          </span>
        </AlertDescription>
      </Alert>

      {eventLinks.length > 0 && (
        <div className='flex flex-wrap items-center gap-2'>
          <b>Look it up:</b>
          {eventLinks.map(l => (
            <Button key={l.id} size='sm' variant='outline' render={<a href={fillUrl(l.url, ev)} target='_blank' rel='noopener noreferrer' />} nativeButton={false}>
              {l.name} ↗
            </Button>
          ))}
        </div>
      )}

      {groups.map(g => {
        const k = KINDS[g.kind]

        return (
          <div key={g.kind}>
            <h6 className='mb-1 flex items-center gap-2 font-medium'>
              <ToneBadge tone={k.tone}>{g.items.length}</ToneBadge>
              {k.title}
            </h6>
            <div className='text-muted-foreground mb-2 text-xs'>{k.hint}</div>
            <div className='bg-background rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[3%]'>#</TableHead>
                    <TableHead className='w-[30%]'>Market (what to look up)</TableHead>
                    <TableHead>Bets placed on</TableHead>
                    <TableHead className='w-[8%] text-right'>Stake</TableHead>
                    {marketLinks.length > 0 && <TableHead className='w-[10%]'>Search</TableHead>}
                    <TableHead className='w-[22%]'>Declare in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.items.map(({ m }, i) => {
                    const key = `${m.match_id}|${m.market_type}|${m.market_name}`
                    const where = whereToDeclare(m)
                    const shown = !!showBets[key]

                    return (
                      <Fragment key={key}>
                        <TableRow>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className='whitespace-normal'>
                            <div className='font-semibold'>{marketTitle(m)}</div>
                            <button
                              type='button'
                              className='text-primary text-xs hover:underline'
                              onClick={() => setShowBets(o => ({ ...o, [key]: !o[key] }))}
                            >
                              {shown ? 'Hide' : 'Show'} {m.bet_count} bet{m.bet_count === 1 ? '' : 's'} ({m.users} user{m.users === 1 ? '' : 's'})
                            </button>
                            {m.manual_count > 0 && (
                              <ToneBadge tone='muted' className='ml-2'>
                                {m.manual_count} manual
                              </ToneBadge>
                            )}
                          </TableCell>
                          <TableCell className='whitespace-normal'>
                            {positions(m, g.kind).map(p => (
                              <span key={p.label} className='mr-1 mb-1 inline-block rounded border px-2 py-1 text-xs'>
                                {p.label}
                                {p.bets > 1 && <span className='text-muted-foreground'> ×{p.bets}</span>}
                              </span>
                            ))}
                          </TableCell>
                          <TableCell className='text-right'>{fmtAmt(m.total_stake)}</TableCell>
                          {marketLinks.length > 0 && (
                            <TableCell>
                              {marketLinks.map(l => (
                                <Button
                                  key={l.id}
                                  size='xs'
                                  variant='outline'
                                  className='mr-1 mb-1'
                                  title={`Search "${ev.match_title} ${marketTitle(m)}"`}
                                  render={<a href={fillUrl(l.url, ev, m)} target='_blank' rel='noopener noreferrer' />}
                                >
                                  {l.name} ↗
                                </Button>
                              ))}
                            </TableCell>
                          )}
                          <TableCell>
                            <Link href={where.to} className='text-primary hover:underline'>
                              {where.text}
                            </Link>
                          </TableCell>
                        </TableRow>
                        {shown && (
                          <TableRow>
                            <TableCell />
                            <TableCell colSpan={marketLinks.length > 0 ? 5 : 4} className='p-0'>
                              <Table className='text-xs'>
                                <TableBody>
                                  {m.bets.map(b => (
                                    <TableRow key={b.id}>
                                      <TableCell className='text-muted-foreground'>#{b.id}</TableCell>
                                      <TableCell>{b.username || b.user_id}</TableCell>
                                      <TableCell>
                                        {String(b.bet_type || '').toUpperCase()}
                                        {b.unmatched ? ' (unmatched)' : ''}
                                      </TableCell>
                                      <TableCell>
                                        {g.kind === 'winner' ? b.selection_name : ''} {b.odds}
                                      </TableCell>
                                      <TableCell className='text-right'>{fmtAmt(b.stake)}</TableCell>
                                      <TableCell>{b.status}</TableCell>
                                      <TableCell className='text-muted-foreground'>{fmtTime(b.created_at)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Pending Result Tracker ──
// Har event jiska Match Odds / Bookmaker declare ho chuka par bets abhi bhi unsettled hain.
// Countdown khatam hone se pehle team result dhoonde; uske baad Auto Void refund kar deta hai.
const PendingResultTracker = () => {
  // Har 15 s apne aap refresh.
  const tracker = useZip<{ data: Tracker }>(`${AUTO_VOID_API}/tracker`, undefined, { refetchInterval: TRACKER_POLL_MS })
  const data = tracker.data?.data ?? null
  const error = tracker.error ? errorText(tracker.error) : null
  const load = () => void tracker.refetch()
  const [open, setOpen] = useState<Record<string, boolean>>({})

  // Har second ghadi aage — countdown ke liye.
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    const tick = setInterval(() => setClock(Date.now()), 1000)

    return () => clearInterval(tick)
  }, [])

  const events = data?.events || []

  // server ki ghadi − browser ki ghadi (fetch ke waqt), ms
  const skew = data ? new Date(data.server_time).getTime() - tracker.dataUpdatedAt : 0
  const now = clock + skew
  const secsLeft = (ev: TrackerEvent) => (new Date(ev.void_at).getTime() - now) / 1000

  const rowState = (ev: TrackerEvent): { cls: string; tone: Tone; text: string } => {
    if (ev.manual_count === ev.bet_count) return { cls: 'bg-muted', tone: 'muted', text: 'MANUAL - settle by hand' }
    if (!data?.enabled) return { cls: 'bg-muted', tone: 'muted', text: 'AUTO VOID OFF' }
    const left = secsLeft(ev)

    if (left <= 0) return { cls: 'bg-danger-soft', tone: 'danger', text: 'VOIDING NOW' }
    if (left <= URGENT_SEC) return { cls: 'bg-danger-soft', tone: 'danger', text: `${fmtLeft(left)} left` }

    return { cls: 'bg-warning-soft', tone: 'warning', text: `${fmtLeft(left)} left` }
  }

  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between'>
        <CardTitle className='flex items-center gap-2'>
          Pending Result Tracker <ToneBadge tone={events.length ? 'danger' : 'success'}>{events.length}</ToneBadge>
        </CardTitle>
        <Button size='sm' variant='outline' onClick={load}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-muted-foreground text-sm'>
          Match Odds / Bookmaker already declared, but these bets still have no result. Find the result and settle them in{' '}
          <Link href='/exchange/settlement?tab=fancy' className='text-primary hover:underline'>
            Fancy
          </Link>{' '}
          /{' '}
          <Link href='/exchange/settlement' className='text-primary hover:underline'>
            Match
          </Link>{' '}
          Settlement before the countdown ends
          {data?.enabled ? ', or Auto Void will refund them.' : '. Auto Void is OFF, so nothing will void them.'} Refreshes every 15 s.
        </p>

        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!data ? (
          <p className='text-muted-foreground text-sm'>Loading…</p>
        ) : !events.length ? (
          <p className='text-success text-sm'>All clear: no declared event has unsettled bets.</p>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Declared</TableHead>
                  <TableHead>First seen</TableHead>
                  <TableHead>Void at</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Results to find</TableHead>
                  <TableHead className='text-right'>Bets</TableHead>
                  <TableHead className='text-right'>Users</TableHead>
                  <TableHead className='text-right'>Stake</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map(ev => {
                  const st = rowState(ev)
                  const isOpen = !!open[ev.eventid]

                  return (
                    <Fragment key={ev.eventid}>
                      <TableRow className={cn('cursor-pointer', st.cls)} onClick={() => setOpen(o => ({ ...o, [ev.eventid]: !o[ev.eventid] }))}>
                        <TableCell>
                          <b>
                            {isOpen ? '▾' : '▸'} {ev.match_title || ev.eventid}
                          </b>
                          <div className='text-muted-foreground text-xs'>event {ev.eventid}</div>
                          {ev.last_error && <div className='text-danger text-xs'>last void error: {ev.last_error}</div>}
                        </TableCell>
                        <TableCell>
                          {ev.anchor_market === 'BOOKMAKER' ? 'Bookmaker' : 'Match Odds'} ({ev.anchor_status})
                        </TableCell>
                        <TableCell>{fmtTime(ev.anchor_seen_at)}</TableCell>
                        <TableCell>{fmtTime(ev.void_at)}</TableCell>
                        <TableCell>
                          <ToneBadge tone={st.tone}>{st.text}</ToneBadge>
                          {ev.manual_count > 0 && ev.manual_count < ev.bet_count && (
                            <div className='text-xs'>{ev.manual_count} manual - settle by hand</div>
                          )}
                        </TableCell>
                        <TableCell className='text-right'>{ev.markets.length}</TableCell>
                        <TableCell className='text-right'>{ev.bet_count}</TableCell>
                        <TableCell className='text-right'>{ev.users}</TableCell>
                        <TableCell className='text-right'>{fmtAmt(ev.total_stake)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={9} className='p-0'>
                            <ResultChecklist ev={ev} autoVoidOn={!!data?.enabled} links={data?.links} />
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
  )
}

// ── Result Source Links — tracker ki look-up sites (Cricbuzz, Flashscore...) ──
type LinkForm = { name: string; url: string; sport_id: string; sort_order: number | string; active: boolean }

const EMPTY_LINK: LinkForm = { name: '', url: '', sport_id: '', sort_order: 0, active: true }

const ResultLinksManager = () => {
  const links = useZip<{ data: ResultLink[] }>(`${AUTO_VOID_API}/links`)
  const rows = links.data?.data || []
  const [form, setForm] = useState<LinkForm>(EMPTY_LINK)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => links.refetch()

  const set = (patch: Partial<LinkForm>) => {
    setForm(f => ({ ...f, ...patch }))
    setErrors(prev => {
      const next = { ...prev }

      for (const k of Object.keys(patch)) delete next[k as keyof typeof next]

      return next
    })
  }

  const reset = () => {
    setForm(EMPTY_LINK)
    setEditId(null)
    setErrors({})
  }

  // Server rules (`linkPayload`): name 1–60 chars, URL http(s)://… without spaces, ≤ 1000 chars.
  const [errors, setErrors] = useState<{ name?: string; url?: string; sort_order?: string }>({})

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()

    const url = form.url.trim()

    const next = {
      name: check.required(form.name, 'Name') || check.length(form.name, 'Name', { max: 60 }),
      url: !url ? 'URL is required' : !/^https?:\/\/[^\s]+$/i.test(url) ? 'URL must start with http:// or https:// and have no spaces' : check.length(url, 'URL', { max: 1000 }),
      sort_order: check.number(form.sort_order, 'Order', { integer: true, optional: true })
    }

    setErrors(next)
    const first = next.name || next.url || next.sort_order

    if (first) {
      toast.error(first)

      return
    }

    setSaving(true)

    try {
      const payload = { ...form, sport_id: form.sport_id || null, sort_order: Number(form.sort_order) || 0 }

      const r = editId
        ? await zipApi<{ message?: string }>('PUT', `${AUTO_VOID_API}/links/${editId}`, payload)
        : await zipApi<{ message?: string }>('POST', `${AUTO_VOID_API}/links`, payload)

      toast.success(r.message || (editId ? 'Link saved' : 'Link added'))
      reset()
      void load()
    } catch (e2) {
      toast.error(errorText(e2))
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (l: ResultLink) => {
    setEditId(l.id)
    setForm({ name: l.name, url: l.url, sport_id: l.sport_id || '', sort_order: l.sort_order ?? 0, active: !!l.active })
  }

  const [togglingId, setTogglingId] = useState<number | null>(null)

  const handleToggle = async (l: ResultLink) => {
    setTogglingId(l.id)

    try {
      await zipApi('PUT', `${AUTO_VOID_API}/links/${l.id}`, { active: !l.active })
      toast.success(`${l.name} turned ${l.active ? 'off' : 'on'}`)
      void load()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setTogglingId(null)
    }
  }

  // No catch: ConfirmDialog stays open and toasts the server's message.
  const handleDelete = async (l: ResultLink) => {
    await zipApi('DELETE', `${AUTO_VOID_API}/links/${l.id}`)
    toast.success(`Link "${l.name}" deleted`)
    if (editId === l.id) reset()
    void load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Result Source Links</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-muted-foreground text-sm'>
          Websites the team opens from the tracker to find results. Put <code>{'{match}'}</code> in the URL to insert the event name, and{' '}
          <code>{'{market}'}</code> for the market name. A link with <code>{'{market}'}</code> shows on every market row (e.g.{' '}
          <code>{'https://www.google.com/search?q={match}+{market}'}</code>); the rest show once per event.
        </p>

        <form onSubmit={handleSave} className='grid items-end gap-3 md:grid-cols-12'>
          <div className='space-y-1 md:col-span-2'>
            <Label className='text-xs'>Name</Label>
            <Input value={form.name} onChange={e => set({ name: e.target.value })} maxLength={60} placeholder='Cricbuzz' required aria-invalid={errors.name ? true : undefined} />
            {errors.name && <p className='text-destructive text-xs'>{errors.name}</p>}
          </div>
          <div className='space-y-1 md:col-span-4'>
            <Label className='text-xs'>URL</Label>
            <Input value={form.url} onChange={e => set({ url: e.target.value })} placeholder='https://www.cricbuzz.com/...' required aria-invalid={errors.url ? true : undefined} />
            {errors.url && <p className='text-destructive text-xs'>{errors.url}</p>}
          </div>
          <div className='space-y-1 md:col-span-2'>
            <Label className='text-xs'>Sport</Label>
            <Select value={form.sport_id || 'all'} onValueChange={v => set({ sport_id: !v || v === 'all' ? '' : String(v) })}>
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All sports</SelectItem>
                {SPORTS_LIST.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1 md:col-span-1'>
            <Label className='text-xs'>Order</Label>
            <Input type='number' step={1} value={form.sort_order} onChange={e => set({ sort_order: e.target.value })} aria-invalid={errors.sort_order ? true : undefined} />
            {errors.sort_order && <p className='text-destructive text-xs'>{errors.sort_order}</p>}
          </div>
          <label className='flex h-9 items-center gap-2 text-xs md:col-span-1'>
            <Checkbox checked={form.active} onCheckedChange={v => set({ active: v === true })} />
            Active
          </label>
          <div className='flex gap-1 md:col-span-2'>
            <Button type='submit' size='sm' disabled={saving}>
              {saving && <Loader2Icon className='animate-spin' />}
              {editId ? 'Save' : 'Add link'}
            </Button>
            {editId && (
              <Button type='button' size='sm' variant='outline' onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>

        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Sport</TableHead>
                <TableHead>Shows</TableHead>
                <TableHead className='text-right'>Order</TableHead>
                <TableHead>Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.error ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-danger'>
                    Could not load links: {errorText(links.error)}
                  </TableCell>
                </TableRow>
              ) : (
                !rows.length && (
                  <TableRow>
                    <TableCell colSpan={7} className='text-muted-foreground'>
                      {links.isLoading ? 'Loading…' : 'No links yet.'}
                    </TableCell>
                  </TableRow>
                )
              )}
              {rows.map(l => (
                <TableRow key={l.id} className={cn(!l.active && 'text-muted-foreground')}>
                  <TableCell>
                    <b>{l.name}</b>
                  </TableCell>
                  <TableCell className='text-xs break-all whitespace-normal'>{l.url}</TableCell>
                  <TableCell>{l.sport_id ? sportName(l.sport_id) : 'All sports'}</TableCell>
                  <TableCell>{isMarketLink(l) ? 'Each market' : 'Each event'}</TableCell>
                  <TableCell className='text-right'>{l.sort_order}</TableCell>
                  <TableCell>
                    <Button
                      size='sm'
                      variant={l.active ? 'default' : 'outline'}
                      className={cn(l.active && 'bg-success hover:bg-success/80 text-white')}
                      disabled={togglingId === l.id}
                      onClick={() => handleToggle(l)}
                    >
                      {l.active ? 'On' : 'Off'}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className='flex gap-1'>
                      <Button size='sm' variant='outline' onClick={() => handleEdit(l)}>
                        Edit
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button size='sm' variant='destructive'>
                            Delete
                          </Button>
                        }
                        title={`Delete "${l.name}"?`}
                        confirmLabel='Delete'
                        destructive
                        onConfirm={() => handleDelete(l)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Auto Void Settings form ──
// Server ki values se shuru hota hai; save ke baad page dobara load karke naya form deta hai.
const SettingsForm = ({ current, onSaved }: { current: Settings; onSaved: () => Promise<unknown> }) => {
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(!!current.enabled)
  const [delay, setDelay] = useState<number | string>(Number(current.delay_seconds) || 600)
  const [onMatchOdds, setOnMatchOdds] = useState(!!current.on_match_odds)
  const [onBookmaker, setOnBookmaker] = useState(!!current.on_bookmaker)
  const bounds = { min: current.min_delay_seconds ?? 30, max: current.max_delay_seconds ?? 86400 }

  // "Turn Auto Void on?" wala confirm
  const [confirmOn, setConfirmOn] = useState(false)

  const save = async () => {
    setSaving(true)

    try {
      const response = await zipApi<{ message?: string }>('PUT', AUTO_VOID_API, {
        enabled,
        delay_seconds: Number(delay),
        on_match_odds: onMatchOdds,
        on_bookmaker: onBookmaker
      })

      toast.success(response.message || 'Auto void settings saved')
      await onSaved()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  const delayError = check.number(delay, 'Delay', { integer: true, min: bounds.min, max: bounds.max })

  const handleSave = (e: FormEvent) => {
    e.preventDefault()

    if (delayError) {
      toast.error(`${delayError} (${bounds.min}–${bounds.max} seconds)`)

      return
    }

    if (enabled && !onMatchOdds && !onBookmaker) {
      toast.error('Pick at least one market to start the timer')

      return
    }

    // OFF se ON ho raha hai to pehle confirm
    if (enabled && !current.enabled) {
      setConfirmOn(true)

      return
    }

    void save()
  }

  return (
    <form onSubmit={handleSave} className='space-y-4'>
      <label className='flex items-center gap-2 text-sm'>
        <Switch checked={enabled} onCheckedChange={v => setEnabled(v)} />
        Enable auto void
      </label>

      <div className='space-y-1'>
        <Label htmlFor='autoVoidDelay'>Void after (seconds)</Label>
        <div className='flex items-center'>
          <Input
            id='autoVoidDelay'
            type='number'
            className='rounded-r-none'
            min={bounds.min}
            max={bounds.max}
            step={1}
            value={delay}
            aria-invalid={delayError ? true : undefined}
            onChange={e => setDelay(e.target.value)}
          />
          <span className='bg-muted flex h-9 items-center rounded-r-md border border-l-0 px-3 text-sm whitespace-nowrap'>
            = {fmtDelay(delay)}
          </span>
        </div>
        {delayError && <p className='text-destructive text-xs'>{delayError}</p>}
        <small className='text-muted-foreground block text-xs'>
          Counted from the moment the results cron first sees the Match Odds / Bookmaker result. Allowed {bounds.min}–{bounds.max} seconds
          (600 = 10 minutes).
        </small>
      </div>

      <div className='space-y-1'>
        <Label>Start the timer when the feed declares</Label>
        <div className='flex gap-4'>
          <label className='flex items-center gap-2 text-sm'>
            <Checkbox checked={onMatchOdds} onCheckedChange={v => setOnMatchOdds(v === true)} />
            Match Odds
          </label>
          <label className='flex items-center gap-2 text-sm'>
            <Checkbox checked={onBookmaker} onCheckedChange={v => setOnBookmaker(v === true)} />
            Bookmaker
          </label>
        </div>
        <small className='text-muted-foreground block text-xs'>Whichever ticked market the feed settles (or voids) first starts the clock.</small>
      </div>

      <Button type='submit' disabled={saving}>
        {saving && <Loader2Icon className='animate-spin' />}
        {saving ? 'Saving…' : 'Save'}
      </Button>

      <Dialog open={confirmOn} onOpenChange={setConfirmOn}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn Auto Void on?</DialogTitle>
            <DialogDescription>
              Open bets with no result will be voided <b>{fmtDelay(Number(delay))}</b> after Match Odds / Bookmaker is declared. Stakes go back
              to the players.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirmOn(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmOn(false)
                void save()
              }}
            >
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}

// ── page ──
const AutoVoid = () => {
  const settings = useZip<{ data: Settings }>(AUTO_VOID_API)
  const current = settings.data?.data

  return (
    <div className='space-y-6'>
      <PageHeader
        title='Auto Void'
        actions={current && <ToneBadge tone={current.enabled ? 'success' : 'muted'}>{current.enabled ? 'ON' : 'OFF'}</ToneBadge>}
      />

      <div className='grid gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Auto Void Settings</CardTitle>
          </CardHeader>
          <CardContent>
            {settings.isLoading ? (
              <p className='text-muted-foreground text-sm'>Loading…</p>
            ) : settings.error || !current ? (
              <p className='text-danger text-sm'>{errorText(settings.error)}</p>
            ) : (
              <SettingsForm key={JSON.stringify(current)} current={current} onSaved={() => settings.refetch()} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What it does</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <ol className='list-decimal space-y-2 pl-5'>
              <li>The results cron watches every event that still has open bets.</li>
              <li>
                When the feed declares the event&apos;s <b>Match Odds</b> or <b>Bookmaker</b> result, the timer for that event starts.
              </li>
              <li>
                After the delay, every bet on that event that is still <b>open with no result</b> (fancy sessions, other markets the feed
                never declared) is voided: exposure is released and the stake returns to the player&apos;s cash.
              </li>
              <li>
                Bets whose result has arrived are left to settlement. Bets you are settling by hand (manual status) are never touched.
              </li>
            </ol>
            <Alert className='border-info bg-info-soft'>
              <AlertDescription className='text-foreground'>
                <span>
                  Every auto void appears in <b>Settlement → Void Audit</b> as type <code>AUTO_TIMEOUT</code>, with the anchor market and
                  time in the note.
                </span>
              </AlertDescription>
            </Alert>
            <Alert className='border-warning bg-warning-soft'>
              <AlertDescription className='text-foreground'>
                <span>
                  <b>Careful:</b> a market the feed settled under a name our matcher does not recognise counts as &quot;no result&quot; and
                  will be refunded, not paid. Keep the delay long enough for late fancy results to land.
                </span>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>

      <PendingResultTracker />

      <ResultLinksManager />

    </div>
  )
}

export default AutoVoid
