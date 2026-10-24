'use client'

import { useEffect, useMemo, useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import { toast } from 'sonner'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useApi } from '@/hooks/use-api'
import { errorMessage } from '@/lib/api/client'
import { MARKET_API, type BookNode, type UserBookResponse } from './api'

type Props = {
  eventId: string

  /** Market ka naam (game_type) — null = band. */
  gameType: string | null
  onClose: () => void
}

/** Book cell: sada number, 2 decimal tak, khali = "-". */
const fmtBook = (v: number | null | undefined) => (v == null ? '-' : String(Number(Number(v).toFixed(2))))

const byName = (a: BookNode, b: BookNode) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base', numeric: true })

/** Runners A→Z (zip jaisa) aur har node ke values usi order me. */
function orderBook(book: UserBookResponse) {
  const idx = book.runners.map((_, i) => i).sort((a, b) => book.runners[a].localeCompare(book.runners[b], undefined, { sensitivity: 'base', numeric: true }))
  const reorder = (node: BookNode): BookNode => ({ ...node, values: idx.map(i => node.values[i] ?? null), children: node.children?.map(reorder) })

  return { runners: idx.map(i => book.runners[i]), tree: book.tree.map(reorder) }
}

/** Ek node — staff ho to [+] / [-] se khulta hai, player pe toggle nahi. */
function BookRows({ node, runners }: { node: BookNode; runners: string[] }) {
  const [open, setOpen] = useState(false)
  const isFolder = Boolean(node.children?.length)

  return (
    <>
      <tr className='border-t'>
        <td className={isFolder ? 'cursor-pointer px-5 py-1.5' : 'px-5 py-1.5'} onClick={isFolder ? () => setOpen(o => !o) : undefined}>
          {isFolder ? `[${open ? '-' : '+'}] ` : ''}
          {node.username}
        </td>
        {runners.map((runner, i) => (
          <td key={runner} className='px-3 py-1.5 text-right tabular-nums'>
            {fmtBook(node.values[i])}
          </td>
        ))}
      </tr>
      {isFolder && open && [...(node.children ?? [])].sort(byName).map(child => <BookRows key={child.id} node={child} runners={runners} />)}
    </>
  )
}

/**
 * User Book — zip ka `components/UserBookModal.jsx`.
 * Downline tree (staff → … → player) × market ke runners. Pehle loader; koi book na ho to
 * modal khulta hi nahi.
 */
const UserBookDialog = ({ eventId, gameType, onClose }: Props) => {
  const { data, isFetching, error } = useApi<UserBookResponse>(gameType ? `${MARKET_API}/user-book` : null, { eventId, gameType: gameType ?? undefined }, { staleTime: 0, gcTime: 0 })
  const book = useMemo(() => (data ? orderBook(data) : null), [data])
  const ready = Boolean(gameType) && !isFetching && Boolean(book)
  const empty = ready && !book?.tree.length

  // khali book → modal nahi, page ko wapas
  useEffect(() => {
    if (empty) onClose()
  }, [empty, onClose])

  // A failed load would leave the full-screen loader up forever — say why and close.
  useEffect(() => {
    if (gameType && error && !isFetching) {
      toast.error(`Could not load the user book: ${errorMessage(error)}`)
      onClose()
    }
  }, [gameType, error, isFetching, onClose])

  if (gameType && !ready) {
    if (error && !isFetching) return null

    return (
      <div className='bg-background/40 fixed inset-0 z-50 flex items-center justify-center'>
        <Loader2Icon className='size-8 animate-spin' />
      </div>
    )
  }

  return (
    <Dialog open={ready && !empty} onOpenChange={open => !open && onClose()}>
      <DialogContent className='sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>User Book</DialogTitle>
        </DialogHeader>
        <div className='max-h-[70vh] overflow-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='bg-muted'>
                <th className='px-3 py-2 text-left'>User Name</th>
                {book?.runners.map(r => (
                  <th key={r} className='px-3 py-2 text-right'>
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...(book?.tree ?? [])].sort(byName).map(node => (
                <BookRows key={node.id} node={node} runners={book?.runners ?? []} />
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default UserBookDialog
