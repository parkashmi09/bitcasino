'use client'

// React Imports
import { Fragment, type ReactNode } from 'react'

// Third-party Imports
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronUpIcon,
  Loader2Icon,
  SearchIcon
} from 'lucide-react'

// Component Imports
import ErrorState from '@/components/shared/ErrorState'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// Lib Imports
import type { Pagination } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export type Column<T> = {
  key: string
  header: ReactNode
  cell: (row: T, index: number) => ReactNode
  className?: string
  headerClassName?: string

  /** Set to enable a sort toggle on this column (server-side; the value goes to `?sort=`). */
  sortKey?: string
  align?: 'left' | 'right' | 'center'
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T, index: number) => string | number
  loading?: boolean
  fetching?: boolean
  error?: unknown
  pagination?: Pagination
  onPageChange?: (page: number) => void
  onLimitChange?: (limit: number) => void
  sort?: { key: string; order: 'asc' | 'desc' } | null
  onSortChange?: (sort: { key: string; order: 'asc' | 'desc' } | null) => void
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string

  /** Filters, buttons — rendered in the toolbar next to search. */
  toolbar?: ReactNode
  emptyMessage?: ReactNode
  onRowClick?: (row: T) => void

  /** A full-width row under a row (an expanded detail). Return null to show nothing. */
  renderExpanded?: (row: T) => ReactNode
  dense?: boolean
  className?: string
}

const LIMITS = [10, 20, 50, 100]

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  fetching,
  error,
  pagination,
  onPageChange,
  onLimitChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  toolbar,
  emptyMessage = 'Nothing to show.',
  onRowClick,
  renderExpanded,
  dense,
  className
}: Props<T>) {
  const showToolbar = onSearchChange || toolbar
  const page = pagination?.page ?? 1
  const totalPages = Math.max(pagination?.totalPages ?? 1, 1)
  const total = pagination?.total ?? rows?.length ?? 0
  const limit = pagination?.limit ?? rows?.length ?? 0
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  const toggleSort = (col: Column<T>) => {
    if (!col.sortKey || !onSortChange) return
    if (sort?.key !== col.sortKey) return onSortChange({ key: col.sortKey, order: 'asc' })
    if (sort.order === 'asc') return onSortChange({ key: col.sortKey, order: 'desc' })
    onSortChange(null)
  }

  return (
    <Card className={cn('ring-border gap-0 overflow-hidden py-0', className)}>
      {showToolbar && (
        <div className='border-border flex flex-wrap items-center gap-3 border-b border-dashed px-4 py-3.5'>
          {onSearchChange && (
            <div className='relative w-full sm:w-72'>
              <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
              <Input
                value={search ?? ''}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className='pl-8'
              />
            </div>
          )}
          {toolbar}
          {fetching && !loading && <Loader2Icon className='text-muted-foreground ml-auto size-4 animate-spin' />}
        </div>
      )}

      {error ? (
        <div className='p-4'>
          <ErrorState error={error} />
        </div>
      ) : (
        <div className='relative w-full'>
          <Table>
            <TableHeader>
              <TableRow className={cn('border-border hover:bg-transparent', dense ? 'h-9' : 'h-11')}>
                {columns.map(col => {
                  const sortable = Boolean(col.sortKey && onSortChange)
                  const active = col.sortKey && sort?.key === col.sortKey

                  return (
                    <TableHead
                      key={col.key}
                      className={cn(
                        'text-heading bg-card sticky top-0 z-10 px-3 text-xs font-bold tracking-wide whitespace-nowrap uppercase first:pl-5 last:pr-5',
                        col.align === 'right' && 'text-right tabular-nums',
                        col.align === 'center' && 'text-center',
                        sortable && 'hover:text-primary cursor-pointer transition-colors select-none',
                        active && 'text-primary',
                        col.headerClassName
                      )}
                      aria-sort={active ? (sort?.order === 'asc' ? 'ascending' : 'descending') : undefined}
                      onClick={() => toggleSort(col)}
                    >
                      <span
                        className={cn('inline-flex items-center gap-1', col.align === 'right' && 'flex-row-reverse')}
                      >
                        {col.header}
                        {active &&
                          (sort?.order === 'asc' ? (
                            <ChevronUpIcon className='size-3.5' />
                          ) : (
                            <ChevronDownIcon className='size-3.5' />
                          ))}
                      </span>
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !rows ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`s${i}`} className={cn('border-border hover:bg-transparent', dense ? 'h-9' : 'h-13')}>
                    {columns.map(col => (
                      <TableCell key={col.key} className='px-3 first:pl-5 last:pr-5'>
                        <Skeleton className='h-3.5 w-full max-w-40' />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows && rows.length > 0 ? (
                rows.map((row, i) => {
                  const expanded = renderExpanded?.(row)

                  return (
                    <Fragment key={rowKey(row, i)}>
                      <TableRow
                        className={cn(
                          'border-border hover:bg-muted/50',
                          dense ? 'h-9' : 'h-13',
                          onRowClick && 'cursor-pointer'
                        )}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                      >
                        {columns.map(col => (
                          <TableCell
                            key={col.key}
                            className={cn(
                              'px-3 first:pl-5 last:pr-5',
                              col.align === 'right' && 'text-right tabular-nums',
                              col.align === 'center' && 'text-center',
                              col.className
                            )}
                          >
                            {col.cell(row, i)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {expanded != null && expanded !== false && (
                        <TableRow className='border-border bg-muted/30 hover:bg-muted/30'>
                          <TableCell colSpan={columns.length} className='px-5 py-3'>
                            {expanded}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })
              ) : (
                <TableRow className='hover:bg-transparent'>
                  <TableCell
                    colSpan={columns.length}
                    className='text-muted-foreground h-28 px-5 text-center text-sm font-normal'
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {pagination && (
        <div className='border-border flex flex-wrap items-center justify-between gap-3 border-t border-dashed px-4 py-3'>
          <p className='text-muted-foreground text-sm tabular-nums'>
            {total === 0 ? 'No entries' : `Showing ${from}–${to} of ${total}`}
          </p>
          <div className='flex items-center gap-2'>
            {onLimitChange && (
              <Select value={String(limit)} onValueChange={v => v && onLimitChange(Number(v))}>
                <SelectTrigger className='h-8 w-24'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMITS.map(n => (
                    <SelectItem key={n} value={String(n)}>
                      {n} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant='outline'
              size='icon-sm'
              disabled={page <= 1}
              onClick={() => onPageChange?.(1)}
              aria-label='First page'
            >
              <ChevronsLeftIcon />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
              aria-label='Previous page'
            >
              <ChevronLeftIcon />
            </Button>
            <span className='text-muted-foreground px-2 text-sm tabular-nums'>
              <span className='text-foreground font-medium'>{page}</span> / {totalPages}
            </span>
            <Button
              variant='outline'
              size='icon-sm'
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(page + 1)}
              aria-label='Next page'
            >
              <ChevronRightIcon />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(totalPages)}
              aria-label='Last page'
            >
              <ChevronsRightIcon />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
