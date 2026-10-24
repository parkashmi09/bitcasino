'use client'

import { useCallback, useMemo, useState } from 'react'

import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'
import DateTime from '@/components/shared/DateTime'
import { EditImage } from './GameCatalogue'
import OrderedList, { type OrderedItem } from './OrderedList'
import type { GisGame, GisPriority, GisType, GisVendor } from './types'

const gisItem = (g: GisGame): OrderedItem => ({ id: g.uuid, name: g.name, vendor: g.provider, type: g.type, image: g.image })

/** The tile image editor for a listed game; a save re-reads the list so the new art shows. */
const imageAction = (refetch: () => unknown) => (g: OrderedItem) => <EditImage game={{ uuid: g.id, name: g.name, image: g.image ?? null }} onSaved={() => void refetch()} />

/** Aggregator collections — the four GIS home rows. */
const GIS_COLLECTIONS = [
  { value: 'hot', label: 'Hot games' },
  { value: 'live-casino', label: 'Live casino' },
  { value: 'popular-slots', label: 'Popular slots' },
  { value: 'crash', label: 'Crash games' }
]

const gisSearch = async (q: string) => (await api.get<GisGame[]>('admin/casino/games/catalogue/search', { q, limit: 100 })).map(gisItem)

/** Settings → Providers Priority (zip jaisa): home ke GIS collections ka order. */
export const CollectionsTab = ({ picker = true }: { picker?: boolean }) => {
  const { can } = useSession()
  const [collection, setCollection] = useState('hot')
  const path = `admin/casino/games/collections/${collection}`
  const list = useApi<GisGame[]>(path, { limit: 1000, page: 1 })
  const save = useApiMutation({ fn: (uuids: string[]) => api.put(path, { uuids }), invalidate: [['api', path]], success: 'Collection saved' })
  const items = useMemo(() => list.data?.map(gisItem), [list.data])

  return (
    <div className='grid gap-4'>
      {picker && (
        <Select value={collection} onValueChange={v => v && setCollection(String(v))}>
          <SelectTrigger className='w-64'>
            <SelectValue>{(v: string) => GIS_COLLECTIONS.find(c => c.value === v)?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GIS_COLLECTIONS.map(c => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {list.error && <ErrorState error={list.error} />}
      <OrderedList items={items} loading={list.isLoading} search={gisSearch} onSave={ids => save.mutateAsync(ids)} canWrite={can('casino:manage')} max={5000} rowAction={imageAction(list.refetch)} header={<span className='font-medium'>{GIS_COLLECTIONS.find(c => c.value === collection)?.label}</span>} />
    </div>
  )
}

/** Per-vendor or per-type pinned order in the aggregator catalogue. */
/** Settings → Vendor Priority / Type Priority (zip jaisa): pinned games ka order. */
export const PriorityTab = ({ kind }: { kind: 'vendor' | 'type' }) => {
  const { can } = useSession()
  const [key, setKey] = useState('')
  const options = useApi<(GisVendor | GisType)[]>(kind === 'vendor' ? 'admin/casino/games/vendors' : 'admin/casino/games/types')
  const path = key ? `admin/casino/games/${kind === 'vendor' ? 'priority' : 'type-priority'}/${encodeURIComponent(key)}` : null
  const priority = useApi<GisPriority>(path)
  const save = useApiMutation({ fn: (uuids: string[]) => api.put(path as string, { uuids }), invalidate: [['api', path]], success: 'Priority saved' })
  const items = useMemo(() => priority.data?.games.map(gisItem), [priority.data])
  const search = useCallback(async (q: string) => (await api.get<GisGame[]>(`admin/casino/games/${kind}-search`, { q, limit: 100, [kind]: key })).map(gisItem), [kind, key])
  const nameOf = (o: GisVendor | GisType) => String((o as GisVendor).vendor ?? (o as GisType).type)

  return (
    <div className='grid gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Select value={key} onValueChange={v => v && setKey(v)}>
          <SelectTrigger className='w-64'>
            <SelectValue placeholder={`Choose a ${kind}…`} />
          </SelectTrigger>
          <SelectContent>
            {(options.data ?? []).map(o => (
              <SelectItem key={nameOf(o)} value={nameOf(o)}>
                {nameOf(o)} {o.total !== undefined ? `· ${formatNumber(o.total)} games` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {priority.data && (
          <span className='text-muted-foreground text-sm'>
            {priority.data.updated_at ? (
              <>
                Pinned order saved <DateTime value={priority.data.updated_at} relative />
              </>
            ) : (
              'No pinned order — catalogue order applies.'
            )}
          </span>
        )}
      </div>
      {options.error && <ErrorState error={options.error} />}
      {options.data && options.data.length === 0 && <p className='text-muted-foreground text-sm'>The aggregator catalogue is empty. Sync games first (Game catalogue → Providers & sync).</p>}
      {priority.error && <ErrorState error={priority.error} />}
      {key ? (
        <OrderedList items={items} loading={priority.isLoading} search={search} onSave={ids => save.mutateAsync(ids)} canWrite={can('casino:manage')} max={5000} rowAction={imageAction(priority.refetch)} header={<span className='font-medium capitalize'>{kind}: {key}</span>} />
      ) : (
        <p className='text-muted-foreground text-sm'>Pick a {kind} to pin games to the top of its list.</p>
      )}
    </div>
  )
}

const SCOPES = [
  { value: 'collection', label: 'Home collection' },
  { value: 'vendor', label: 'Provider' },
  { value: 'type', label: 'Type' }
] as const

/** Casino → Lobby curation: the Slotegrator lobby the site renders — a home collection, or a provider's / type's pinned games. Per game: change its tile image, move it, remove it; Add games appends from the catalogue. */
const Curation = () => {
  const [scope, setScope] = useState<(typeof SCOPES)[number]['value']>('collection')

  return (
    <div className='grid gap-4'>
      <PageHeader title='Lobby curation' description='Pick a home collection, a provider or a type; then change any game’s image, set its priority (Top / ↑ / ↓ / Bottom), add or remove games, and Save.' />
      <Select value={scope} onValueChange={v => v && setScope(v as typeof scope)}>
        <SelectTrigger className='w-48'>
          <SelectValue>{(v: string) => SCOPES.find(s => s.value === v)?.label ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SCOPES.map(s => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {scope === 'collection' ? <CollectionsTab /> : <PriorityTab key={scope} kind={scope} />}
    </div>
  )
}

export default Curation
