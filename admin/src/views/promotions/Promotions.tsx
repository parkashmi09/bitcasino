'use client'

import { useEffect, useMemo, useState } from 'react'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, MegaphoneIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { DateTimeField, SelectField, SwitchField, TextAreaField, TextField } from '@/components/shared/FormField'
import { RichTextField } from '@/components/shared/RichTextField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useApi, useApiMutation, useInvalidate, useListState } from '@/hooks/use-api'
import { API_V1, api, errorMessage, request } from '@/lib/api/client'
import type { Pagination } from '@/lib/api/types'
import { check, type FieldErrors } from '@/lib/validate'

/**
 * Promotions on the player site (`/promotions`), one segment each: casino or sports.
 *
 * The admin service mounts both audiences of this module at `admin/promotions` (moduleLoader
 * collapses `admin/admin`): the GETs are the public routes — with the staff token they include
 * unpublished rows — and POST / PATCH / DELETE are the staff routes (config:write).
 * The list validator is `.strict()` with `page`/`limit`, so it is read with `request` here rather
 * than `usePagedApi`, which translates `page` into `offset`.
 */

// ── Wire shapes (promotions.service.js #summarise / #describe) ──────────────────────────────

type Segment = 'casino' | 'sports'
type PromoStatus = 'live' | 'ended'

type GameCard = { href: string; name: string; img: string; color?: string; indicator?: string }
type SportEvent = { label: string; href: string; icon?: string; sportAlt?: string }

type Promotion = {
  id: number
  segment: Segment
  slug: string
  title: string
  summary: string | null
  imageAlt: string | null
  featured: boolean
  promoStatus: PromoStatus
  endsAt: string | null
  showInSidebar: boolean
  published: boolean
  publishedAt: string | null
  imageUrl: string | null
  createdAt: string | null
  updatedAt: string | null
}

type PromotionDetail = Promotion & {
  description: string
  termsHtml: string | null
  viewAllHref: string | null
  qualifyingGames: GameCard[]
  sportEvents: SportEvent[]
  tags: string[]
  tournamentPanel: TournamentPanel | null
  leaderboard: Leaderboard | null
}

/** The article's tournament figures and leaderboard (rainbet: drawn under the article on the player site). */
type TournamentPanel = { ends?: string; endsAt?: string; prizePool?: string; prizeSplit?: string }
type Leaderboard = { kind?: string; columns: string[]; rows?: unknown[]; live?: { source: 'wager_leaderboard'; period: 'daily' | 'weekly' | 'monthly'; limit: number } }

const PATH = 'admin/promotions'
const LIST_KEY = ['promotions-list']

/** common imageUpload: PNG / JPEG / WebP, 4 MB. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_ROWS = 80

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'casino', label: 'Casino' },
  { value: 'sports', label: 'Sports' }
]

/** The sports board ids the player site uses (`/sports/match/<sid>/<gmid>`). */
const SPORTS = [
  { sid: '4', label: 'Cricket' },
  { sid: '1', label: 'Soccer' },
  { sid: '2', label: 'Tennis' }
] as const

/** `imageUrl` is a gateway path (`/api/v1/admin/promotions/:id/image`); the proxy serves it. Cache-busted by `updatedAt`. */
const imageSrc = (p: Promotion) =>
  p.imageUrl ? `${API_V1.replace(/\/api\/v1$/, '')}${p.imageUrl}${p.updatedAt ? `?v=${encodeURIComponent(p.updatedAt)}` : ''}` : null

// ── Game links, as the player site routes them ──────────────────────────────────────────────

/** frontend/src/services/originals.js SLUG_ALIAS + normalise: uid → this site's slug. */
const ORIGINAL_ALIAS: Record<string, string> = { mine: 'mines', tower: 'tower-legend', videopoker: 'video-poker' }
const originalSlug = (uid: string) => ORIGINAL_ALIAS[uid] ?? uid.replace(/_/g, '-')

// ── Form state ──────────────────────────────────────────────────────────────────────────────

type Form = {
  segment: Segment
  title: string
  summary: string
  description: string
  termsHtml: string
  imageAlt: string
  viewAllHref: string
  endsAt: string // 'yyyy-MM-ddTHH:mm' local
  promoStatus: PromoStatus
  featured: boolean
  isPublished: boolean
  qualifyingGames: GameCard[]
  sportEvents: SportEvent[]
  prizePool: string
  prizeEnds: string
  prizeSplit: string
  liveBoard: boolean
  livePeriod: 'daily' | 'weekly' | 'monthly'
  liveLimit: string
}

const toLocal = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)

  return Number.isNaN(d.getTime()) ? '' : format(d, "yyyy-MM-dd'T'HH:mm")
}

const fromLocal = (local: string) => (local ? new Date(local).toISOString() : null)

