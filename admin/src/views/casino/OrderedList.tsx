'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { ArrowDownIcon, ArrowDownToLineIcon, ArrowUpIcon, ArrowUpToLineIcon, Loader2Icon, PlusIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api/client'
import { notifyError } from '@/lib/notify'

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
}

const Thumb = ({ src, alt }: { src?: string | null; alt: string }) =>
  src ? <img src={src} alt={alt} className='size-9 rounded object-cover' /> : <div className='bg-muted size-9 rounded' />

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
const OrderedList = ({ items, loading, search, onSave, canWrite, max, header, emptyMessage = 'Nothing curated yet. Add games to build the list.', rowAction }: Props) => {
  const [edited, setEdited] = useState<OrderedItem[] | null>(null)
  const draft = useMemo(() => edited ?? items ?? [], [edited, items])
  const [saving, setSaving] = useState(false)

  const setDraft = (fn: (d: OrderedItem[]) => OrderedItem[]) => setEdited(prev => fn(prev ?? items ?? []))

  const dirty = useMemo(() => !!items && (items.length !== draft.length || items.some((it, i) => it.id !== draft[i]?.id)), [items, draft])
  const ids = useMemo(() => new Set(draft.map(d => d.id)), [draft])

  const move = (from: number, to: number) =>
    setDraft(d => {
      if (to < 0 || to >= d.length) return d

      const next = [...d]
      const [item] = next.splice(from, 1)

      next.splice(to, 0, item)

      return next
    })

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
        <Picker search={search} exclude={ids} disabled={!canWrite} onAdd={added => setDraft(d => [...d, ...added.filter(a => !ids.has(a.id))])} />
        <Button variant='outline' disabled={!dirty || saving} onClick={() => setEdited(null)}>
          <RotateCcwIcon /> Reset
        </Button>
        <Button disabled={!dirty || saving || !canWrite || overMax} onClick={save}>
          {saving ? <Loader2Icon className='animate-spin' /> : <SaveIcon />} Save order
        </Button>
      </div>
      {overMax && <p className='text-destructive border-b px-4 py-2 text-sm'>This list may hold at most {max} games. Remove some before saving.</p>}
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-12 pl-4'>#</TableHead>
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
                  <TableCell colSpan={5} className='px-4'>
                    <Skeleton className='h-6 w-full' />
                  </TableCell>
                </TableRow>
              ))
            ) : draft.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className='text-muted-foreground h-24 text-center'>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              draft.map((g, i) => (
                <TableRow key={g.id} className={items && items[i]?.id !== g.id ? 'bg-primary/5' : undefined}>
                  <TableCell className='text-muted-foreground pl-4 tabular-nums'>{i + 1}</TableCell>
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
                      <Button size='icon-sm' variant='ghost' className='text-destructive' disabled={!canWrite} onClick={() => setDraft(d => d.filter(x => x.id !== g.id))} aria-label='Remove'>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}

export default OrderedList
