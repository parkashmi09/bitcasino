'use client'

import { useEffect, useRef, useState } from 'react'

import { ChevronDownIcon } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { useApi } from '@/hooks/use-api'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/utils'

/**
 * "Search By Client Name" — zip ka `components/ClientMultiselect.jsx`.
 *
 * Zip jaisa flow:
 *   - box kholo → search khaali, "List is empty."
 *   - 1-2 letter → "No elements found…" (request nahi jaata)
 *   - 3rd letter se → poora downline search (300ms debounce)
 *   - naam pe click → select; wahi naam dobara click → un-select
 *   - bahar click → band, jo type kiya wo hat jaata hai, pehle wala select rehta hai
 */

export type ClientRow = {
  wallet_id: string | null
  user_id: string | null
  staff_id: string | null
  username: string
  user_type: 'STAFF' | 'USER' | 'OWNER'
}

const SEARCH_MIN = 3
const DEBOUNCE_MS = 300
const PAGE_LIMIT = 15

type Props = {
  value: string
  placeholder?: string
  onChange: (value: string) => void
  onSelect: (row: ClientRow) => void
}

const ClientSearch = ({ value, placeholder = 'Select option', onChange, onSelect }: Props) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // Typing ruke 300ms tab hi search (debounce).
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [search])

  // 3 letter ke baad hi request; react-query purani request ka jawab nayi pe nahi chadhne deta.
  const typedNow = search.trim()
  const canSearch = open && typedNow.length >= SEARCH_MIN && debounced === typedNow

  const lookup = useApi<{ results: ClientRow[] }>(canSearch ? 'admin/exchange-lookup/search-by-username' : null, {
    username: debounced,
    limit: PAGE_LIMIT
  })

  const results = open && typedNow.length >= SEARCH_MIN ? (lookup.data?.results ?? []) : []

  const closeBox = () => {
    setSearch('')
    setOpen(false)
  }

  // bahar click → band
  useEffect(() => {
    if (!open) return

    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeBox()
    }

    document.addEventListener('mousedown', onDown)

    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (row?: ClientRow) => {
    if (!row) return

    // wahi naam dobara = un-select
    if (value && row.username === value) onChange('')
    else onSelect(row)
    closeBox()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter se form submit (Load) na ho jaaye
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open) pick(results[highlight])

      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => (results.length ? (h + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => (results.length ? (h - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      closeBox()
    }
  }

  const typed = search.trim()

  return (
    <div ref={rootRef} className='relative'>
      <div className='relative'>
        <Input
          value={open ? search : value}
          placeholder={placeholder}
          autoComplete='off'
          spellCheck={false}
          className='pr-8'
          onFocus={() => {
            setSearch('')
            setOpen(true)
          }}
          onChange={e => {
            setSearch(e.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        <ChevronDownIcon className='text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2' />
      </div>

      {open && (
        <ul className='bg-popover text-popover-foreground absolute z-50 mt-1 max-h-[300px] w-full overflow-auto rounded-md border py-1 text-sm shadow-md'>
          {results.map((u, i) => (
            <li
              key={u.wallet_id || `${u.user_type}-${u.user_id || u.staff_id}`}
              className={cn(
                'cursor-pointer px-3 py-1.5',
                i === highlight && 'bg-primary text-primary-foreground',
                value && u.username === value && i !== highlight && 'bg-muted font-medium'
              )}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={e => {
                e.preventDefault()
                pick(u)
              }}
            >
              {u.username}
            </li>
          ))}
          {typed.length >= SEARCH_MIN && lookup.error ? (
            <li className='text-destructive px-3 py-1.5'>Search failed: {errorMessage(lookup.error)}</li>
          ) : (
            typed.length > 0 &&
            results.length === 0 && (
              <li className='text-muted-foreground px-3 py-1.5'>
                {canSearch && lookup.isFetching ? 'Searching…' : 'No elements found. Consider changing the search query.'}
              </li>
            )
          )}
          {typed.length === 0 && <li className='text-muted-foreground px-3 py-1.5'>List is empty.</li>}
        </ul>
      )}
    </div>
  )
}

export default ClientSearch
