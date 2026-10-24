'use client'

import { useState, type ReactNode } from 'react'

import { ChartLineIcon, TableIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

import type { ChartSeries } from './Charts'
import { bucketLabel, formatValue, type Granularity, type ValueFormat } from './format'

/** The numbers behind a chart, as rows — the accessible (and copyable) view of it. */
export type ChartTableData = {
  columns: { header: string; align?: 'left' | 'right' }[]
  rows: ReactNode[][]
}

type Props = {
  title: ReactNode
  description?: ReactNode

  /** Controls in the header's right corner (a small select, a link). */
  actions?: ReactNode

  /** When given, a Chart/Table toggle appears and the table replaces the chart on demand. */
  table?: ChartTableData
  footer?: ReactNode
  className?: string
  children: ReactNode
}

/** A chart with its title. Keeps the chart's height when switched to the table, scrolling inside. */
const ChartCard = ({ title, description, actions, table, footer, className, children }: Props) => {
  const [showTable, setShowTable] = useState(false)

  return (
    <Card className={cn('min-w-0 gap-3 shadow-none', className)}>
      <CardHeader>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        {description && <CardDescription className='text-xs'>{description}</CardDescription>}
        {(actions || table) && (
          <CardAction className='flex items-center gap-1.5'>
            {actions}
            {table && (
              <Button
                variant='ghost'
                size='icon-sm'
                aria-pressed={showTable}
                aria-label={showTable ? 'Show chart' : 'Show data table'}
                title={showTable ? 'Show chart' : 'Show data table'}
                onClick={() => setShowTable(v => !v)}
              >
                {showTable ? <ChartLineIcon /> : <TableIcon />}
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className='min-w-0'>
        {/* The chart stays mounted under the table, so its box keeps the card's height. */}
        <div className={cn(showTable && table ? 'invisible h-0 overflow-hidden' : undefined)} aria-hidden={showTable || undefined}>
          {children}
        </div>
        {showTable && table && <ChartTable data={table} />}
        {footer && <div className='text-muted-foreground mt-3 text-xs'>{footer}</div>}
      </CardContent>
    </Card>
  )
}

export const ChartTable = ({ data, maxHeight = 320 }: { data: ChartTableData; maxHeight?: number }) => (
  <div className='border-border overflow-auto rounded-lg border' style={{ maxHeight }}>
    <Table>
      <TableHeader>
        <TableRow>
          {data.columns.map((c, i) => (
            <TableHead key={i} className={c.align === 'right' ? 'text-right' : undefined}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={data.columns.length} className='text-muted-foreground text-center'>
              No data for this period.
            </TableCell>
          </TableRow>
        ) : (
          data.rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, i) => (
                <TableCell key={i} className={cn('tabular-nums', data.columns[i]?.align === 'right' && 'text-right')}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  </div>
)

/** Table data for a time-series chart: one row per bucket, one column per series. */
export function seriesTable({
  buckets,
  granularity = 'day',
  series,
  format = 'number',
  currency,
  categoryHeader = 'Period'
}: {
  buckets: string[]
  granularity?: Granularity
  series: Pick<ChartSeries, 'name' | 'data'>[]
  format?: ValueFormat
  currency?: string | null
  categoryHeader?: string
}): ChartTableData {
  return {
    columns: [{ header: categoryHeader }, ...series.map(s => ({ header: s.name, align: 'right' as const }))],
    rows: buckets.map((b, i) => [bucketLabel(b, granularity), ...series.map(s => formatValue(s.data[i], format, currency))])
  }
}

/** Table data for a categorical chart (bar/donut). */
export function categoryTable({
  categories,
  series,
  format = 'number',
  currency,
  categoryHeader = 'Name'
}: {
  categories: string[]
  series: Pick<ChartSeries, 'name' | 'data'>[]
  format?: ValueFormat
  currency?: string | null
  categoryHeader?: string
}): ChartTableData {
  return {
    columns: [{ header: categoryHeader }, ...series.map(s => ({ header: s.name, align: 'right' as const }))],
    rows: categories.map((c, i) => [c, ...series.map(s => formatValue(s.data[i], format, currency))])
  }
}

export default ChartCard