const blankForm = (p?: Partial<PromotionDetail>): Form => ({
  segment: p?.segment ?? 'casino',
  title: p?.title ?? '',
  summary: p?.summary ?? '',
  description: p?.description ?? '',
  termsHtml: p?.termsHtml ?? '',
  imageAlt: p?.imageAlt ?? '',
  viewAllHref: p?.viewAllHref ?? '',
  endsAt: toLocal(p?.endsAt),
  promoStatus: p?.promoStatus ?? 'live',
  featured: p?.featured ?? false,
  isPublished: p?.published ?? false,
  qualifyingGames: p?.qualifyingGames ?? [],
  sportEvents: p?.sportEvents ?? [],
  prizePool: p?.tournamentPanel?.prizePool ?? '',
  prizeEnds: p?.tournamentPanel?.ends ?? '',
  prizeSplit: p?.tournamentPanel?.prizeSplit ?? '',
  liveBoard: Boolean(p?.leaderboard?.live),
  livePeriod: p?.leaderboard?.live?.period ?? 'weekly',
  liveLimit: String(p?.leaderboard?.live?.limit ?? 20)
})

/** Trim every string of a row and drop empty optional keys (the schemas are `.strict()` and `min(1)`). */
const clean = <T extends Record<string, unknown>>(row: T): T =>
  Object.fromEntries(
    Object.entries(row)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v] as const)
      .filter(([, v]) => v !== '' && v !== undefined && v !== null)
  ) as T

const payload = (form: Form) => ({
  segment: form.segment,
  title: form.title.trim(),
  summary: form.summary.trim(),
  description: form.description.trim(),
  termsHtml: form.termsHtml.trim() || null,
  imageAlt: form.imageAlt.trim(),
  viewAllHref: form.viewAllHref.trim() || null,
  endsAt: fromLocal(form.endsAt),
  promoStatus: form.promoStatus,
  featured: form.featured,
  isPublished: form.isPublished,

  // Only the segment's own list is kept; the other is cleared so a switched segment leaves nothing stale.
  qualifyingGames: form.segment === 'casino' ? form.qualifyingGames.map(clean) : [],
  sportEvents: form.segment === 'sports' ? form.sportEvents.map(clean) : [],
  tournamentPanel:
    form.prizePool.trim() || form.prizeEnds.trim() || form.prizeSplit.trim()
      ? clean({ prizePool: form.prizePool, ends: form.prizeEnds, prizeSplit: form.prizeSplit, endsAt: fromLocal(form.endsAt) ?? '' })
      : null,
  leaderboard: form.liveBoard
    ? {
        kind: 'wager',
        columns: ['Rank', 'User', 'Wagered', 'Prize'],
        live: { source: 'wager_leaderboard' as const, period: form.livePeriod, limit: Number(form.liveLimit) || 20 }
      }
    : null
})

/**
 * A multipart create. The validators read booleans with `z.coerce.boolean()`, so the STRING
 * "false" would read as true: a false flag is left out (its default is false). Lists go as JSON
 * strings (`jsonField`).
 */
const toFormData = (body: ReturnType<typeof payload>, file: File) => {
  const fd = new FormData()

  for (const [k, v] of Object.entries(body)) {
    if (v === null || v === undefined || v === '') continue

    if (typeof v === 'boolean') {
      if (v) fd.set(k, 'true')
      continue
    }

    fd.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }

  fd.set('image', file)

  return fd
}

const move = <T,>(list: T[], from: number, to: number) => {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)

  next.splice(to, 0, item)

  return next
}

const isLink = (v: string) => /^(\/[^\s]*|https?:\/\/[^\s]+)$/i.test(v.trim())

// ── Row editors ─────────────────────────────────────────────────────────────────────────────

const RowControls = ({ index, count, onMove, onRemove }: { index: number; count: number; onMove: (to: number) => void; onRemove: () => void }) => (
  <span className='flex shrink-0 items-center gap-0.5'>
    <Button type='button' variant='ghost' size='icon-xs' aria-label='Move up' disabled={index === 0} onClick={() => onMove(index - 1)}>
      <ArrowUpIcon />
    </Button>
    <Button type='button' variant='ghost' size='icon-xs' aria-label='Move down' disabled={index === count - 1} onClick={() => onMove(index + 1)}>
      <ArrowDownIcon />
    </Button>
    <Button type='button' variant='ghost' size='icon-xs' aria-label='Remove' onClick={onRemove}>
      <XIcon />
    </Button>
  </span>
)

/** Debounced value, so a search box does not fire a request per keystroke. */
const useDebounced = <T,>(value: T, ms = 300) => {
  const [v, setV] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)

    return () => clearTimeout(t)
  }, [value, ms])

  return v
}

type LobbyGame = { uuid: string; name: string; provider: string | null; type: string | null; image: string | null }
type OriginalRow = { game_code: string; name: string; image: string | null }
type PickRow = { key: string; name: string; meta: string; img: string; card: GameCard }

