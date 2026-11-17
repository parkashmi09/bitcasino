'use client'

import { useEffect, useRef, useState } from 'react'

import Link from 'next/link'

import { toast } from 'sonner'

import { BellIcon, Volume2Icon, VolumeXIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { navItems, type NavMarks } from '@/configs/navConfig'
import { usePagedApi } from '@/hooks/use-api'
import { useNavVisible } from '@/hooks/use-nav-visible'

/**
 * Header bell (user, 2026-11-15): the queues that wait on staff — manual deposits, manual and crypto
 * withdrawals, KYC — read every 20 s from the same list routes their pages use (`limit=1`, the
 * pending status). The badge is everything still pending; a NEW request (a higher id than the last
 * read) plays the chime and toasts. The first read only sets the baseline, so opening the panel
 * does not ring for requests that were already there.
 *
 * Each queue shows only where its menu entry shows (same marks — house staff, the grant, the plan),
 * so an agent login gets no bell. The sound is /sounds/notify.mp3 (the player site's); browsers
 * stay silent until the page has been clicked once. Mute is per browser.
 */

const POLL_MS = 20_000
const MUTE_KEY = 'admin:notify-muted'

type Source = { key: string; label: string; href: string; nav: string; path: string; query: Record<string, string>; id: (row: Record<string, unknown>) => number }

const SOURCES: Source[] = [
  { key: 'dep', label: 'Deposit requests', href: '/transactions/deposit', nav: '/transactions/deposit', path: 'admin/user/deposits/fiat', query: { status: 'pending', channel: 'direct' }, id: r => Number(r.depositId) },
  { key: 'wd', label: 'Withdrawal requests', href: '/transactions/withdraw', nav: '/transactions/withdraw', path: 'admin/user/withdrawals/fiat', query: { status: 'In Queue', channel: 'direct' }, id: r => Number(r.withdrawalId) },
  { key: 'cwd', label: 'Crypto withdrawals', href: '/transactions/withdraw', nav: '/transactions/withdraw', path: 'admin/user/withdrawals/crypto', query: { status: 'In Queue', channel: 'direct' }, id: r => Number(r.id) },
  { key: 'kyc', label: 'KYC applications', href: '/kyc', nav: '/kyc', path: 'admin/user/kyc/applications', query: { status: 'Pending' }, id: r => Number(r.id) }
]

/** The menu entry's marks for `href`, so a queue is gated exactly like its page link. */
const navMarks = (href: string): NavMarks | null => {
  for (const group of navItems) for (const item of group.items) if ('href' in item && item.href === href) return item as NavMarks

  return null
}

let audio: HTMLAudioElement | null = null

const chime = () => {
  try {
    audio ??= new Audio('/sounds/notify.mp3')
    audio.currentTime = 0
    void audio.play().catch(() => {})
  } catch {
    /* no audio on this device */
  }
}

const readMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

/** One queue: polls its count and newest id, reports both up. */
const useQueue = (source: Source, enabled: boolean) => {
  const list = usePagedApi<Record<string, unknown>>(enabled ? source.path : null, { ...source.query, limit: 1, page: 1 }, {
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    retry: false
  })

  const row = list.data?.rows?.[0]

  return { count: enabled ? (list.data?.pagination.total ?? 0) : 0, newest: row ? source.id(row) : 0, loaded: enabled && !!list.data }
}

const AdminNotifications = () => {
  const visible = useNavVisible()

  const on = SOURCES.map(s => {
    const marks = navMarks(s.nav)

    return !!marks && visible(marks)
  })

  const queues = [useQueue(SOURCES[0], on[0]), useQueue(SOURCES[1], on[1]), useQueue(SOURCES[2], on[2]), useQueue(SOURCES[3], on[3])]
  const [muted, setMuted] = useState(readMuted)

  // Highest id seen per queue; undefined until that queue's first read (the baseline).
  const seen = useRef<Record<string, number | undefined>>({})
  const mutedRef = useRef(muted)

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  const signature = queues.map(q => `${q.loaded ? 1 : 0}:${q.newest}`).join('|')

  useEffect(() => {
    const fresh: string[] = []

    SOURCES.forEach((s, i) => {
      const q = queues[i]

      if (!q.loaded) return
      const before = seen.current[s.key]

      if (before !== undefined && q.newest > before) fresh.push(s.label)
      seen.current[s.key] = Math.max(before ?? 0, q.newest)
    })

    if (!fresh.length) return
    if (!mutedRef.current) chime()
    toast.info(`New: ${fresh.join(', ')}`)

    // `queues` is rebuilt every render; `signature` is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  if (!on.some(Boolean)) return null

  const total = queues.reduce((n, q) => n + q.count, 0)

  const toggleMute = () => {
    const next = !muted

    setMuted(next)

    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0')
    } catch {
      /* private window: mute lasts this visit */
    }

    if (!next) chime() // a click unlocks audio, and lets staff hear what it sounds like
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant='ghost' size='icon' className='relative' aria-label={`Notifications${total ? ` (${total} pending)` : ''}`} />}>
        <BellIcon />
        {total > 0 && (
          <span className='bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white tabular-nums'>
            {total > 99 ? '99+' : total}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 gap-2 p-3'>
        <div className='flex items-center justify-between'>
          <span className='text-heading font-semibold'>Notifications</span>
          <Button variant='ghost' size='icon-sm' onClick={toggleMute} aria-label={muted ? 'Turn sound on' : 'Mute sound'} title={muted ? 'Sound off' : 'Sound on'}>
            {muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
        </div>
        <ul className='flex flex-col'>
          {SOURCES.map((s, i) =>
            on[i] ? (
              <li key={s.key}>
                <Link href={s.href} className='hover:bg-muted flex items-center justify-between rounded-md px-2 py-2'>
                  <span>{s.label}</span>
                  <span className={queues[i].count ? 'bg-destructive/10 text-destructive rounded-full px-2 text-xs font-semibold tabular-nums' : 'text-muted-foreground text-xs tabular-nums'}>
                    {queues[i].count ? `${queues[i].count} pending` : 'None'}
                  </span>
                </Link>
              </li>
            ) : null
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export default AdminNotifications
