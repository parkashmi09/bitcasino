'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { ArrowDownIcon, ArrowDownToLineIcon, ArrowUpIcon, ArrowUpToLineIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon, GripVerticalIcon, Loader2Icon, PlusIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api/client'
import { notifyError } from '@/lib/notify'
import { artSrc } from './EditImage'

export type OrderedItem = { id: string; name: string; vendor?: string | null; type?: string | null; image?: string | null; inactive?: boolean }

type Props = {

  /** The saved order from the platform. `undefined` while loading. */
  items: OrderedItem[] | undefined
  loading?: boolean

  /** Runs the picker search; returns candidates (already-listed ids are filtered out here). */
  search: (q: string) => Promise<OrderedItem[]>
  onSave: (ids: string[]) => Promise<unknown>
  canWrite: boolean
  max?: number
  header?: ReactNode
  emptyMessage?: string

  /** An extra per-row control (e.g. the tile image editor), drawn before the priority arrows. */
  rowAction?: (item: OrderedItem) => ReactNode

  /** A list whose games are fixed (a vendor's or type's own): no Add games, no remove — only image and order. */
  fixed?: boolean

  /** Another way to append games (e.g. Provider → Type → Game), drawn beside Add games. */
  addControl?: (add: (items: OrderedItem[]) => void, listed: Set<string>) => ReactNode
}

// Lazy: a long list loads only the art of the rows on screen.
const Thumb = ({ src, alt }: { src?: string | null; alt: string }) =>
  src ? <img src={artSrc(src) ?? undefined} alt={alt} loading='lazy' decoding='async' className='size-9 rounded object-cover' /> : <div className='bg-muted size-9 rounded' />

/** Rows per page of the table; the order and Save always cover the whole list. */
const PAGE_SIZES = [50, 100, 200] as const

