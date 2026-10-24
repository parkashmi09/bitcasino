'use client'

import type { ReactNode } from 'react'

import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { Sparkline } from './Charts'
import type { ValueFormat } from './format'
import type { ChartColor } from './theme'

type Props = {
  label: string
  value: ReactNode

  /** Unit printed after the value, quietly ("USD", "users"). */
  unit?: string
  hint?: ReactNode
  icon?: ReactNode
  loading?: boolean

  /** Percent change against the previous period (see `percentChange`); `null` hides the chip. */
  delta?: number | null
  deltaLabel?: string

  /** Which direction is good news. Withdrawals going up is not; 'neutral' never colours the chip. */
  goodWhen?: 'up' | 'down' | 'neutral'

  /** The trend under the number, one point per bucket. */
  spark?: (number | null)[]
  sparkColor?: ChartColor
  sparkKind?: 'line' | 'area' | 'bar'
  sparkLabels?: string[]
  sparkFormat?: ValueFormat
  sparkCurrency?: string | null
  className?: string
}

/** "12.3", or "8,087" once the change is in the hundreds — a decimal there is noise. */
const formatDelta = (d: number) =>
  Math.abs(d) >= 100 ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(d) : d.toFixed(1)

/**
 * One headline number with its trend and its change versus the previous period of the same length.
 * The change is spelled out (arrow + sign + label), so it never relies on colour alone.
 */
const KpiCard = ({
  label,
  value,
  unit,
  hint,
  icon,
  loading,
  delta,
  deltaLabel = 'vs previous period',
  goodWhen = 'up',
  spark,
  sparkColor = 'chart-1',
  sparkKind = 'area',
  sparkLabels,
  sparkFormat,
  sparkCurrency,
  className
}: Props) => {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  const flat = hasDelta && Math.abs(delta as number) < 0.05
  const up = hasDelta && (delta as number) > 0
  const good = goodWhen === 'neutral' || flat ? null : goodWhen === 'up' ? up : !up
  const tone = good === null ? 'bg-muted text-muted-foreground' : good ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
  const Arrow = flat ? MinusIcon : up ? ArrowUpRightIcon : ArrowDownRightIcon
  const bleed = Boolean(spark) && sparkKind === 'area'

  return (
    <Card className={cn('min-w-0 gap-0 overflow-hidden pt-6 shadow-none', bleed ? 'pb-0' : 'pb-6', className)}>
      <CardContent className='flex flex-col gap-2 px-6'>
        <div className='flex items-start justify-between gap-3'>
          <p className='text-heading text-sm font-medium uppercase'>{label}</p>
          {icon && <span className='text-muted-foreground shrink-0 [&_svg]:size-4'>{icon}</span>}
        </div>
        {loading ? (
          <Skeleton className='h-8 w-28' />
        ) : (
          <div className='flex min-w-0 items-baseline gap-1.5'>
            <span className='text-heading truncate text-2xl leading-tight font-medium tracking-tight tabular-nums'>{value}</span>
            {unit && <span className='text-muted-foreground text-xs font-medium'>{unit}</span>}
          </div>
        )}
        <div className='flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
          {loading ? (
            <Skeleton className='h-4 w-32' />
          ) : (
            <>
              {hasDelta && (
                <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums', tone)}>
                  <Arrow className='size-3' aria-hidden />
                  {up ? '+' : ''}
                  {formatDelta(delta as number)}%
                </span>
              )}
              {hasDelta && <span className='text-muted-foreground'>{deltaLabel}</span>}
              {!hasDelta && hint && <span className='text-muted-foreground'>{hint}</span>}
            </>
          )}
        </div>
        {hasDelta && hint && !loading && <p className='text-muted-foreground -mt-1 text-xs'>{hint}</p>}
        {spark && !bleed && (
          <div className='-mx-1 h-10'>
            {loading ? (
              <Skeleton className='h-10 w-full' />
            ) : (
              <Sparkline data={spark} color={sparkColor} kind={sparkKind} labels={sparkLabels} format={sparkFormat} currency={sparkCurrency} ariaLabel={`${label} trend`} />
            )}
          </div>
        )}
      </CardContent>
      {/* Luno's analytics card: the area trend runs edge to edge along the card's bottom. */}
      {bleed && spark && (
        <div className='mt-auto h-16 pt-2'>
          {loading ? (
            <Skeleton className='h-full w-full rounded-none' />
          ) : (
            <Sparkline data={spark} color={sparkColor} kind='area' height={56} labels={sparkLabels} format={sparkFormat} currency={sparkCurrency} ariaLabel={`${label} trend`} />
          )}
        </div>
      )}
    </Card>
  )
}

export default KpiCard
