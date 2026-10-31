'use client'

import type { ReactNode } from 'react'

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { API_V1, ApiError, buildQuery, errorMessage } from '@/lib/api/client'
import type { Query } from '@/lib/api/types'
import { cn } from '@/lib/utils'

/**
 * Settings screens (zip `pages/settings/*`) ki common cheezein.
 * Sab API sports service ke `config` module me hain (zip `/admin/betting-config/*`,
 * `/admin/commission-config/*`, `/admin/sports-lock/*`).
 */

export const CONFIG_API = 'admin/sports/config'

/**
 * Zip ka API call — poora response wapas (`{ success, sports, markets … }`).
 * Hamara `api` client sirf `data` deta hai, par ye routes baaki keys me jawab dete hain.
 * success false ya HTTP error ho to Error throw (server ka message ke saath).
 */
export async function zipApi<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  payload?: object
): Promise<T> {
  const query = method === 'GET' ? buildQuery(payload as Query) : ''
  const hasBody = method !== 'GET' && payload !== undefined

  const res = await fetch(`${API_V1}/${path}${query}`, {
    method,
    headers: { accept: 'application/json', ...(hasBody ? { 'content-type': 'application/json' } : {}) },
    body: hasBody ? JSON.stringify(payload) : undefined,
    cache: 'no-store'
  })

  const json = await res.json().catch(() => null)

  if (!res.ok || !json || json.success === false) {
    const err = json?.error

    const message =
      (err && typeof err === 'object' && typeof err.message === 'string' && err.message) ||
      (typeof err === 'string' && err) ||
      (typeof json?.message === 'string' && json.message) ||
      res.statusText ||
      'Request failed'

    // ApiError keeps `code` + 422 `details.fields`, so `errorMessage` can name the bad field.
    throw new ApiError(res.status, (err && typeof err === 'object' && typeof err.code === 'string' && err.code) || `HTTP_${res.status}`, message, err && typeof err === 'object' && err.details && typeof err.details === 'object' ? err.details : undefined)
  }

  return json as T
}

/**
 * Zip GET ka react-query hook — screen load hote hi data, `refetch()` se dobara.
 * `path` null ho to request nahi jaati.
 */
export function useZip<T>(path: string | null, query?: object, options?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: ['zip', path, query ?? null],
    queryFn: () => zipApi<T>('GET', path as string, query),
    enabled: path !== null && (options?.enabled ?? true),
    refetchOnWindowFocus: false,
    ...options
  })
}

/** Error ka text, toast ke liye. */
export const errorText = (error: unknown) => errorMessage(error)

/** Zip ke badge-soft-* rang — hamare theme ke tone tokens se. */
const TONES = {
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-muted text-muted-foreground'
}

export type Tone = keyof typeof TONES

export const ToneBadge = ({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) => (
  <Badge variant='outline' className={cn('border-transparent', TONES[tone], className)}>
    {children}
  </Badge>
)

/** "Loading..." / "no records found" jaisi ek line. */
export const Note = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('text-muted-foreground p-6 text-center text-sm', className)}>{children}</div>
)

// ── Buffer Time + Commission ka sport × league × market grid ────────────────

export type Market = { key: string; label: string; group: string; hint?: string }

export type League<Cell> = {
  key: string
  label: string
  is_default: boolean
  configured_count?: number
  active_count?: number
  cells?: Record<string, Cell>
  rules?: Record<string, Cell>
}

export type GridSport<Cell> = { sport_id: number; name: string; enabled: boolean; leagues?: League<Cell>[] }

export const cellKey = (sportId: number, leagueKey: string, marketKey: string) => `${sportId}:${leagueKey}:${marketKey}`

/** Markets ko unke group (Main / Bookmaker / Fancy) ke hisaab se, order wahi rakh ke. */
export function groupMarkets(markets: Market[]) {
  const groups: { group: string; items: Market[] }[] = []

  for (const market of markets) {
    const last = groups[groups.length - 1]

    if (last && last.group === market.group) last.items.push(market)
    else groups.push({ group: market.group, items: [market] })
  }

  return groups
}

/** Collapse hone wale sport card ka header — naam, #id, live, extra leagues, summary. */
export const SportHeader = ({
  sport,
  open,
  summary,
  onToggle
}: {
  sport: GridSport<unknown>
  open: boolean
  summary: string
  onToggle: () => void
}) => {
  const extra = (sport.leagues?.length ?? 0) - 1

  return (
    <button type='button' className='flex w-full items-center gap-2 px-3.5 py-2.5 text-left' onClick={onToggle}>
      {open ? <ChevronDownIcon className='size-4' /> : <ChevronRightIcon className='size-4' />}
      <span className='font-medium'>{sport.name}</span>
      <small className='text-muted-foreground'>#{sport.sport_id}</small>
      {sport.enabled && <ToneBadge tone='success'>live</ToneBadge>}
      {extra > 0 && (
        <ToneBadge tone='info'>
          {extra} extra league{extra > 1 ? 's' : ''}
        </ToneBadge>
      )}
      <small className='text-muted-foreground ml-auto max-w-[55%] text-right'>{summary}</small>
    </button>
  )
}

/** Sport ke andar league ki tab strip — 'default' aur uske variants. */
export const LeagueTabs = ({
  leagues,
  active,
  badgeOf,
  onSelect
}: {
  leagues: { key: string; label: string }[]
  active: string
  badgeOf: (key: string) => number
  onSelect: (key: string) => void
}) => (
  <div className='mb-3 flex flex-wrap gap-1.5'>
    {leagues.map(l => {
      const badge = badgeOf(l.key)

      return (
        <button
          key={l.key}
          type='button'
          onClick={() => onSelect(l.key)}
          className={cn(
            'rounded-md px-3 py-1 text-sm',
            l.key === active ? 'bg-accent text-foreground shadow-sm ring-1 ring-border' : 'hover:bg-muted text-foreground'
          )}
        >
          {l.label}
          {badge > 0 && <span className='bg-background/80 text-foreground ml-1 rounded px-1.5 text-xs'>{badge}</span>}
        </button>
      )
    })}
  </div>
)

/** Inherit / ON / OFF jaise chhote toggle buttons ka group. */
export const ToggleGroupButtons = ({
  options,
  value,
  onChange
}: {
  options: { value: string; label: string; activeClass: string }[]
  value: string
  onChange: (value: string) => void
}) => (
  <div className='inline-flex overflow-hidden rounded-md border'>
    {options.map(o => (
      <button
        key={o.value}
        type='button'
        onClick={() => onChange(o.value)}
        className={cn('border-r px-2.5 py-1 text-xs last:border-r-0', value === o.value ? o.activeClass : 'hover:bg-muted')}
      >
        {o.label}
      </button>
    ))}
  </div>
)
