'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api, request } from '@/lib/api/client'
import { setPlainInr } from '@/lib/format'
import { useRealtimeConnected } from '@/lib/realtime-status'

export type Actor = {
  staffId: number
  roleId: number
  roleName: string
  level: number
  executiveId: number | null

  /** A marketing sub-login (`executives.kind = 'marketing'`) — the only session the marketing panel serves. */
  marketing?: boolean

  /**
   * May this session see promotions at all (bonus, redeem codes, gift cards, spin wheel, VIP &
   * club, affiliate, races, rakeback, VIP/rank columns)? False for the agent tree — staff levels
   * 4–6 and their executives. Computed by `/api/auth/me`; re-derived from `level` here as a guard.
   */
  promotions: boolean

  /** May this session see anything about DIRECT users? Only the Super Admin and its executives (`/api/auth/me`). */
  direct: boolean
  permissions: string[]
  expiresAt: string
  name?: string
  email?: string

  /**
   * The password is one somebody else chose (a new account, or a reset by a superior). Every
   * admin API but "who am I", change-password and logout answers 403 PASSWORD_CHANGE_REQUIRED
   * until it is replaced; the shell sends the user to `/change-password`.
   */
  mustChangePassword?: boolean
}

/** The operator feature flags — `GET admin/site-config/global`. Keys are the platform's columns. */
export type SiteFlags = Record<string, boolean>

/**
 * What the platform owner allows this site — `GET admin/entitlements`. `false` = not in the
 * plan; a missing key (or a backend without the route) = entitled.
 */
export type Entitlements = {
  features: Record<string, boolean>
  flags: Record<string, boolean>
  version?: number
  fetchedAt?: string | null
  source?: 'owner' | 'cache' | 'default'

  /** The template the owner set, when the backend sends it with the plan (a key or `{ key, label }`). */
  template?: string | { key: string; label?: string } | null
}

