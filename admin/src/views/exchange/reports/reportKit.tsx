'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ChevronLeftIcon, ChevronRightIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Channel } from '@/components/shared/ChannelTabs'
import { useApi } from '@/hooks/use-api'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/utils'

/**
 * Reports ke saanjhe hisse — zip ke `ClientMultiselect`, "Show N entries", `Pagination`,
 * Excel/PDF buttons aur `config/sportsList.js`. Har report page inhi se banta hai.
 */

// ── Lists (zip config/sportsList.js) ─────────────────────────────────────

export const SPORTS_LIST: [string, string][] = [
  ['1', 'Football'], ['2', 'Tennis'], ['3', 'Mixed Martial Arts'], ['4', 'Cricket'],
  ['5', 'Golf'], ['6', 'Boxing'], ['7', 'Beach Volleyball'], ['8', 'Table Tennis'],
  ['9', 'Futsal'], ['10', 'Horse Racing'], ['15', 'Basketball'],
  ['16', 'MotoGP'], ['17', 'Chess'], ['18', 'Volleyball'], ['19', 'Ice Hockey'],
  ['22', 'Badminton'], ['25', 'Hockey'], ['29', 'Cycling'], ['32', 'Motorbikes'],
  ['33', 'Athletics'], ['35', 'Basketball 3X3'], ['37', 'Sumo'], ['38', 'Virtual sports'],
  ['39', 'Handball'], ['52', 'Motor Sports'], ['53', 'Baseball'],
  ['54', 'Rugby Union'], ['55', 'Rugby League'], ['57', 'Darts'], ['58', 'American Football'],
  ['59', 'Snooker'], ['62', 'Soccer'], ['64', 'Esports'], ['65', 'Greyhound Racing'],
  ['66', 'Kabaddi'], ['67', 'Boat Racing'], ['68', 'Esoccer'], ['69', 'Wrestling']
]

export const GAME_TYPES: [string, string][] = [
  ['Match', 'Match'], ['Match1', 'Match1'], ['Fancy', 'Fancy'], ['Fancy1', 'Fancy1'],
  ['Meter', 'Meter'], ['Khado', 'Khado'], ['oddeven', 'oddeven'], ['cricketcasino', 'cricket casino'],
  ['Fancy3', 'U/O Line'], ['Fancy2', 'Line Market']
]

// ── Dates ────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

export const dayString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Zip ka default: aaj se 7 din pehle → aaj. */
/**
 * The report routes' date rules (`exchange-reports/reports.validators.js`): both dates set, From not after To,
 * at most `maxDays` apart and — for the 10-day reports — not older than 3 months. `undefined` = fine.
 */
export const RANGE_MESSAGE = 'Sorry for inconvenience! You will see statement of 10 days date range in 3 months timeslot.'

