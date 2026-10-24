'use client'

// React Imports
import type { ReactNode } from 'react'

// Third-party Imports
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon, Loader2Icon, SearchIcon } from 'lucide-react'

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
    <Card className={cn('gap-0 overflow-hidden py-0 shadow-none', className)}>
      {showToolbar && (
        <div className='flex flex-wrap items-center gap-3 border-b p-4'>
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
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow className={cn(dense ? 'h-10' : 'h-12')}>
                {columns.map(col => (
                  <TableHead
                    key={col.key}
                    className={cn(
                      'text-muted-foreground whitespace-nowrap first:pl-4 last:pr-4',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.sortKey && onSortChange && 'cursor-pointer select-none',
                      col.headerClassName
                    )}
                    onClick={() => toggleSort(col)}
                  >
                    <span className='inline-flex items-center gap-1'>
                      {col.header}
                      {col.sortKey && sort?.key === col.sortKey && <span className='text-xs'>{sort.order === 'asc' ? '▲' : '▼'}</span>}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !rows ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`s${i}`}>
                    {columns.map(col => (
                      <TableCell key={col.key} className='first:pl-4 last:pr-4'>
                        <Skeleton className='h-4 w-full max-w-40' />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows && rows.length > 0 ? (
                rows.map((row, i) => (
                  <TableRow
                    key={rowKey(row, i)}
                    className={cn(dense ? 'h-10' : 'h-13', onRowClick && 'hover:bg-muted/50 cursor-pointer')}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map(col => (
                      <TableCell
                        key={col.key}
                        className={cn(
                          'first:pl-4 last:pr-4',
                          col.align === 'right' && 'text-right',
                          col.align === 'center' && 'text-center',
                          col.className
                        )}
                      >
                        {col.cell(row, i)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className='text-muted-foreground h-24 text-center'>
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {pagination && (
        <div className='flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3'>
          <p className='text-muted-foreground text-sm'>
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
            <Button variant='outline' size='icon-sm' disabled={page <= 1} onClick={() => onPageChange?.(1)} aria-label='First page'>
              <ChevronsLeftIcon />
            </Button>
            <Button variant='outline' size='icon-sm' disabled={page <= 1} onClick={() => onPageChange?.(page - 1)} aria-label='Previous page'>
              <ChevronLeftIcon />
            </Button>
            <span className='px-2 text-sm tabular-nums'>
              {page} / {totalPages}
            </span>
            <Button variant='outline' size='icon-sm' disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)} aria-label='Next page'>
              <ChevronRightIcon />
            </Button>
            <Button variant='outline' size='icon-sm' disabled={page >= totalPages} onClick={() => onPageChange?.(totalPages)} aria-label='Last page'>
              <ChevronsRightIcon />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