const Picker = ({ search, exclude, onAdd, disabled }: { search: Props['search']; exclude: Set<string>; onAdd: (items: OrderedItem[]) => void; disabled?: boolean }) => {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<OrderedItem[]>([])
  const [busy, setBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Map<string, OrderedItem>>(new Map())

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const t = setTimeout(() => {
      setBusy(true)
      setSearchError(null)
      search(q)
        .then(r => !cancelled && setResults(r))
        .catch(e => {
          if (cancelled) return
          setResults([])
          setSearchError(errorMessage(e))
        })
        .finally(() => !cancelled && setBusy(false))
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, open, search])

  const toggle = (item: OrderedItem) =>
    setPicked(p => {
      const next = new Map(p)

      if (next.has(item.id)) next.delete(item.id)
      else next.set(item.id, item)

      return next
    })

  const add = () => {
    onAdd([...picked.values()])
    setPicked(new Map())
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={false} render={<span />}>
        <Button variant='outline' disabled={disabled}>
          <PlusIcon /> Add games
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Add games</DialogTitle>
          <DialogDescription>Search the catalogue and tick the games to append to the end of the list.</DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder='Search by name…' value={q} onChange={e => setQ(e.target.value)} />
        <div className='max-h-80 overflow-auto rounded-md border'>
          {busy && results.length === 0 ? (
            <div className='text-muted-foreground flex items-center gap-2 p-4 text-sm'>
              <Loader2Icon className='size-4 animate-spin' /> Searching…
            </div>
          ) : (
            <Table>
              <TableBody>
                {results
                  .filter(r => !exclude.has(r.id))
                  .map(r => (
                    <TableRow key={r.id} className='cursor-pointer' onClick={() => toggle(r)}>
                      <TableCell className='w-8'>
                        <Checkbox checked={picked.has(r.id)} onCheckedChange={() => toggle(r)} onClick={e => e.stopPropagation()} />
                      </TableCell>
                      <TableCell className='w-12'>
                        <Thumb src={r.image} alt={r.name} />
                      </TableCell>
                      <TableCell>
                        <div className='font-medium'>{r.name}</div>
                        <div className='text-muted-foreground font-mono text-xs'>{r.id}</div>
                      </TableCell>
                      <TableCell className='text-muted-foreground text-sm'>
                        {r.vendor} {r.type ? `· ${r.type}` : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                {!busy && results.filter(r => !exclude.has(r.id)).length === 0 && (
                  <TableRow>
                    <TableCell className={`h-16 text-center ${searchError ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {searchError ? `Search failed: ${searchError}` : 'No matches (or everything found is already listed).'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={add} disabled={picked.size === 0}>
            Add {picked.size || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** An ordered list with move/remove/add and a dirty-gated save. The order is the whole value: saving PUTs every id. */
const OrderedList = ({ items, loading, search, onSave, canWrite, max, header, emptyMessage = 'Nothing curated yet. Add games to build the list.', rowAction, addControl, fixed = false }: Props) => {
  const [edited, setEdited] = useState<OrderedItem[] | null>(null)
  const draft = useMemo(() => edited ?? items ?? [], [edited, items])
  const [saving, setSaving] = useState(false)

  // Provider breakdown (a chip per provider, click to see only its games), row selection and drag.
  const [vendor, setVendor] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const [pageBox, setPageBox] = useState({ key: '', page: 1 })

  const setDraft = (fn: (d: OrderedItem[]) => OrderedItem[]) => setEdited(prev => fn(prev ?? items ?? []))

  const dirty = useMemo(() => !!items && (items.length !== draft.length || items.some((it, i) => it.id !== draft[i]?.id)), [items, draft])
  const ids = useMemo(() => new Set(draft.map(d => d.id)), [draft])

  /** Providers in the order they first appear, with how many games each has in the list. */
  const vendors = useMemo(() => {
    const counts = new Map<string, number>()

    for (const d of draft) counts.set(d.vendor ?? '—', (counts.get(d.vendor ?? '—') ?? 0) + 1)

    return [...counts]
  }, [draft])

  const shown = useMemo(() => draft.map((item, index) => ({ item, index })).filter(({ item }) => vendor === null || (item.vendor ?? '—') === vendor), [draft, vendor])

  // The page resets when the provider filter or page size changes (derived, not an effect).
  const pageKey = `${vendor}|${pageSize}`
  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const page = Math.min(pageBox.key === pageKey ? pageBox.page : 1, pages)
  const setPage = (next: number) => setPageBox({ key: pageKey, page: next })
  const pageRows = useMemo(() => shown.slice((page - 1) * pageSize, page * pageSize), [shown, page, pageSize])

  const add = (added: OrderedItem[]) => setDraft(d => [...d, ...added.filter(a => !d.some(x => x.id === a.id))])

  const move = (from: number, to: number) =>
    setDraft(d => {
      if (to < 0 || to >= d.length) return d

      const next = [...d]
      const [item] = next.splice(from, 1)

      next.splice(to, 0, item)

      return next
    })

  /** Dropping a row on another puts it at that row's place in the WHOLE list, also while one provider is shown. */
  const drop = (targetId: string) => {
    const from = draft.findIndex(d => d.id === dragId)
    const to = draft.findIndex(d => d.id === targetId)

    if (from >= 0 && to >= 0 && from !== to) move(from, to)
    setDragId(null)
    setOverId(null)
  }

  /** The ticked rows, kept in their order, moved to the top or bottom together. */
  const moveSelected = (where: 'top' | 'bottom') =>
    setDraft(d => {
      const picked = d.filter(x => selected.has(x.id))
      const rest = d.filter(x => !selected.has(x.id))

      return where === 'top' ? [...picked, ...rest] : [...rest, ...picked]
    })

  const toggle = (id: string) =>
    setSelected(s => {
      const next = new Set(s)

      if (next.has(id)) next.delete(id)
      else next.add(id)

      return next
    })

  const allShownPicked = pageRows.length > 0 && pageRows.every(({ item }) => selected.has(item.id))

  const save = async () => {
    setSaving(true)

    try {
      await onSave(draft.map(d => d.id))
      setEdited(null)
    } catch (e) {
      // The mutation has toasted already; anything else is toasted here.
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const overMax = max !== undefined && draft.length > max

  return (
    <Card className='gap-0 overflow-hidden py-0 shadow-none'>
      <div className='flex flex-wrap items-center gap-3 border-b p-4'>
        <div className='min-w-0 flex-1'>{header}</div>
        <Badge variant='secondary' className='font-normal'>
          {draft.length}
          {max ? ` / ${max}` : ''} games
        </Badge>
        {canWrite && addControl && <div className='order-last basis-full'>{addControl(add, ids)}</div>}
        {!fixed && <Picker search={search} exclude={ids} disabled={!canWrite} onAdd={add} />}
        <Button variant='outline' disabled={!dirty || saving} onClick={() => setEdited(null)}>
          <RotateCcwIcon /> Reset
        </Button>
        <Button disabled={!dirty || saving || !canWrite || overMax} onClick={save}>
          {saving ? <Loader2Icon className='animate-spin' /> : <SaveIcon />} Save order
        </Button>
      </div>
      {vendors.length > 0 && (
        <div className='flex flex-wrap items-center gap-1.5 border-b px-4 py-3'>
          <span className='text-muted-foreground mr-1 text-xs'>By provider</span>
          <Button size='xs' variant={vendor === null ? 'default' : 'outline'} onClick={() => setVendor(null)}>
            All · {draft.length}
          </Button>
          {vendors.map(([name, count]) => (
            <Button key={name} size='xs' variant={vendor === name ? 'default' : 'outline'} onClick={() => setVendor(v => (v === name ? null : name))}>
              {name} · {count}
            </Button>
          ))}
        </div>
      )}
      {selected.size > 0 && (
        <div className='bg-muted/40 flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm'>
          <span className='font-medium'>{selected.size} selected</span>
          <Button size='sm' variant='outline' disabled={!canWrite} onClick={() => moveSelected('top')}>
            <ArrowUpToLineIcon /> Move to top
          </Button>
          <Button size='sm' variant='outline' disabled={!canWrite} onClick={() => moveSelected('bottom')}>
            <ArrowDownToLineIcon /> Move to bottom
          </Button>
          {!fixed && (
          <Button
            size='sm'
            variant='outline'
            className='text-destructive'
            disabled={!canWrite}
            onClick={() => {
              setDraft(d => d.filter(x => !selected.has(x.id)))
              setSelected(new Set())
            }}
          >
            <Trash2Icon /> Remove
          </Button>
          )}
          <Button size='sm' variant='ghost' onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {overMax && <p className='text-destructive border-b px-4 py-2 text-sm'>This list may hold at most {max} games. Remove some before saving.</p>}
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-8 pl-4'>
                <Checkbox
                  aria-label='Select this page'
                  checked={allShownPicked}
                  disabled={!canWrite || pageRows.length === 0}
                  onCheckedChange={() =>
                    setSelected(s => {
                      const next = new Set(s)

                      for (const { item } of pageRows) {
                        if (allShownPicked) next.delete(item.id)
                        else next.add(item.id)
                      }

                      return next
                    })
                  }
                />
              </TableHead>
              <TableHead className='w-12'>#</TableHead>
              <TableHead className='w-14'></TableHead>
              <TableHead>Game</TableHead>
              <TableHead>Vendor / type</TableHead>
              <TableHead className='w-52 pr-4 text-right'>{rowAction ? 'Image / priority' : 'Priority'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !items ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6} className='px-4'>
                    <Skeleton className='h-6 w-full' />
                  </TableCell>
                </TableRow>
              ))
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className='text-muted-foreground h-24 text-center'>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map(({ item: g, index: i }) => (
                <TableRow
                  key={g.id}
                  draggable={canWrite}
                  onDragStart={e => {
                    setDragId(g.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={e => {
                    if (!dragId) return
                    e.preventDefault()
                    setOverId(g.id)
                  }}
                  onDrop={e => {
                    e.preventDefault()
                    drop(g.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setOverId(null)
                  }}
                  className={[
                    canWrite ? 'cursor-grab active:cursor-grabbing' : '',
                    dragId === g.id ? 'opacity-40' : '',
                    overId === g.id && dragId !== g.id ? 'border-primary border-t-2' : '',
                    items && items[i]?.id !== g.id ? 'bg-primary/5' : ''
                  ].join(' ')}
                >
                  <TableCell className='pl-4'>
                    <div className='flex items-center gap-1'>
                      {canWrite && <GripVerticalIcon className='text-muted-foreground size-4' aria-hidden />}
                      <Checkbox aria-label={`Select ${g.name}`} checked={selected.has(g.id)} disabled={!canWrite} onCheckedChange={() => toggle(g.id)} />
                    </div>
                  </TableCell>
                  <TableCell className='text-muted-foreground tabular-nums'>{i + 1}</TableCell>
                  <TableCell>
                    <Thumb src={g.image} alt={g.name} />
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-2 font-medium'>
                      {g.name}
                      {g.inactive && (
                        <Badge variant='outline' className='font-normal'>
                          inactive
                        </Badge>
                      )}
                    </div>
                    <div className='text-muted-foreground font-mono text-xs'>{g.id}</div>
                  </TableCell>
                  <TableCell className='text-muted-foreground text-sm'>
                    {g.vendor ?? '—'} {g.type ? `· ${g.type}` : ''}
                  </TableCell>
                  <TableCell className='pr-4'>
                    <div className='flex justify-end gap-1'>
                      {canWrite && rowAction?.(g)}
                      <Button size='icon-sm' variant='ghost' disabled={!canWrite || i === 0} onClick={() => move(i, 0)} aria-label='Top'>
                        <ArrowUpToLineIcon />
                      </Button>
                      <Button size='icon-sm' variant='ghost' disabled={!canWrite || i === 0} onClick={() => move(i, i - 1)} aria-label='Up'>
                        <ArrowUpIcon />
                      </Button>
                      <Button size='icon-sm' variant='ghost' disabled={!canWrite || i === draft.length - 1} onClick={() => move(i, i + 1)} aria-label='Down'>
                        <ArrowDownIcon />
                      </Button>
                      <Button size='icon-sm' variant='ghost' disabled={!canWrite || i === draft.length - 1} onClick={() => move(i, draft.length - 1)} aria-label='Bottom'>
                        <ArrowDownToLineIcon />
                      </Button>
                      {!fixed && (
                        <Button size='icon-sm' variant='ghost' className='text-destructive' disabled={!canWrite} onClick={() => setDraft(d => d.filter(x => x.id !== g.id))} aria-label='Remove'>
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {shown.length > PAGE_SIZES[0] && (
        <div className='flex flex-wrap items-center justify-between gap-3 border-t border-dashed px-4 py-3'>
          <p className='text-muted-foreground text-sm tabular-nums'>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, shown.length)} of {shown.length}
          </p>
          <div className='flex items-center gap-2'>
            <Select value={String(pageSize)} onValueChange={v => v && setPageSize(Number(v))}>
              <SelectTrigger className='h-8 w-28'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map(n => (
                  <SelectItem key={n} value={String(n)}>
                    {n} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant='outline' size='icon-sm' disabled={page <= 1} onClick={() => setPage(1)} aria-label='First page'>
              <ChevronsLeftIcon />
            </Button>
            <Button variant='outline' size='icon-sm' disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label='Previous page'>
              <ChevronLeftIcon />
            </Button>
            <span className='text-muted-foreground px-2 text-sm tabular-nums'>
              <span className='text-foreground font-medium'>{page}</span> / {pages}
            </span>
            <Button variant='outline' size='icon-sm' disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label='Next page'>
              <ChevronRightIcon />
            </Button>
            <Button variant='outline' size='icon-sm' disabled={page >= pages} onClick={() => setPage(pages)} aria-label='Last page'>
              <ChevronsRightIcon />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export default OrderedList