type SessionValue = {
  actor: Actor | null
  loading: boolean

  /** `resource:action` → does the current role hold it (exact, `resource:*`, or `*`). */
  can: (permission?: string | string[]) => boolean
  flags: SiteFlags
  flagsLoading: boolean
  refreshFlags: () => void
  entitlements: Entitlements | null

  /** True unless the owner has taken this feature (`gift_cards`, `vault`, …) out of the plan. */
  featureEntitled: (key?: string | null) => boolean

  /** True unless the owner has taken this siteconfig flag (`casino`, `giftcards`, …) out of the plan. */
  flagEntitled: (key?: string | null) => boolean
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

/** How often the owner's plan is re-read (cheap: an in-memory read on the backend). */
const ENTITLEMENTS_POLL_MS = 4_000

/** How often the operator's own feature flags are re-read for the sidebar. */
const FLAGS_POLL_MS = 15_000

/** Staff levels 4–6 (SUPER_MASTER, MASTER, AGENT): the agent tree, which sees no promotions. */
export const isAgentTreeLevel = (level?: number | null) => typeof level === 'number' && level >= 4 && level <= 6

export function hasPermission(granted: string[] | undefined, required: string): boolean {
  if (!granted?.length) return false
  if (granted.includes('*') || granted.includes(required)) return true
  const [resource] = required.split(':')

  return granted.includes(`${resource}:*`)
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()

  const me = useQuery<Actor>({
    queryKey: ['session', 'me'],
    queryFn: () =>
      request<Actor>('/api/auth/me', { raw: true }).then(r => {
        const direct = r.data.direct === true && !isAgentTreeLevel(r.data.level)

        setPlainInr(!direct)

        return { ...r.data, promotions: r.data.promotions !== false && !isAgentTreeLevel(r.data.level), direct }
      }),
    staleTime: 60_000,
    retry: false
  })

  // Socket up: owner / operator saves arrive as pushes (RealtimeRefresh), so no timers; down: the polls below.
  const live = useRealtimeConnected()
  const poll = (ms: number) => (live ? false : ms)

  const flags = useQuery<SiteFlags>({
    queryKey: ['api', 'admin/site-config/global', null],
    queryFn: () => api.get<SiteFlags>('admin/site-config/global'),
    enabled: !!me.data && hasPermission(me.data.permissions, 'config:read'),
    staleTime: 10_000,

    // The poll keeps it fresh. A remount of this observer (a Suspense boundary re-showing the
    // shell after a URL change, e.g. picking a date range) must not fire an extra read.
    refetchOnMount: false,

    // Another tab (or another operator) may switch a flag; the sidebar follows without a reload.
    refetchInterval: poll(FLAGS_POLL_MS),
    refetchOnWindowFocus: true
  })

  // A backend without the route (404) or any other failure reads as "everything entitled",
  // so a site that has no owner panel keeps working exactly as before.
  const entitlements = useQuery<Entitlements | null>({
    queryKey: ['api', 'admin/entitlements', null],
    queryFn: () =>
      api
        .get<Partial<Entitlements>>('admin/entitlements')
        .then(d => ({ ...d, features: d?.features ?? {}, flags: d?.flags ?? {} }))
        .catch(() => null),
    enabled: !!me.data && hasPermission(me.data.permissions, 'config:read'),

    // Just under the poll interval: the 4 s poll still runs (refetchInterval ignores staleTime),
    // but a URL change, a remount or a focus within that window reuses the read instead of
    // firing it again — a date-range pick used to refetch it 4×.
    staleTime: ENTITLEMENTS_POLL_MS - 1_000,
    refetchOnMount: false,
    retry: false,

    // The owner can change the plan at any time; the backend re-pulls it the moment the owner saves,
    // so a short poll here is what makes the sidebar and the Features screens follow live.
    refetchInterval: poll(ENTITLEMENTS_POLL_MS),
    refetchOnWindowFocus: true
  })

  // Without `config:read` (the agent tree, executives) the plan above is never read, and every
  // feature used to read as entitled: their sidebar listed Tips, Gift cards, Spin wheel and Swap
  // history on a site where those are off. The site's public feature list (what players get: only
  // the features that are ON) answers the same question for them.
  const liveFeatures = useQuery<Set<string> | null>({
    queryKey: ['api', 'admin/features/public', null],
    queryFn: () =>
      api
        .get<Array<{ feature: string }>>('admin/features/public')
        .then(list => (Array.isArray(list) ? new Set(list.map(f => f.feature)) : null))
        .catch(() => null),
    enabled: !!me.data && !hasPermission(me.data.permissions, 'config:read'),
    staleTime: ENTITLEMENTS_POLL_MS - 1_000,
    refetchInterval: poll(ENTITLEMENTS_POLL_MS * 4),
    refetchOnWindowFocus: true,
    retry: false
  })

  // A new plan version (or a new template from the owner) changes what the per-row `entitled`
  // marks, the flag switches and the template card say, so every features / site-config read is
  // refetched (the open screen updates in place).
  const seenVersion = useRef<string | undefined>(undefined)
  const rawTemplate = entitlements.data?.template
  const templateKey = typeof rawTemplate === 'string' ? rawTemplate : (rawTemplate?.key ?? '')

  const version =
    entitlements.data?.version === undefined && !templateKey
      ? undefined
      : `${entitlements.data?.version ?? ''}|${templateKey}`

  useEffect(() => {
    if (version === undefined) return
    const previous = seenVersion.current

    seenVersion.current = version
    if (previous === undefined || previous === version) return
    void qc.invalidateQueries({
      predicate: q =>
        q.queryKey[0] === 'api' &&
        typeof q.queryKey[1] === 'string' &&
        (q.queryKey[1].startsWith('admin/features') || q.queryKey[1].startsWith('admin/site-config'))
    })
  }, [version, qc])

  const featureEntitled = useCallback(
    (key?: string | null) => {
      if (!key) return true
      if (entitlements.data) return entitlements.data.features[key] !== false

      return liveFeatures.data ? liveFeatures.data.has(key) : true
    },
    [entitlements.data, liveFeatures.data]
  )

  /* Same rule as the backend's `flagOnIn` (packages/common/src/entitlements.js): the sportsbook is
     off unless the owner switched it on, and while it is on the exchange reads off — sports runs
     one mode at a time, so every exchange screen hides. */
  const flagEntitled = useCallback(
    (key?: string | null): boolean => {
      if (!key) return true
      const flagsDoc = entitlements.data?.flags ?? {}
      const on = (k: string) => (flagsDoc[k] === undefined ? k !== 'sportsbook' : flagsDoc[k] !== false)

      return key === 'sportsexchange' ? on(key) && !on('sportsbook') : on(key)
    },
    [entitlements.data]
  )

  const can = useCallback(
    (permission?: string | string[]) => {
      if (!permission || (Array.isArray(permission) && permission.length === 0)) return true
      const list = Array.isArray(permission) ? permission : [permission]

      return list.some(p => hasPermission(me.data?.permissions, p))
    },
    [me.data]
  )

  const signOut = useCallback(async () => {
    await request('/api/auth/logout', { raw: true, method: 'POST', body: {} }).catch(() => undefined)
    qc.clear()
    location.assign('/login')
  }, [qc])

  const value = useMemo<SessionValue>(
    () => ({
      actor: me.data ?? null,
      loading: me.isLoading,
      can,
      flags: flags.data ?? {},
      flagsLoading: flags.isLoading,
      refreshFlags: () => {
        void qc.invalidateQueries({ queryKey: ['api', 'admin/site-config/global'] })
        void qc.invalidateQueries({ queryKey: ['api', 'admin/entitlements'] })
      },
      entitlements: entitlements.data ?? null,
      featureEntitled,
      flagEntitled,
      signOut
    }),
    [me.data, me.isLoading, can, flags.data, flags.isLoading, entitlements.data, featureEntitled, flagEntitled, qc, signOut]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)

  if (!ctx) throw new Error('useSession must be used inside SessionProvider')

  return ctx
}
