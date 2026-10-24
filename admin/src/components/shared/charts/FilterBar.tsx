'use client'

import type { ReactNode } from 'react'

import { CalendarDays, Clock3, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import { bucketLabel, GRANULARITIES, type Granularity } from './format'
import { MAX_DAY_SPAN, MAX_RANGE_DAYS, PRESETS, type Preset, type StatsFilters } from './useStatsFilters'

type Props = {
  filters: StatsFilters
  showGranularity?: boolean

  /** Extra dimension controls (a sport select, a channel select), placed after the built-in ones. */
  children?: ReactNode
  className?: string
}

const GRANULARITY_LABEL: Record<Granularity, string> = { day: 'Day', week: 'Week', month: 'Month' }

const shortDay = (day: string) => `${bucketLabel(day, 'day')} ${day.slice(0, 4)}`

/**
 * One row of filters above a stats screen: period, custom range and bucket size.
 * Everything it changes goes to the URL through `useStatsFilters`.
 */
const FilterBar = ({ filters, showGranularity = true, children, className }: Props) => {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div role='group' aria-label='Report filters' className={cn('bg-card flex flex-wrap items-center gap-2 rounded-2xl p-3 shadow-(--shadow-card)', className)}>
      <Select value={filters.preset} onValueChange={v => v && filters.set(v === 'custom' ? { preset: 'custom', from: filters.from, to: filters.to } : { preset: v as Preset })}>
        <SelectTrigger className='w-full font-medium sm:w-44' aria-label='Period'>
          <span className='flex min-w-0 items-center gap-2'>
            <Clock3 className='text-muted-foreground size-4' aria-hidden />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map(p => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filters.preset === 'custom' ? (
        <DateRangePicker
          aria-label='Custom date range'
          from={filters.from}
          to={filters.to}
          max={today}
          clearable={false}
          onChange={r => r.from && r.to && filters.set({ preset: 'custom', from: r.from, to: r.to })}
        />
      ) : (
        <span className='border-input text-foreground/80 inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium tabular-nums'>
          <CalendarDays className='text-muted-foreground size-4' aria-hidden />
          {filters.from === filters.to ? shortDay(filters.from) : `${shortDay(filters.from)} – ${shortDay(filters.to)}`}
          <span className='bg-background text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide'>UTC</span>
        </span>
      )}

      {showGranularity && (
        <ToggleGroup
          size='sm'
          spacing={0}
          className='bg-muted h-9 gap-0.5 rounded-lg p-0.5'
          aria-label='Group by'
          value={[filters.granularity]}
          onValueChange={(v: unknown[]) => {
            const g = v[0] as Granularity | undefined

            if (g) filters.set({ granularity: g })
          }}
        >
          {GRANULARITIES.map(g => (
            <ToggleGroupItem
              key={g}
              value={g}
              className='aria-pressed:bg-card aria-pressed:text-primary h-8 rounded-md px-3.5 font-semibold aria-pressed:shadow-xs'
              disabled={g === 'day' && filters.days > MAX_DAY_SPAN}
              title={g === 'day' && filters.days > MAX_DAY_SPAN ? `Daily buckets are limited to ${MAX_DAY_SPAN} days` : undefined}
            >
              {GRANULARITY_LABEL[g]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {children}

      {filters.preset === 'custom' && filters.days >= MAX_RANGE_DAYS && (
        <span className='text-muted-foreground text-xs'>Limited to {MAX_RANGE_DAYS} days.</span>
      )}

      <Button
        type='button'
        variant='outline'
        size='sm'
        className='ml-auto h-9 gap-1.5'
        disabled={!filters.dirty}
        onClick={filters.reset}
        title='Back to the default period and grouping'
      >
        <RotateCcw className='size-3.5' aria-hidden />
        Reset
      </Button>
    </div>
  )
}

export default FilterBar
