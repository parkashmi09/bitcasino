'use client'

import { useMemo, useState } from 'react'

import { Loader2Icon, LockIcon, RotateCcwIcon, SaveIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import type { ProviderSetting } from '@/views/casino/types'
import { useOwnerCoinFilter } from '@/views/finance/useCurrencyCodes'
import { CRYPTO_COIN_FLAGS, CRYPTO_MASTER_FLAG, FLAG_FEATURE, FLAG_GROUPS, FLAGS_ELSEWHERE, flagLabel } from './flagGroups'

type Flags = Record<string, boolean>

const PROVIDERS = 'admin/casino/games/provider-settings'

/** Only the boolean columns are switches; anything else the backend adds (e.g. an `entitled` map) is not. */
const onlyBooleans = (data: Record<string, unknown>): Flags =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === 'boolean')) as Flags

const FeatureFlags = () => {
  const { can, refreshFlags, flagEntitled: flagInPlan, featureEntitled } = useSession()

  // In the owner's plan: the flag, and the owner feature it belongs to (lottery, spin wheel, club …).
  const inPlan = (key: string) => flagInPlan(key) && featureEntitled(FLAG_FEATURE[key])

  // In the owner's plan: the flag itself, and for a crypto coin the crypto master switch as well.
  const ownerCoins = useOwnerCoinFilter()
  const COIN_FLAGS = new Set(FLAG_GROUPS.filter(g => g.title === 'Fiat currencies' || g.title === 'Crypto currencies').flatMap(g => g.keys).filter(k => k !== CRYPTO_MASTER_FLAG))

  // A coin flag is listed only for a coin the owner picked (owner panel → Coins): INR + USDT picked → only those.
  const flagEntitled = (key: string) =>
    inPlan(key) && !(CRYPTO_COIN_FLAGS.has(key) && !inPlan(CRYPTO_MASTER_FLAG)) && (!COIN_FLAGS.has(key) || ownerCoins([key]).length > 0)

  const flags = useApi<Flags>('admin/site-config/global', undefined, { select: data => onlyBooleans(data) })
  const [draft, setDraft] = useState<Flags>({})
  const [filter, setFilter] = useState('')
  const canWrite = can('config:write')

  // A fresh load replaces the draft (adjusting state during render, not in an effect).
  const [loaded, setLoaded] = useState<Flags | undefined>(undefined)

  if (flags.data && flags.data !== loaded) {
    setLoaded(flags.data)
    setDraft(flags.data)
  }

  const flagsDirty = useMemo(() => Object.keys(draft).filter(k => flags.data && draft[k] !== flags.data[k]), [draft, flags.data])

  // Providers: the lobby's live provider list (casino provider settings), switched on the same Save.
  const providers = useApi<ProviderSetting[]>(PROVIDERS, undefined, { retry: false })
  const [provDraft, setProvDraft] = useState<Flags>({})
  const [provLoaded, setProvLoaded] = useState<ProviderSetting[] | undefined>(undefined)
  const provSaved = useMemo(() => Object.fromEntries((providers.data ?? []).map(p => [p.name, p.enabled])) as Flags, [providers.data])

  if (providers.data && providers.data !== provLoaded) {
    setProvLoaded(providers.data)
    setProvDraft(provSaved)
  }

  const provDirty = Object.keys(provDraft).filter(k => provDraft[k] !== provSaved[k])
  const dirty = [...flagsDirty, ...provDirty]

  const save = useApiMutation({
    fn: async () => {
      const patch: Flags = {}

      for (const k of flagsDirty) patch[k] = draft[k]
      if (flagsDirty.length) await api.put<Flags>('admin/site-config/global', patch)
      for (const name of provDirty) await api.patch(`${PROVIDERS}/${encodeURIComponent(name)}`, { enabled: provDraft[name] })
    },
    invalidate: [['api', 'admin/site-config/global'], ['api', PROVIDERS]],
    success: () => `${dirty.length} switch${dirty.length === 1 ? '' : 'es'} saved`,
    onSuccess: () => refreshFlags()
  })

  const reset = () => {
    if (flags.data) setDraft(flags.data)
    setProvDraft(provSaved)
  }

  const known = new Set(FLAG_GROUPS.flatMap(g => g.keys))
  const other = Object.keys(draft).filter(k => !known.has(k) && !FLAGS_ELSEWHERE.has(k))
  const groups = other.length ? [...FLAG_GROUPS, { title: 'Other', description: 'Columns the platform returns that this screen does not yet know by name.', keys: other }] : FLAG_GROUPS
  const q = filter.trim().toLowerCase()

  return (
    <div>
      <PageHeader
        title='Feature flags'
        description='Every switch decides whether a section of the site renders. Saved to the platform; the site reads them on the next page load.'
        actions={
          <>
            <Input placeholder='Filter flags…' value={filter} onChange={e => setFilter(e.target.value)} className='w-48' />
            <Button variant='outline' disabled={!dirty.length || save.isPending} onClick={reset}>
              <RotateCcwIcon /> Reset
            </Button>
            <Button disabled={!dirty.length || save.isPending || !canWrite} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2Icon className='animate-spin' /> : <SaveIcon />}
              Save {dirty.length ? `(${dirty.length})` : ''}
            </Button>
          </>
        }
      />

      {flags.error && <ErrorState error={flags.error} />}
      {!canWrite && flags.data && (
        <p className='text-muted-foreground mb-4 text-sm'>Your role can read these flags but not change them (needs <code>config:write</code>).</p>
      )}

      <div className='grid gap-6 lg:grid-cols-2'>
        {groups.map(group => {
          // A flag the owner left out of the plan is not listed at all (it cannot be switched on here).
          const keys = group.keys.filter(k => k in draft && flagEntitled(k) && (!q || k.includes(q) || flagLabel(k).toLowerCase().includes(q)))

          if (flags.data && keys.length === 0) return null

          return (
            <Card key={group.title} className='shadow-none'>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-base'>
                  {group.title}
                  {flags.data && (
                    <Badge variant='secondary' className='font-normal'>
                      {keys.filter(k => draft[k]).length}/{keys.length} on
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{group.description}</CardDescription>
              </CardHeader>
              <CardContent className='grid gap-1 sm:grid-cols-2'>
                {flags.isLoading
                  ? group.keys.slice(0, 6).map(k => <Skeleton key={k} className='h-9' />)
                  : keys.map(key => {
                      const changed = flags.data && draft[key] !== flags.data[key]

                      // Left out of the plan by the owner: locked and shown off, whatever the site saved.
                      const planned = flagEntitled(key)

                      return (
                        <label
                          key={key}
                          className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${!planned ? 'cursor-not-allowed border-transparent opacity-60' : changed ? 'cursor-pointer border-primary/60 bg-primary/5' : 'cursor-pointer border-transparent hover:bg-muted/50'}`}
                        >
                          <span className='min-w-0'>
                            <span className='block truncate'>{flagLabel(key)}</span>
                            <span className='text-muted-foreground block truncate font-mono text-xs'>{key}</span>
                            {!planned && (
                              <Badge variant='outline' className='mt-1 gap-1 font-normal'>
                                <LockIcon className='size-3' /> Not in your plan
                              </Badge>
                            )}
                          </span>
                          <Switch
                            checked={planned && !!draft[key]}
                            disabled={!canWrite || !planned}
                            onCheckedChange={v => setDraft(d => ({ ...d, [key]: v }))}
                          />
                        </label>
                      )
                    })}
              </CardContent>
            </Card>
          )
        })}

        {(providers.data?.length ?? 0) > 0 && (
          <ProvidersCard
            providers={(providers.data ?? []).filter(p => !q || p.name.toLowerCase().includes(q) || (p.displayName ?? '').toLowerCase().includes(q))}
            draft={provDraft}
            saved={provSaved}
            canWrite={canWrite}
            onChange={(name, v) => setProvDraft(d => ({ ...d, [name]: v }))}
          />
        )}
      </div>
    </div>
  )
}

/** The lobby's providers, one switch each: off takes every game of that provider off the site. */
const ProvidersCard = ({
  providers,
  draft,
  saved,
  canWrite,
  onChange
}: {
  providers: ProviderSetting[]
  draft: Flags
  saved: Flags
  canWrite: boolean
  onChange: (name: string, v: boolean) => void
}) => (
  <Card className='shadow-none lg:col-span-2'>
    <CardHeader>
      <CardTitle className='flex items-center gap-2 text-base'>
        Providers
        <Badge variant='secondary' className='font-normal'>
          {providers.filter(p => draft[p.name]).length}/{providers.length} on
        </Badge>
      </CardTitle>
      <CardDescription>Game providers in the casino lobby. Off takes every one of its games off the site (lobby, search and launch).</CardDescription>
    </CardHeader>
    <CardContent className='grid gap-1 sm:grid-cols-2 xl:grid-cols-3'>
      {providers.map(p => {
        const changed = draft[p.name] !== saved[p.name]

        return (
          <label
            key={p.name}
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${changed ? 'border-primary/60 bg-primary/5' : 'border-transparent hover:bg-muted/50'}`}
          >
            <span className='min-w-0'>
              <span className='block truncate'>{p.displayName ?? p.name}</span>
              <span className='text-muted-foreground block truncate text-xs'>{p.games} games</span>
            </span>
            <Switch checked={!!draft[p.name]} disabled={!canWrite} onCheckedChange={v => onChange(p.name, v)} />
          </label>
        )
      })}
    </CardContent>
  </Card>
)

export default FeatureFlags