export const rangeError = (range: { from: string; to: string }, { maxDays = 10, threeMonths = true }: { maxDays?: number; threeMonths?: boolean } = {}) => {
  if (!range.from || !range.to) return 'Choose both From and To dates'
  const days = (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000

  if (days < 0) return 'From date cannot be after To date'
  if (days > maxDays) return threeMonths ? RANGE_MESSAGE : `Date range cannot be more than ${maxDays} days`

  if (threeMonths) {
    const floor = new Date()

    floor.setMonth(floor.getMonth() - 3)
    floor.setHours(0, 0, 0, 0)
    if (new Date(`${range.from}T00:00:00`) < floor) return RANGE_MESSAGE
  }

  return undefined
}

export const defaultRange = () => {
  const today = new Date()
  const weekAgo = new Date()

  weekAgo.setDate(today.getDate() - 7)

  return { from: dayString(weekAgo), to: dayString(today) }
}

export const daysBetween = (from: string, to: string) =>
  (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000

/** "06/09/2026 00:00:00" — zip ka formatDisplay (en-GB, 24 ghante). */
export const formatDisplay = (value: string | null | undefined) => {
  if (!value) return ''
  const d = new Date(value)

  if (Number.isNaN(d.getTime())) return value

  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Number → "1,234.5" (zip ka toLocaleString). NaN → '0'. */
export const fmt = (value: unknown) => {
  const n = parseFloat(String(value))

  return Number.isNaN(n) ? '0' : n.toLocaleString()
}

/** Load / Reset par zip ka 1 second ka loader — data aur 1s, jo baad me khatam ho. */
export const withMinimumDelay = <T,>(work: Promise<T>) =>
  Promise.all([work, new Promise(r => setTimeout(r, 1000))]).then(([result]) => result)

// ── Search By Client Name ────────────────────────────────────────────────

export type Client = { type: 'user' | 'staff'; id: string; username: string; role: string }

/** API body ke liye — koi client nahi to kuch nahi bhejna. */
export const clientBody = (client: Client | null) => (client ? { clientType: client.type, clientId: Number(client.id) } : {})

/**
 * Zip ka ClientMultiselect: 3 akshar likhne par tree me dhoondo, naam par click = chuno,
 * wahi naam dobara = hatao. Bahar click par band, likha hua text chala jaata hai.
 */
/** `channel` (Direct Users | Agent Users tab) ho to sirf usi taraf ke accounts suggest hote hain. */
export function ClientSearch({ value, onChange, channel }: { value: Client | null; onChange: (client: Client | null) => void; channel?: Channel }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setText('')
    setSearch('')
  }

  // Thoda ruk ke dhoondo (har akshar par request nahi).
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 300)

    return () => clearTimeout(timer)
  }, [text])

  useEffect(() => {
    if (!open) return

    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }

    document.addEventListener('mousedown', onDown)

    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const { data, isFetching, error } = useApi<Client[]>(open && search.length >= 3 ? 'admin/exchange/reports/clients' : null, { search, channel })

  const pick = (client: Client) => {
    onChange(value && value.type === client.type && value.id === client.id ? null : client)
    close()
  }

  const message =
    text.trim().length === 0
      ? 'List is empty.'
      : search.length >= 3 && error
        ? `Search failed: ${errorMessage(error)}`
        : text.trim().length < 3 || !data?.length
          ? 'No elements found. Consider changing the search query.'
          : null

  return (
    <div ref={rootRef} className='relative'>
      <Input
        value={open ? text : (value?.username ?? '')}
        placeholder='Select option'
        onFocus={() => setOpen(true)}
        onChange={e => setText(e.target.value)}
        className='pr-8'
      />
      {value && !open && (
        <button type='button' aria-label='Clear' className='text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2' onClick={() => onChange(null)}>
          <XIcon className='size-4' />
        </button>
      )}
      {open && (
        <div className='bg-popover ring-foreground/10 absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md p-1 text-sm shadow-md ring-1'>
          {isFetching && <Loader2Icon className='text-muted-foreground m-2 size-4 animate-spin' />}
          {message && !isFetching ? (
            <div className='text-muted-foreground px-2 py-1.5'>{message}</div>
          ) : (
            data?.map(c => (
              <button
                key={`${c.type}-${c.id}`}
                type='button'
                onClick={() => pick(c)}
                className={cn(
                  'hover:bg-muted flex w-full items-center justify-between rounded px-2 py-1.5 text-left',
                  value?.type === c.type && value.id === c.id && 'bg-muted font-medium'
                )}
              >
                <span>{c.username}</span>
                <span className='text-muted-foreground text-xs'>{c.role}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Form bits ────────────────────────────────────────────────────────────

/** Label ke saath ek filter (zip ka `form-group`). */
export const FilterField = ({ label, children, className }: { label?: string; children: ReactNode; className?: string }) => (
  <div className={cn('flex flex-col gap-2', className)}>
    {label && <Label>{label}</Label>}
    {children}
  </div>
)

/** Native-jaisa select: options = [value, label]. `invalid` = zip ka laal is-invalid. */
export function Pick({
  value,
  onChange,
  options,
  invalid,
  className
}: {
  value: string
  onChange: (value: string) => void
  options: [string, string][]
  invalid?: boolean
  className?: string
}) {
  return (
    <Select value={value} onValueChange={v => v !== null && onChange(String(v))}>
      <SelectTrigger className={cn('w-full', invalid && 'border-destructive ring-destructive/20 ring-2', className)} aria-invalid={invalid || undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Load · Reset · Excel · PDF — zip ki button row. */
export function ActionButtons({
  onReset,
  onExcel,
  onPdf,
  canExport,
  busy
}: {
  onReset: () => void
  onExcel?: () => void
  onPdf?: () => void
  canExport: boolean
  busy?: boolean
}) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button type='submit' disabled={busy}>
        {busy && <Loader2Icon className='animate-spin' />}
        Load
      </Button>
      <Button type='button' variant='outline' onClick={onReset} disabled={busy}>
        Reset
      </Button>
      {onExcel && (
        <Button type='button' variant='outline' size='icon' className='text-success' disabled={!canExport} onClick={onExcel} aria-label='Excel'>
          <FileSpreadsheetIcon />
        </Button>
      )}
      {onPdf && (
        <Button type='button' variant='outline' size='icon' className='text-danger' disabled={!canExport} onClick={onPdf} aria-label='PDF'>
          <FileTextIcon />
        </Button>
      )}
    </div>
  )
}

// ── Table ────────────────────────────────────────────────────────────────

export type ReportColumn<T> = {
  key: string
  header: ReactNode
  align?: 'right'
  cell: (row: T, index: number) => ReactNode
}

export const ENTRY_OPTIONS = [25, 50, 75, 100, 125, 150]

/** "Show [25] entries" (left) aur "Search..." (right) — zip ki table ke upar wali line. */
export function EntriesBar({
  limit,
  onLimit,
  search,
  onSearch,
  searchLabel
}: {
  limit?: number
  onLimit?: (limit: number) => void
  search?: string
  onSearch?: (value: string) => void
  searchLabel?: string
}) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 px-4 py-3'>
      <div className='flex items-center gap-2 text-sm'>
        {onLimit && (
          <>
            Show
            <Pick value={String(limit)} onChange={v => onLimit(Number(v))} options={ENTRY_OPTIONS.map(n => [String(n), String(n)])} className='h-8 w-20' />
            entries
          </>
        )}
      </div>
      {onSearch && (
        <div className='flex items-center gap-2 text-sm'>
          {searchLabel}
          <Input type='search' placeholder='Search...' className='h-8 w-56' value={search ?? ''} onChange={e => onSearch(e.target.value)} />
        </div>
      )}
    </div>
  )
}

/** Zip ki b-table: header, rows, optional footer (totals), "There are no records to show". */
export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  footer,
  emptyMessage = 'There are no records to show',
  onRowClick,
  canClick
}: {
  columns: ReportColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  footer?: ReactNode[]
  emptyMessage?: string
  onRowClick?: (row: T) => void
  canClick?: (row: T) => boolean
}) {
  const right = (col: ReportColumn<T>) => col.align === 'right' && 'text-right tabular-nums'

  return (
    <div className='w-full overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow className='hover:bg-transparent'>
            {columns.map(col => (
              <TableHead key={col.key} className={cn('px-3 text-xs font-medium whitespace-nowrap uppercase', right(col))}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className='hover:bg-transparent'>
              <TableCell colSpan={columns.length} className='text-muted-foreground py-6 text-center'>
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => {
              const clickable = Boolean(onRowClick && (canClick?.(row) ?? true))

              return (
                <TableRow
                  key={rowKey(row, i)}
                  className={cn(clickable && 'cursor-pointer')}
                  onClick={clickable ? () => onRowClick?.(row) : undefined}
                >
                  {columns.map(col => (
                    <TableCell key={col.key} className={cn('px-3', right(col))}>
                      {col.cell(row, i)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })
          )}
        </TableBody>
        {footer && (
          <TableFooter>
            <TableRow>
              {footer.map((cell, i) => (
                <TableCell key={i} className={cn('px-3 font-semibold', right(columns[i]))}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  )
}

/** Zip ka Pagination — « ‹ page › ». */
export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return (
    <div className='flex items-center justify-end gap-2 px-4 py-3 text-sm'>
      <Button variant='outline' size='icon-sm' disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label='Previous page'>
        <ChevronLeftIcon />
      </Button>
      <span className='tabular-nums'>
        {page} / {Math.max(totalPages, 1)}
      </span>
      <Button variant='outline' size='icon-sm' disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label='Next page'>
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

/** Client-side paging — zip ke reports poora set ek baar laate hain, page browser me banta hai. */
export function usePaged<T>(rows: T[], limit: number) {
  // Data, search ya limit badle to page 1 (zip jaisa) — page us "key" ke saath yaad rehta hai.
  const key = `${rows.length}-${limit}`
  const [saved, setSaved] = useState({ page: 1, key })
  const page = saved.key === key ? saved.page : 1
  const setPage = (p: number) => setSaved({ page: p, key })
  const totalPages = Math.max(1, Math.ceil(rows.length / limit))

  const start = (page - 1) * limit

  return { page, setPage, totalPages, start, pageRows: rows.slice(start, start + limit) }
}

/** Card jisme filters ka form aur table aate hain. */
export const ReportCard = ({ children, className }: { children: ReactNode; className?: string }) => (
  <Card className={cn('gap-0 overflow-visible py-0', className)}>{children}</Card>
)