const ANY = '__any__'

/** Lobby (Slotegrator) games by provider → type → name, or the Original games; every pick links the way the player site routes it. */
const GamesPicker = ({ value, onChange, error }: { value: GameCard[]; onChange: (next: GameCard[]) => void; error?: string }) => {
  const [source, setSource] = useState<'lobby' | 'originals'>('lobby')
  const [provider, setProvider] = useState(ANY)
  const [type, setType] = useState(ANY)
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim())

  const providers = useApi<{ vendor: string; total?: number }[]>(source === 'lobby' ? 'admin/casino/games/vendors' : null)
  const types = useApi<{ type: string; total?: number }[]>(source === 'lobby' ? 'admin/casino/games/types' : null)

  const lobby = useQuery({
    queryKey: ['promo-lobby-games', provider, type, term],
    queryFn: ({ signal }) =>
      api.get<LobbyGame[]>(
        'casino/games',
        { limit: 100, ...(provider !== ANY ? { provider } : {}), ...(type !== ANY ? { type } : {}), ...(term ? { search: term } : {}) },
        signal
      ),
    enabled: source === 'lobby' && (provider !== ANY || type !== ANY || term.length >= 2),
    retry: false
  })

  const originals = useQuery({
    queryKey: ['promo-original-games'],
    queryFn: ({ signal }) => api.get<OriginalRow[]>('casino/original-games/games', undefined, signal),
    enabled: source === 'originals',
    retry: false
  })

  const rows: PickRow[] =
    source === 'lobby'
      ? (lobby.data ?? []).map(g => ({
          key: g.uuid,
          name: g.name,
          meta: `${g.provider ?? '—'} · ${g.type ?? '—'}`,
          img: g.image ?? '',
          card: { name: g.name, href: `/game/${encodeURIComponent(g.uuid)}`, img: g.image ?? '' }
        }))
      : (originals.data ?? [])
          .filter(g => !term || g.name.toLowerCase().includes(term.toLowerCase()))
          .map(g => ({
            key: g.game_code,
            name: g.name,
            meta: 'Original game',
            img: g.image ?? '',

            // No image: the player site draws its own art for the slug.
            card: { name: g.name, href: `/game/${originalSlug(g.game_code)}`, img: g.image ?? '' }
          }))

  const query = source === 'lobby' ? lobby : originals
  const idle = source === 'lobby' && !lobby.isFetching && !lobby.data
  const taken = new Set(value.map(g => g.href))
  const set = (i: number, patch: Partial<GameCard>) => onChange(value.map((g, j) => (j === i ? { ...g, ...patch } : g)))
  const addAll = () => onChange([...value, ...rows.filter(r => !taken.has(r.card.href)).map(r => r.card)].slice(0, MAX_ROWS))

  return (
    <div className='grid gap-2'>
      <span className='text-sm font-medium'>Qualifying games</span>
      <span className='text-muted-foreground text-xs'>Pick a provider, then a game type, then add the games. Original games are listed on their own. They show on the promotion page in this order.</span>
      <div className='flex flex-wrap gap-2'>
        <Select
          value={source}
          onValueChange={v => {
            if (!v) return
            setSource(v as typeof source)
            setQ('')
          }}
        >
          <SelectTrigger className='w-40'>
            <SelectValue>{(v: string) => (v === 'originals' ? 'Original games' : 'Casino games')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='lobby'>Casino games</SelectItem>
            <SelectItem value='originals'>Original games</SelectItem>
          </SelectContent>
        </Select>
        {source === 'lobby' && (
          <>
            <Select value={provider} onValueChange={v => v && setProvider(v)}>
              <SelectTrigger className='w-48'>
                <SelectValue>{(v: string) => (v === ANY ? 'All providers' : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All providers</SelectItem>
                {(providers.data ?? []).map(p => (
                  <SelectItem key={p.vendor} value={p.vendor}>
                    {p.vendor} {p.total !== undefined ? `(${p.total})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={v => v && setType(v)}>
              <SelectTrigger className='w-44'>
                <SelectValue>{(v: string) => (v === ANY ? 'All types' : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All types</SelectItem>
                {(types.data ?? []).map(t => (
                  <SelectItem key={t.type} value={t.type}>
                    {t.type} {t.total !== undefined ? `(${t.total})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <Input className='min-w-48 flex-1' placeholder='Game name…' value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {idle ? (
        <div className='text-muted-foreground rounded-md border p-3 text-sm'>Choose a provider or a type (or type 2+ letters) to list games.</div>
      ) : (
        <div className='max-h-64 overflow-y-auto rounded-md border'>
          {query.isLoading ? (
            <div className='text-muted-foreground flex items-center gap-2 p-3 text-sm'>
              <Loader2Icon className='size-4 animate-spin' /> Loading games…
            </div>
          ) : query.error ? (
            <div className='text-destructive p-3 text-sm'>Could not load games: {errorMessage(query.error)}. You can still add a game by hand below.</div>
          ) : !rows.length ? (
            <div className='text-muted-foreground p-3 text-sm'>No game matches these filters.</div>
          ) : (
            <>
              <div className='bg-muted/40 flex items-center justify-between border-b px-3 py-1.5 text-xs'>
                <span className='text-muted-foreground'>
                  {rows.length} game{rows.length === 1 ? '' : 's'}
                  {source === 'lobby' && rows.length === 100 ? ' (first 100 — narrow the filters)' : ''}
                </span>
                <Button type='button' size='xs' variant='ghost' disabled={value.length >= MAX_ROWS} onClick={addAll}>
                  <PlusIcon /> Add all
                </Button>
              </div>
              {rows.map(r => {
                const added = taken.has(r.card.href)

                return (
                  <div key={r.key} className='flex items-center gap-3 border-b px-3 py-2 last:border-b-0'>
                    {r.img ? <img src={r.img} alt='' className='bg-muted size-9 shrink-0 rounded object-cover' /> : <span className='bg-muted size-9 shrink-0 rounded' />}
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm'>{r.name}</span>
                      <span className='text-muted-foreground block truncate text-xs'>{r.meta}</span>
                    </span>
                    <Button type='button' size='xs' variant={added ? 'ghost' : 'outline'} disabled={added || value.length >= MAX_ROWS} onClick={() => onChange([...value, r.card])}>
                      {added ? 'Added' : 'Add'}
                    </Button>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
      {value.length > 0 && (
        <div className='grid gap-2'>
          {value.map((g, i) => (
            <div key={i} className='flex items-start gap-2 rounded-md border p-2'>
              {g.img ? (
                 
                <img src={g.img} alt='' className='bg-muted size-12 shrink-0 rounded object-cover' onError={e => (e.currentTarget.style.visibility = 'hidden')} />
              ) : (
                <span className='bg-muted size-12 shrink-0 rounded' />
              )}
              <div className='grid min-w-0 flex-1 gap-1'>
                <Input aria-label='Game name' placeholder='Name' value={g.name} onChange={e => set(i, { name: e.target.value })} />
                <Input aria-label='Game link' placeholder='/game/<slug>' className='font-mono text-xs' value={g.href} onChange={e => set(i, { href: e.target.value })} />
                <Input
                  aria-label='Game image URL'
                  placeholder='Image URL (empty = the site’s own art for this game)'
                  className='font-mono text-xs'
                  value={g.img}
                  onChange={e => set(i, { img: e.target.value })}
                />
              </div>
              <RowControls index={i} count={value.length} onMove={to => onChange(move(value, i, to))} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
      <div className='flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-xs'>
          {value.length} / {MAX_ROWS} games
        </span>
        <Button type='button' variant='outline' size='xs' disabled={value.length >= MAX_ROWS} onClick={() => onChange([...value, { name: '', href: '/game/', img: '' }])}>
          <PlusIcon /> Add by hand
        </Button>
      </div>
      {error && <span className='text-destructive text-sm'>{error}</span>}
    </div>
  )
}

type BoardRow = { gmid: number | string; etid?: number; cname?: string; ename?: string; stime?: string; iplay?: boolean }

/** `sports/user/cricket/all-data` answers `{ success, data: { t1, t2 } }` inside the gateway envelope. */
const boardRows = (data: unknown): BoardRow[] => {
  const inner = (data && typeof data === 'object' && 'data' in data ? (data as { data: unknown }).data : data) as { t1?: BoardRow[]; t2?: BoardRow[] } | null
  const rows = [...(Array.isArray(inner?.t1) ? inner.t1 : []), ...(Array.isArray(inner?.t2) ? inner.t2 : [])]
  const seen = new Set<string>()

  return rows.filter(r => r && r.gmid !== undefined && !seen.has(String(r.gmid)) && seen.add(String(r.gmid)))
}

const SportsPicker = ({ value, onChange, error }: { value: SportEvent[]; onChange: (next: SportEvent[]) => void; error?: string }) => {
  const [sid, setSid] = useState<string>('4')
  const sport = SPORTS.find(s => s.sid === sid)!

  const board = useQuery({
    queryKey: ['promo-sport-board', sid],
    queryFn: async () => {
      const data = await api.post<unknown>('sports/user/cricket/all-data', { id: Number(sid) })

      if (data && typeof data === 'object' && (data as { success?: unknown }).success === false) {
        const d = data as { message?: unknown; error?: unknown }

        throw new Error(typeof d.message === 'string' ? d.message : typeof d.error === 'string' ? d.error : 'The sports feed refused the request')
      }

      return boardRows(data)
    },
    retry: false,
    staleTime: 60_000
  })

  const taken = new Set(value.map(e => e.href))
  const set = (i: number, patch: Partial<SportEvent>) => onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  return (
    <div className='grid gap-2'>
      <span className='text-sm font-medium'>Sports events</span>
      <span className='text-muted-foreground text-xs'>Pick matches from the live board, or add one by hand (label, link /sports/match/&lt;sid&gt;/&lt;gmid&gt;, sport).</span>
      <div className='flex flex-wrap gap-1'>
        {SPORTS.map(s => (
          <Button key={s.sid} type='button' size='xs' variant={s.sid === sid ? 'default' : 'outline'} onClick={() => setSid(s.sid)}>
            {s.label}
          </Button>
        ))}
      </div>
      <div className='max-h-56 overflow-y-auto rounded-md border'>
        {board.isLoading ? (
          <div className='text-muted-foreground flex items-center gap-2 p-3 text-sm'>
            <Loader2Icon className='size-4 animate-spin' /> Loading {sport.label.toLowerCase()} matches…
          </div>
        ) : board.error ? (
          <div className='text-destructive p-3 text-sm'>Could not load the {sport.label.toLowerCase()} board: {errorMessage(board.error)}. Add events by hand below.</div>
        ) : !board.data?.length ? (
          <div className='text-muted-foreground p-3 text-sm'>No {sport.label.toLowerCase()} match on the board right now.</div>
        ) : (
          board.data.map(m => {
            const href = `/sports/match/${sid}/${m.gmid}`
            const added = taken.has(href)

            return (
              <div key={String(m.gmid)} className='flex items-center gap-3 border-b px-3 py-2 last:border-b-0'>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm'>
                    {m.ename ?? `Match ${m.gmid}`} {m.iplay && <Badge variant='destructive'>In play</Badge>}
                  </span>
                  <span className='text-muted-foreground block truncate text-xs'>
                    {m.cname ?? '—'} · {m.stime ?? '—'}
                  </span>
                </span>
                <Button
                  type='button'
                  size='xs'
                  variant={added ? 'ghost' : 'outline'}
                  disabled={added || value.length >= MAX_ROWS}
                  onClick={() => onChange([...value, { label: m.ename ?? `Match ${m.gmid}`, href, sportAlt: sport.label }])}
                >
                  {added ? 'Added' : 'Add'}
                </Button>
              </div>
            )
          })
        )}
      </div>
      {value.length > 0 && (
        <div className='grid gap-2'>
          {value.map((e, i) => (
            <div key={i} className='flex items-start gap-2 rounded-md border p-2'>
              <div className='grid min-w-0 flex-1 gap-1'>
                <Input aria-label='Event label' placeholder='Team A v Team B' value={e.label} onChange={ev => set(i, { label: ev.target.value })} />
                <div className='grid grid-cols-[1fr_auto] gap-1'>
                  <Input aria-label='Event link' placeholder='/sports/match/4/123456' className='font-mono text-xs' value={e.href} onChange={ev => set(i, { href: ev.target.value })} />
                  <select
                    aria-label='Sport'
                    className='border-input bg-background h-9 rounded-md border px-2 text-sm'
                    value={e.sportAlt ?? ''}
                    onChange={ev => set(i, { sportAlt: ev.target.value || undefined })}
                  >
                    <option value=''>Sport…</option>
                    {SPORTS.map(s => (
                      <option key={s.sid} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                    {e.sportAlt && !SPORTS.some(s => s.label === e.sportAlt) && <option value={e.sportAlt}>{e.sportAlt}</option>}
                  </select>
                </div>
              </div>
              <RowControls index={i} count={value.length} onMove={to => onChange(move(value, i, to))} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
      <div className='flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-xs'>
          {value.length} / {MAX_ROWS} events
        </span>
        <Button
          type='button'
          variant='outline'
          size='xs'
          disabled={value.length >= MAX_ROWS}
          onClick={() => onChange([...value, { label: '', href: `/sports/match/${sid}/`, sportAlt: sport.label }])}
        >
          <PlusIcon /> Add by hand
        </Button>
      </div>
      {error && <span className='text-destructive text-sm'>{error}</span>}
    </div>
  )
}

// ── Create / edit dialog ────────────────────────────────────────────────────────────────────

const PromotionDialog = ({ existing }: { existing?: Promotion }) => {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>(() => blankForm(existing))
  const [file, setFile] = useState<File | null>(null)
  const [seeded, setSeeded] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [listErrors, setListErrors] = useState<{ games?: string; events?: string }>({})

  const detailPath = existing ? `${PATH}/${existing.id}` : null
  const full = useApi<PromotionDetail>(open ? detailPath : null, undefined, { retry: false })

  // Seed the form from the full read (description, terms, lists); a later refetch re-seeds only an untouched form.
  const seedKey = full.data ? `${full.data.id}:${full.data.updatedAt ?? ''}` : null

  if (open && existing && full.data && seedKey && seeded !== seedKey && !dirty) {
    setForm(blankForm(full.data))
    setSeeded(seedKey)
  }

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview]
  )

  const onOpenChange = (next: boolean) => {
    if (next) {
      setForm(blankForm(existing))
      setFile(null)
      setSeeded(null)
      setDirty(false)
      setListErrors({})
    }

    setOpen(next)
  }

  const save = useApiMutation({
    fn: async () => {
      const body = payload(form)

      if (!existing) {
        return file ? api.upload<PromotionDetail>(PATH, toFormData(body, file), 'POST') : api.post<PromotionDetail>(PATH, body)
      }

      // The fields go as JSON (real booleans and nulls); a new banner follows as its own multipart PATCH.
      let saved = await api.patch<PromotionDetail>(`${PATH}/${existing.id}`, body)

      if (file) {
        const fd = new FormData()

        fd.set('imageAlt', body.imageAlt)
        fd.set('image', file)
        saved = await api.upload<PromotionDetail>(`${PATH}/${existing.id}`, fd, 'PATCH')
      }

      return saved
    },
    invalidate: [LIST_KEY, ['api', detailPath]],
    success: p => (existing ? `“${p?.title ?? form.title}” saved` : `“${p?.title ?? form.title}” created${p?.published ? ' and published' : ' as a draft'}`)
  })

  const set = <K extends keyof Form>(key: K, v: Form[K]) => {
    setDirty(true)
    setForm(f => ({ ...f, [key]: v }))
  }

  const existingImage = existing ? imageSrc(full.data ?? existing) : null

  const validate = (): FieldErrors | string | undefined => {
    if (existing && full.isLoading) return 'Wait for the promotion to load'
    if (existing && full.error) return `Could not load the promotion: ${errorMessage(full.error)}`

    let games: string | undefined
    let events: string | undefined

    if (form.segment === 'casino') {
      const bad = form.qualifyingGames.findIndex(g => !g.name.trim() || !g.href.trim() || !isLink(g.href))

      if (bad >= 0) games = `Qualifying game ${bad + 1} needs a name and a link (/game/…)`
      else if (form.qualifyingGames.some(g => g.name.length > 200 || g.href.length > 512 || g.img.length > 512)) games = 'A game name is at most 200 characters; links and image URLs 512'
    } else {
      const bad = form.sportEvents.findIndex(e => !e.label.trim() || !e.href.trim() || !isLink(e.href))

      if (bad >= 0) events = `Sports event ${bad + 1} needs a label and a link (/sports/match/…)`
      else if (form.sportEvents.some(e => e.label.length > 300 || e.href.length > 512)) events = 'An event label is at most 300 characters; links 512'
    }

    setListErrors({ games, events })

    return {
      'pr-title': check.required(form.title, 'Title') || check.length(form.title, 'Title', { max: 512 }),
      'pr-summary': check.length(form.summary, 'Summary', { max: 2000 }),
      'pr-desc': check.required(form.description, 'Description') || check.length(form.description, 'Description', { max: 200000 }),
      'pr-terms': check.length(form.termsHtml, 'Terms', { max: 200000 }),
      'pr-alt': check.length(form.imageAlt, 'Image alt text', { max: 512 }),
      'pr-viewall': form.viewAllHref.trim() && !isLink(form.viewAllHref) ? '“View all” link must be a site path (/casino) or an http(s) URL' : check.length(form.viewAllHref, '“View all” link', { max: 512 }),
      'pr-image': !file
        ? undefined
        : !IMAGE_TYPES.includes(file.type)
          ? 'The banner must be PNG, JPEG or WebP'
          : file.size > MAX_IMAGE_BYTES
            ? `The banner is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 4 MB`
            : undefined,
      'pr-games': games,
      'pr-events': events
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      trigger={
        existing ? (
          <Button variant='ghost' size='icon-sm' aria-label='Edit'>
            <PencilIcon />
          </Button>
        ) : (
          <Button>
            <PlusIcon /> New promotion
          </Button>
        )
      }
      title={existing ? `Edit “${existing.title}”` : 'New promotion'}
      description={existing ? `Slug: ${existing.slug} · ${existing.segment}` : 'The page address (slug) is made from the title. Leave “Published” off to keep it as a draft.'}
      submitLabel={existing ? 'Save' : 'Create'}
      onSubmit={() => save.mutateAsync()}
      validate={validate}
    >
      {existing && full.isLoading && (
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Loader2Icon className='size-4 animate-spin' /> Loading the promotion…
        </div>
      )}
      <div className='grid gap-4 sm:grid-cols-2'>
        <SelectField id='pr-segment' label='Segment' required value={form.segment} onChange={v => set('segment', v as Segment)} options={SEGMENTS} />
        <SelectField
          id='pr-status'
          label='Status'
          value={form.promoStatus}
          onChange={v => set('promoStatus', v as PromoStatus)}
          options={[
            { value: 'live', label: 'Live' },
            { value: 'ended', label: 'Ended' }
          ]}
          hint='Ended promotions stay visible, marked as ended.'
        />
      </div>
      <TextField id='pr-title' name='title' label='Title' required maxLength={512} value={form.title} onChange={e => set('title', e.target.value)} />
      <TextAreaField id='pr-summary' name='summary' label='Summary' rows={2} maxLength={2000} hint='The short line on the promotion card.' value={form.summary} onChange={e => set('summary', e.target.value)} />
      <RichTextField
        id='pr-desc'
        name='description'
        label='Description'
        required
        hint={existing && full.isLoading ? 'Loading the current description…' : 'The promotion’s body. Use the toolbar, or </> to edit the HTML.'}
        value={form.description}
        onChange={html => set('description', html)}
      />
      <RichTextField
        id='pr-terms'
        name='termsHtml'
        label='Terms & conditions'
        minHeight={140}
        hint='Optional. Leave empty for none.'
        value={form.termsHtml}
        onChange={html => set('termsHtml', html)}
      />
      <div className='grid gap-2'>
        <label htmlFor='pr-image' className='text-sm font-medium'>
          Banner image {existing ? '(leave empty to keep the current one)' : '(optional)'}
        </label>
        <span className='text-muted-foreground text-xs'>PNG, JPEG or WebP, up to 4 MB.</span>
        <input id='pr-image' type='file' accept='image/png,image/jpeg,image/webp' className='text-sm' onChange={e => setFile(e.target.files?.[0] ?? null)} />
        {(preview || existingImage) && (
           
          <img src={preview ?? existingImage!} alt={preview ? 'The new banner' : 'The current banner'} className='bg-muted max-h-40 w-full rounded border object-contain' />
        )}
      </div>
      <TextField id='pr-alt' name='imageAlt' label='Image alt text' maxLength={512} hint='Describes the banner for screen readers.' value={form.imageAlt} onChange={e => set('imageAlt', e.target.value)} />
      <div className='grid gap-4 sm:grid-cols-2'>
        <DateTimeField id='pr-ends' label='Ends at' hint='Optional; your local time. Clear it for no end date.' value={form.endsAt} onChange={v => set('endsAt', v)} />
        <TextField id='pr-viewall' name='viewAllHref' label='“View all” link' placeholder='/casino' hint='Optional; where the list’s “View all” goes.' value={form.viewAllHref} onChange={e => set('viewAllHref', e.target.value)} />
      </div>
      <div className='grid gap-2 sm:grid-cols-2'>
        <SwitchField id='pr-featured' label='Featured' hint='Listed first.' checked={form.featured} onChange={v => set('featured', v)} />
        <SwitchField id='pr-published' label='Published' hint='Off: hidden from players.' checked={form.isPublished} onChange={v => set('isPublished', v)} />
      </div>
      <div className='grid gap-2 sm:grid-cols-3'>
        <TextField id='pr-pool' label='Prize pool' placeholder='$10,000' hint='Optional; shown in a panel under the article.' value={form.prizePool} onChange={e => set('prizePool', e.target.value)} />
        <TextField id='pr-pends' label='Ends (text)' placeholder='Sep 14, 9:30 AM' hint='Optional; the panel’s end time as written.' value={form.prizeEnds} onChange={e => set('prizeEnds', e.target.value)} />
        <TextField id='pr-split' label='Prize split' placeholder='50' hint='Optional; “Top 50”.' value={form.prizeSplit} onChange={e => set('prizeSplit', e.target.value)} />
      </div>
      <SwitchField id='pr-board' label='Live wager leaderboard' hint='Shows the platform’s wager leaderboard under the article.' checked={form.liveBoard} onChange={v => set('liveBoard', v)} />
      {form.liveBoard && (
        <div className='grid gap-2 sm:grid-cols-2'>
          <SelectField
            id='pr-board-period'
            label='Period'
            value={form.livePeriod}
            onChange={v => set('livePeriod', v as Form['livePeriod'])}
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' }
            ]}
          />
          <TextField id='pr-board-limit' label='Rows' inputMode='numeric' value={form.liveLimit} onChange={e => set('liveLimit', e.target.value.replace(/\D/g, ''))} />
        </div>
      )}
      {form.segment === 'casino' ? (
        <GamesPicker value={form.qualifyingGames} onChange={v => set('qualifyingGames', v)} error={listErrors.games} />
      ) : (
        <SportsPicker value={form.sportEvents} onChange={v => set('sportEvents', v)} error={listErrors.events} />
      )}
    </FormDialog>
  )
}

// ── The page ────────────────────────────────────────────────────────────────────────────────

const FILTERS = [{ value: '', label: 'All' }, ...SEGMENTS] as const

const Promotions = () => {
  const { state, set, query } = useListState(['segment'])
  const invalidate = useInvalidate()

  const listQuery = { page: query.page, limit: query.limit, search: query.search, segment: query.segment }

  const list = useQuery({
    queryKey: [...LIST_KEY, listQuery],
    queryFn: async ({ signal }) => {
      const { data, meta } = await request<Promotion[]>(PATH, { query: listQuery, signal })

      return { rows: Array.isArray(data) ? data : [], pagination: meta?.pagination as Pagination | undefined }
    },
    placeholderData: prev => prev
  })

  const publish = useApiMutation({
    fn: (v: { id: number; title: string; published: boolean }) => api.patch(`${PATH}/${v.id}`, { isPublished: v.published }),
    invalidate: [LIST_KEY],
    onSuccess: (_r, v) => invalidate(['api', `${PATH}/${v.id}`]),
    success: (_r, v) => `“${v.title}” is now ${v.published ? 'published' : 'hidden'}`
  })

  const remove = useApiMutation({
    fn: (v: { id: number; title: string }) => api.delete(`${PATH}/${v.id}`),
    invalidate: [LIST_KEY],
    success: (_r, v) => `“${v.title}” deleted`
  })

  const columns: Column<Promotion>[] = [
    {
      key: 'image',
      header: 'Banner',
      cell: p => {
        const src = imageSrc(p)

        return src ? (
           
          <img src={src} alt={p.imageAlt ?? p.title} className='bg-muted h-10 w-20 rounded object-cover' onError={e => (e.currentTarget.style.visibility = 'hidden')} />
        ) : (
          <span className='bg-muted block h-10 w-20 rounded' />
        )
      }
    },
    {
      key: 'title',
      header: 'Promotion',
      cell: p => (
        <span className='block max-w-96'>
          <span className='flex items-center gap-1.5'>
            <span className='truncate font-medium'>{p.title}</span>
            {p.featured && <Badge variant='secondary'>Featured</Badge>}
          </span>
          <span className='text-muted-foreground block truncate font-mono text-xs'>{p.slug}</span>
        </span>
      )
    },
    { key: 'segment', header: 'Segment', cell: p => <Badge variant='outline'>{p.segment === 'sports' ? 'Sports' : 'Casino'}</Badge> },
    { key: 'status', header: 'Status', cell: p => <StatusBadge value={p.promoStatus} /> },
    {
      key: 'published',
      header: 'Published',
      cell: p => (
        <Can permission='config:write' fallback={<StatusBadge value={p.published ? 'published' : 'draft'} />}>
          <Switch
            checked={p.published}
            aria-label={p.published ? 'Unpublish' : 'Publish'}
            disabled={publish.isPending && publish.variables?.id === p.id}
            onCheckedChange={published => publish.mutate({ id: p.id, title: p.title, published })}
          />
        </Can>
      )
    },
    { key: 'ends', header: 'Ends', cell: p => (p.endsAt ? <DateTime value={p.endsAt} /> : <span className='text-muted-foreground'>—</span>) },
    { key: 'updated', header: 'Updated', cell: p => <DateTime value={p.updatedAt ?? p.createdAt} relative /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: p => (
        <Can permission='config:write'>
          <span className='flex justify-end gap-1'>
            <PromotionDialog existing={p} />
            <ConfirmDialog
              trigger={
                <Button variant='ghost' size='icon-sm' aria-label='Delete'>
                  <Trash2Icon />
                </Button>
              }
              title={`Delete “${p.title}”?`}
              description='The promotion and its banner are removed from the site. This cannot be undone — to take it down for now, unpublish it instead.'
              confirmLabel='Delete'
              destructive
              onConfirm={() => remove.mutateAsync({ id: p.id, title: p.title })}
            />
          </span>
        </Can>
      )
    }
  ]

  const segment = String(state.segment ?? '')

  return (
    <div>
      <PageHeader
        title='Promotions'
        description='The campaigns players see under Promotions, for the casino or sports. Changes apply on the site straight away; unpublish to hide one without losing it.'
        actions={
          <Can permission='config:write'>
            <PromotionDialog />
          </Can>
        }
      />
      <DataTable
        columns={columns}
        rows={list.data?.rows}
        rowKey={p => p.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        search={String(state.search ?? '')}
        onSearchChange={search => set({ search })}
        searchPlaceholder='Title…'
        toolbar={
          <div className='flex gap-1'>
            {FILTERS.map(f => (
              <Button key={f.value || 'all'} size='sm' variant={segment === f.value ? 'default' : 'outline'} onClick={() => set({ segment: f.value || null })}>
                {f.label}
              </Button>
            ))}
          </div>
        }
        emptyMessage={
          <span className='flex flex-col items-center gap-1'>
            <MegaphoneIcon className='text-muted-foreground size-5' />
            {segment || state.search ? 'No promotion matches.' : 'No promotion yet. Create one to show it on the site.'}
          </span>
        }
      />
    </div>
  )
}

export default Promotions
