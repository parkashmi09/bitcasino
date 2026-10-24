'use client'

import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react'

import { BarChart3Icon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { ValueFormat } from './format'

/** Props every chart wrapper takes. */
export type CommonChartProps = {

  /** What the chart shows, for screen readers ("Deposits and withdrawals per day, USD"). */
  ariaLabel: string
  height?: number
  loading?: boolean
  error?: unknown
  emptyMessage?: string
  format?: ValueFormat

  /** Suffix for money values in tooltips ('USD', 'INR'). */
  currency?: string | null
  className?: string
}

const noopSubscribe = () => () => {}

/** False on the server and during hydration, true once mounted: charts are drawn on the client only. */
export const useIsClient = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )

/** The size of an element, kept current with a ResizeObserver. 0×0 until measured. */
export function useBoxSize<T extends HTMLElement = HTMLDivElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 })

  const ref = useCallback((el: T | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return

    const read = () => {
      const r = el.getBoundingClientRect()
      const width = Math.round(r.width)
      const height = Math.round(r.height)

      setSize(s => (s.width === width && s.height === height ? s : { width, height }))
    }

    read()
    const obs = new ResizeObserver(read)

    obs.observe(el)

    return () => obs.disconnect()
  }, [])

  return [ref, size] as const
}

type FrameProps = {
  ariaLabel: string
  height: number
  loading?: boolean
  error?: unknown
  empty?: boolean
  emptyMessage?: string
  className?: string
  children: ReactNode
}

/** The box a chart sits in: the same height whether it is loading, empty, failed or drawn. */
export const ChartFrame = ({ ariaLabel, height, loading, error, empty, emptyMessage, className, children }: FrameProps) => {
  const isClient = useIsClient()
  let body: ReactNode = children

  if (loading || !isClient) body = <Skeleton className='size-full' aria-hidden />
  else if (error) body = <div className='flex size-full items-center'><ErrorState error={error} title='Could not load this chart' /></div>
  else if (empty)
    body = (
      <div className='border-border text-muted-foreground flex size-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm'>
        <BarChart3Icon className='size-5 opacity-60' aria-hidden />
        {emptyMessage ?? 'No data for this period.'}
      </div>
    )

  return (
    <div
      role='img'
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={cn('relative w-full min-w-0', className)}
      style={{ height }}
    >
      {body}
    </div>
  )
}

/** True when there is nothing worth drawing: no points, or every point blank or zero. */
export const isEmptySeries = (series: { data: readonly (number | null | undefined)[] }[]) =>
  series.length === 0 || series.every(s => s.data.every(v => v === null || v === undefined || v === 0))
