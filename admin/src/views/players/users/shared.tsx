'use client'

import { useState, type ReactNode } from 'react'

import Link from 'next/link'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { inrSign } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PlayerRow } from '../types'

/**
 * Users page (Direct Users / Agent System / Financial) ke chhote pieces — reference admin
 * (`admin-structure.zip` → components/users) jaisa look, hamare tokens ke saath.
 */

/** `GET admin/reports/user-list` ki row (players jaisi + Users page wale extra fields). */
export type UserRow = PlayerRow & {
  email: string | null
  phone: string | null
  country: string | null
  parentStaff: { id: string; name: string | null; email: string | null } | null
  locks: { system: boolean; casino: boolean; sports: boolean; withdraw: boolean }
}

/** `GET admin/reports/players/summary?channel=` */
export type UsersSummary = {
  totalUsers: number
  activeUsers: number
  lockedUsers: number
  withdrawLocked: number
  totalDeposits: string
  totalWithdrawals: string
}

export type Channel = 'direct' | 'agent' | 'all'

export const inr = (value: string | number | null | undefined) =>
  `${inrSign()}${(Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** PNL = deposits − withdrawals (reference jaisa: direct feed me yahi figure hai). */
export const pnlOf = (r: UserRow) => Number(r.totalDeposited || 0) - Number(r.totalWithdrawn || 0)

export const TONES = {
  primary: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info'
} as const

export type Tone = keyof typeof TONES

/** Upar wala card: rangeen icon box + label + value. */
export const StatCard = ({ label, value, icon, tone, loading }: { label: string; value: ReactNode; icon: ReactNode; tone: Tone; loading?: boolean }) => (
  <Card className='flex min-w-0 flex-row items-center gap-3 p-3.5 sm:gap-4 sm:p-5'>
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-12 [&_svg]:size-5', TONES[tone])}>{icon}</span>
    <div className='min-w-0'>
      <p className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase sm:text-xs'>{label}</p>
      {loading ? <Skeleton className='mt-1 h-6 w-24' /> : <p className='truncate text-lg font-bold tabular-nums sm:text-xl'>{value}</p>}
    </div>
  </Card>
)

/** Chhota rangeen chip (paisa / status). */
export const Chip = ({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) => (
  <span className={cn('inline-block rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums', TONES[tone], className)}>{children}</span>
)

const AVATAR = ['bg-chart-5', 'bg-chart-2', 'bg-success', 'bg-warning', 'bg-danger', 'bg-info']

export const avatarClass = (name: string) => {
  let hash = 0

  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)

  return AVATAR[Math.abs(hash) % AVATAR.length]
}

/**
 * The player's chosen avatar as an <img> src: a platform path (`/api/v1/admin/avatars/3/image?v=…`,
 * absolute or not) goes through the admin's `/api/gw` proxy, an outside https URL is used as is,
 * and a player who never chose one gets the player site's default avatar (the same picture they see).
 */
export const playerAvatarSrc = (avatar: string | null | undefined) => {
  const value = String(avatar ?? '').trim()
  const m = /\/api\/v1\/(.+)$/.exec(value)

  if (m) return `/api/gw/api/v1/${m[1]}`

  return /^https:\/\//.test(value) ? value : DEFAULT_AVATAR
}

const DEFAULT_AVATAR = '/avatar-default.png'

/** The player's picture (their chosen avatar, else the site default); 2 akshar if it will not load. */
export const PlayerAvatar = ({ name, avatar, className }: { name: string | null | undefined; avatar?: string | null; className?: string }) => {
  const label = name || '—'
  const src = playerAvatarSrc(avatar)
  const [broken, setBroken] = useState(false)

  return src && !broken ? (
    <img src={src} alt='' onError={() => setBroken(true)} className={cn('bg-muted size-9 shrink-0 rounded-full object-cover', className)} />
  ) : (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white uppercase', avatarClass(label), className)}>
      {label === '—' ? '??' : label.slice(0, 2)}
    </span>
  )
}

/** Avatar + naam (+ country). Naam pe click = user page. */
export const UserCell = ({ row }: { row: UserRow }) => {
  const name = row.name || '—'

  return (
    <div className='flex items-center gap-3'>
      <PlayerAvatar name={row.name} avatar={row.avatar} />
      <div className='min-w-0'>
        <Link href={`/users/${row.id}`} className='block truncate font-semibold hover:underline'>
          {name}
        </Link>
        {row.country && <span className='text-muted-foreground text-xs'>{row.country}</span>}
      </div>
    </div>
  )
}

/** Status: Locked (laal) / Sports Lock (peela) / Active (hara) — reference jaisa. */
export const StatusChip = ({ row }: { row: UserRow }) =>
  row.locks?.system ? <Chip tone='danger'>Locked</Chip> : row.locks?.sports ? <Chip tone='warning'>Sports Lock</Chip> : <Chip tone='success'>Active</Chip>
