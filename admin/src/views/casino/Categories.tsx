'use client'

import { useMemo, useState } from 'react'

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import ErrorState from '@/components/shared/ErrorState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation, useInvalidate } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { notifyError } from '@/lib/notify'
import { artSrc, EditImage } from './EditImage'
import OrderedList, { type OrderedItem } from './OrderedList'
import type { GisGame, GisVendor } from './types'

/** A lobby section after Lobby and Originals (backend migration 158). */
export type LobbyCategory = { slug: string; name: string; sortOrder: number; active: boolean; count: number }

const BASE = 'admin/casino/games/categories'

/** A game's tile art, small, beside its name in the pickers. */
const Art = ({ src, className = 'size-6' }: { src?: string | null; className?: string }) =>
  src ? <img src={artSrc(src) ?? undefined} alt='' className={`${className} flex-none rounded object-cover`} /> : <span className={`${className} bg-muted flex-none rounded`} />

const gisItem = (g: GisGame): OrderedItem => ({ id: g.uuid, name: g.name, vendor: g.provider, type: g.type, image: g.image })
const gisSearch = async (q: string) => (await api.get<GisGame[]>('admin/casino/games/catalogue/search', { q, limit: 100 })).map(gisItem)

/** "Hot Games" -> `hot-games`, the backend's own rule (games.constants.js `categorySlug`). */
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** Provider → Type → Game: three dropdowns filled from the catalogue; Add appends the game, or every game of the type. */
export const ProviderTypeGamePicker = ({ onAdd, listed }: { onAdd: (items: OrderedItem[]) => void; listed: Set<string> }) => {
  const vendors = useApi<GisVendor[]>('admin/casino/games/vendors')
  const [vendor, setVendor] = useState('')
  const [type, setType] = useState('')
  const [game, setGame] = useState('')
  const games = useApi<GisGame[]>(vendor ? 'admin/casino/games/catalogue/pick' : null, { vendor })
  const types = useMemo(() => [...new Set((games.data ?? []).map(g => g.type ?? '').filter(Boolean))].sort(), [games.data])
  const ofType = useMemo(() => (games.data ?? []).filter(g => (!type || g.type === type) && !listed.has(g.uuid)), [games.data, type, listed])
  const chosen = ofType.find(g => g.uuid === game)

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Select
        value={vendor}
        onValueChange={v => {
          setVendor(String(v ?? ''))
          setType('')
          setGame('')
        }}
      >
        <SelectTrigger className='w-44'>
          <SelectValue placeholder='Provider…' />
        </SelectTrigger>
        <SelectContent>
          {(vendors.data ?? []).map(o => (
            <SelectItem key={o.vendor} value={o.vendor}>
              {o.vendor}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={type}
        onValueChange={v => {
          setType(String(v ?? ''))
          setGame('')
        }}
        disabled={!vendor || games.isLoading}
      >
        <SelectTrigger className='w-36'>
          <SelectValue placeholder='Type…' />
        </SelectTrigger>
        <SelectContent>
          {types.map(t => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={game} onValueChange={v => setGame(String(v ?? ''))} disabled={!vendor || !ofType.length}>
        <SelectTrigger className='w-56'>
          <SelectValue placeholder={vendor && !games.isLoading && !ofType.length ? 'All listed' : 'Game…'}>
            {() =>
              chosen && (
                <span className='flex min-w-0 items-center gap-2'>
                  <Art src={chosen.image} className='size-5' />
                  <span className='truncate'>{chosen.name}</span>
                </span>
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ofType.map(g => (
            <SelectItem key={g.uuid} value={g.uuid}>
              <span className='flex items-center gap-2'>
                <Art src={g.image} className='size-8' />
                {g.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant='outline'
        disabled={!chosen}
        onClick={() => {
          if (chosen) onAdd([gisItem(chosen)])
          setGame('')
        }}
      >
        <PlusIcon /> Add
      </Button>
      {type && ofType.length > 1 && (
        <Button variant='ghost' onClick={() => onAdd(ofType.map(gisItem))}>
          Add all {ofType.length}
        </Button>
      )}
    </div>
  )
}

/** The Add category form: a name, then its games picked Provider → Type → Game. */
const AddCategory = ({ onCreated }: { onCreated: (slug: string) => void }) => {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<OrderedItem[]>([])
  const [busy, setBusy] = useState(false)
  const invalidate = useInvalidate()
  const listed = useMemo(() => new Set(picked.map(p => p.id)), [picked])
  const slug = slugOf(name)

  const create = async () => {
    setBusy(true)

    try {
      const made = await api.post<LobbyCategory>(BASE, { name: name.trim() })

      if (picked.length) await api.patch(`${BASE}/${made.slug}`, { uuids: picked.map(p => p.id) })
      toast.success(`Category “${made.name}” added`)
      invalidate(['api', BASE])
      onCreated(made.slug)
      setOpen(false)
      setName('')
      setPicked([])
    } catch (e) {
      notifyError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> Add category
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>Add category</DialogTitle>
            <DialogDescription>A new section on the casino page, after Lobby and Originals. Pick its games by provider, then type, then name.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='category-name'>Name</Label>
            <Input id='category-name' autoFocus placeholder='Hot Games' maxLength={60} value={name} onChange={e => setName(e.target.value)} />
            {slug && <p className='text-muted-foreground text-xs'>Opens at /casino/{slug}</p>}
          </div>
          <div className='grid gap-2'>
            <Label>Games</Label>
            <ProviderTypeGamePicker listed={listed} onAdd={items => setPicked(p => [...p, ...items.filter(i => !p.some(x => x.id === i.id))])} />
            <div className='flex max-h-48 flex-wrap gap-1.5 overflow-auto'>
              {picked.map((p, i) => (
                <Badge key={p.id} variant='secondary' className='h-auto gap-1.5 py-1 font-normal'>
                  <Art src={p.image} className='size-6' />
                  {i + 1}. {p.name}
                  <button type='button' aria-label={`Remove ${p.name}`} onClick={() => setPicked(list => list.filter(x => x.id !== p.id))}>
                    <XIcon className='size-3' />
                  </button>
                </Badge>
              ))}
              {!picked.length && <p className='text-muted-foreground text-sm'>No games yet — they can also be added after creating it.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!slug || busy}>
              Create{picked.length ? ` with ${picked.length} games` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Casino → Lobby curation → Lobby categories: the casino page's sections after Lobby and Originals. */
export const CategoriesTab = () => {
  const { can } = useSession()
  const canWrite = can('casino:manage')
  const list = useApi<LobbyCategory[]>(BASE)
  const [picked, setPicked] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const current = list.data?.find(c => c.slug === picked) ?? list.data?.[0]
  const path = current ? `${BASE}/${current.slug}` : null
  const games = useApi<GisGame[]>(path, { limit: 5000, page: 1 })
  const items = useMemo(() => games.data?.map(gisItem), [games.data])

  // Re-read this category's games too (its own query key), or the list falls back to the pre-save rows.
  const save = useApiMutation({
    fn: (uuids: string[]) => api.patch(path as string, { uuids }),
    invalidate: [['api', BASE], ['api', path as string]],
    success: 'Category saved'
  })

  const toggle = useApiMutation({ fn: (active: boolean) => api.patch(path as string, { active }), invalidate: [['api', BASE]], success: (_, on) => (on ? 'Shown on the site' : 'Hidden from the site') })
  const remove = useApiMutation({ fn: () => api.delete(path as string), invalidate: [['api', BASE]], success: 'Category deleted' })
  const reorder = useApiMutation({ fn: (slugs: string[]) => api.put(`${BASE}/order`, { slugs }), invalidate: [['api', BASE]] })

  const move = (by: -1 | 1) => {
    const slugs = (list.data ?? []).map(c => c.slug)
    const at = slugs.indexOf(current?.slug ?? '')

    if (at < 0 || at + by < 0 || at + by >= slugs.length) return
    ;[slugs[at], slugs[at + by]] = [slugs[at + by], slugs[at]]
    reorder.mutate(slugs)
  }

  const at = (list.data ?? []).findIndex(c => c.slug === current?.slug)

  return (
    <div className='grid gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Select
          value={current?.slug ?? ''}
          onValueChange={v => {
            setPicked(String(v ?? ''))
            setConfirmDelete(false)
          }}
        >
          <SelectTrigger className='w-64'>
            <SelectValue placeholder='No categories yet'>{() => current?.name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(list.data ?? []).map((c, i) => (
              <SelectItem key={c.slug} value={c.slug}>
                {i + 1}. {c.name} · {c.count ? `${c.count} games` : 'automatic'}
                {c.active ? '' : ' · off'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canWrite && <AddCategory onCreated={setPicked} />}
        {current && canWrite && (
          <>
            <Button size='icon' variant='outline' aria-label='Move left in the strip' disabled={at <= 0 || reorder.isPending} onClick={() => move(-1)}>
              <ArrowUpIcon />
            </Button>
            <Button size='icon' variant='outline' aria-label='Move right in the strip' disabled={at === (list.data?.length ?? 0) - 1 || reorder.isPending} onClick={() => move(1)}>
              <ArrowDownIcon />
            </Button>
            <label className='flex items-center gap-2 text-sm'>
              <Switch checked={current.active} disabled={toggle.isPending} onCheckedChange={(on: boolean) => toggle.mutate(on)} /> Shown on site
            </label>
            <Button
              variant={confirmDelete ? 'destructive' : 'outline'}
              disabled={remove.isPending}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true)
                remove.mutate(undefined, { onSuccess: () => setPicked('') })
                setConfirmDelete(false)
              }}
            >
              <Trash2Icon /> {confirmDelete ? 'Click again to delete' : 'Delete'}
            </Button>
          </>
        )}
      </div>
      <p className='text-muted-foreground text-sm'>Lobby and Originals always come first on the site. A category with no games picked shows its automatic list until games are added here.</p>
      {list.error && <ErrorState error={list.error} />}
      {games.error && <ErrorState error={games.error} />}
      {current && (
        <OrderedList
          key={current.slug}
          items={items}
          loading={games.isLoading}
          search={gisSearch}
          onSave={ids => save.mutateAsync(ids)}
          canWrite={canWrite}
          max={5000}
          rowAction={g => <EditImage game={{ uuid: g.id, name: g.name, image: g.image ?? null }} onSaved={() => void games.refetch()} />}
          addControl={(add, listed) => <ProviderTypeGamePicker onAdd={add} listed={listed} />}
          header={
            <div className='grid gap-0.5'>
              <span className='font-medium'>{current.name}</span>
              {current.count === 0 && !!items?.length && (
                <span className='text-muted-foreground text-xs'>Showing the automatic list the site uses now (first 500). Reorder, add or remove, then Save to pin it.</span>
              )}
            </div>
          }
          emptyMessage='No games picked — the site shows this section’s automatic list. Pick Provider → Type → Game above to curate it.'
        />
      )}
    </div>
  )
}
