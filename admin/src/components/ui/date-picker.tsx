'use client'

/**
 * Date pickers that speak the same strings the native inputs did, so callers and
 * API query params do not change:
 *   DatePicker       'yyyy-MM-dd'        | ''
 *   DateRangePicker  { from, to } each 'yyyy-MM-dd' | ''
 *   DateTimePicker   'yyyy-MM-ddTHH:mm'  | ''   (local time, like datetime-local)
 *
 * Bundle: the trigger is a plain button. The calendar (react-day-picker) is a
 * separate chunk loaded by next/dynamic the first time a popover opens (warmed on
 * hover/focus), and it only mounts while the popover is open — the base-ui
 * Popover portal unmounts its content on close.
 */
import * as React from 'react'

import dynamic from 'next/dynamic'

import { endOfMonth } from 'date-fns/endOfMonth'
import { format } from 'date-fns/format'
import { startOfMonth } from 'date-fns/startOfMonth'
import { subDays } from 'date-fns/subDays'
import { CalendarIcon, XIcon } from 'lucide-react'
import type { DateRange, Matcher } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const loadCalendar = () => import('@/components/ui/calendar')

const Calendar = dynamic(() => loadCalendar().then(m => m.Calendar), {
  ssr: false,
  loading: () => <div className='bg-muted/40 m-3 h-[17rem] w-[15.5rem] animate-pulse rounded-md' />
})

/** Start fetching the calendar chunk before the click lands. */
const preloadCalendar = () => void loadCalendar()

// ---- string <-> Date (local time, no timezone shifts) ----

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/

export function parseDate(value: string | undefined | null): Date | undefined {
  const m = value ? DATE_RE.exec(value) : null

  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))

  return Number.isNaN(d.getTime()) ? undefined : d
}

export const toDateString = (d: Date) => format(d, 'yyyy-MM-dd')

const timeOf = (value: string) => /T(\d{2}:\d{2})/.exec(value)?.[1]

const DISPLAY = 'dd MMM yyyy'

/** Year range for the month/year dropdowns when no min/max is given. */
const FIRST_MONTH = new Date(2015, 0, 1)
const LAST_MONTH = new Date(new Date().getFullYear() + 5, 11, 31)

function useBounds(min?: string, max?: string) {
  return React.useMemo(() => {
    const minDate = parseDate(min)
    const maxDate = parseDate(max)
    const disabled: Matcher[] = []

    if (minDate) disabled.push({ before: minDate })
    if (maxDate) disabled.push({ after: maxDate })

    return { minDate, maxDate, disabled: disabled.length ? disabled : undefined }
  }, [min, max])
}

function useIsWide() {
  return React.useSyncExternalStore(
    cb => {
      const mql = window.matchMedia('(min-width: 768px)')

      mql.addEventListener('change', cb)

      return () => mql.removeEventListener('change', cb)
    },
    () => window.matchMedia('(min-width: 768px)').matches,
    () => true
  )
}

// ---- shared trigger ----

type TriggerProps = {
  id?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  placeholder: string
  label: string | undefined
  disabled?: boolean
  clearable: boolean
  onClear: () => void
  className?: string
}

/** A caller's aria-label is prefixed to the shown value so the accessible name still carries the date. */
function PickerTrigger({
  id,
  placeholder,
  label,
  disabled,
  clearable,
  onClear,
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid
}: TriggerProps) {
  const showClear = clearable && !!label && !disabled

  return (
    <div className={cn('relative w-full', className)} data-slot='date-picker'>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant='outline'
            disabled={disabled}
            onPointerEnter={preloadCalendar}
            onFocus={preloadCalendar}
            className={cn(

              // Sits in filter rows beside inputs and selects, so it wears the same MUI outlined field.
              'border-input hover:border-foreground focus-visible:border-foreground focus-visible:ring-0 data-popup-open:border-foreground h-10 w-full justify-start bg-transparent px-3.5 text-left font-normal normal-case hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground',
              !label && 'text-(--input-placeholder) hover:text-(--input-placeholder)',
              showClear && 'pr-8'
            )}
            aria-label={ariaLabel ? `${ariaLabel}: ${label ?? placeholder}` : undefined}
            aria-invalid={ariaInvalid}
          />
        }
      >
        <CalendarIcon className='text-muted-foreground' />
        <span className='truncate'>{label ?? placeholder}</span>
      </PopoverTrigger>
      {showClear && (
        <Button
          type='button'
          variant='ghost'
          size='icon-xs'
          aria-label='Clear date'
          className='text-muted-foreground absolute top-1/2 right-1.5 -translate-y-1/2'
          onClick={onClear}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}

/** Keeps native `required` validation (and `name` for form posts) now that the field is a button. */
const HiddenValue = ({ name, required, value }: { name?: string; required?: boolean; value: string }) =>
  name || required ? (
    <input
      type='text'
      tabIndex={-1}
      aria-hidden
      name={name}
      required={required}
      value={value}
      onChange={() => {}}
      className='pointer-events-none absolute bottom-0 left-1/2 size-px opacity-0'
    />
  ) : null

type CommonProps = {
  id?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  placeholder?: string
  disabled?: boolean
  required?: boolean
  name?: string

  /** Show the × button when a value is set (default true). */
  clearable?: boolean
  className?: string
  align?: 'start' | 'center' | 'end'
}

// ---- DatePicker ----

export type DatePickerProps = CommonProps & {
  value: string
  onChange: (value: string) => void

  /** 'yyyy-MM-dd' */
  min?: string

  /** 'yyyy-MM-dd' */
  max?: string
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Pick a date',
  clearable = true,
  align = 'start',
  name,
  required,
  ...rest
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = React.useMemo(() => parseDate(value), [value])
  const label = React.useMemo(() => (selected ? format(selected, DISPLAY) : undefined), [selected])
  const { minDate, maxDate, disabled } = useBounds(min, max)

  const onSelect = React.useCallback(
    (d: Date | undefined) => {
      onChange(d ? toDateString(d) : '')
      setOpen(false)
    },
    [onChange]
  )

  const onClear = React.useCallback(() => onChange(''), [onChange])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className='relative w-full'>
        <PickerTrigger {...rest} placeholder={placeholder} label={label} clearable={clearable} onClear={onClear} />
        <HiddenValue name={name} required={required} value={value} />
      </div>
      <PopoverContent className='w-auto p-0' align={align}>
        <Calendar
          mode='single'
          selected={selected}
          onSelect={onSelect}
          defaultMonth={selected ?? maxDate}
          disabled={disabled}
          captionLayout='dropdown'
          startMonth={minDate ?? FIRST_MONTH}
          endMonth={maxDate ?? LAST_MONTH}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

// ---- DateTimePicker ----

export type DateTimePickerProps = CommonProps & {
  value: string
  onChange: (value: string) => void

  /** 'yyyy-MM-ddTHH:mm' or 'yyyy-MM-dd' — days outside are disabled */
  min?: string
  max?: string

  /** Time used when a day is picked before any time is set (default '00:00'). */
  defaultTime?: string
}

export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  defaultTime = '00:00',
  placeholder = 'Pick a date and time',
  clearable = true,
  align = 'start',
  name,
  required,
  ...rest
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = React.useMemo(() => parseDate(value), [value])
  const time = timeOf(value) ?? defaultTime
  const label = React.useMemo(() => (selected ? `${format(selected, DISPLAY)}, ${time}` : undefined), [selected, time])
  const { minDate, maxDate, disabled } = useBounds(min, max)

  const onSelect = React.useCallback(
    (d: Date | undefined) => onChange(d ? `${toDateString(d)}T${time}` : ''),
    [onChange, time]
  )

  const onTime = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = e.target.value

      if (!t) return
      onChange(`${toDateString(selected ?? new Date())}T${t}`)
    },
    [onChange, selected]
  )

  const onClear = React.useCallback(() => onChange(''), [onChange])
  const close = React.useCallback(() => setOpen(false), [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className='relative w-full'>
        <PickerTrigger {...rest} placeholder={placeholder} label={label} clearable={clearable} onClear={onClear} />
        <HiddenValue name={name} required={required} value={value} />
      </div>
      <PopoverContent className='w-auto gap-0 p-0' align={align}>
        <Calendar
          mode='single'
          selected={selected}
          onSelect={onSelect}
          defaultMonth={selected ?? maxDate}
          disabled={disabled}
          captionLayout='dropdown'
          startMonth={minDate ?? FIRST_MONTH}
          endMonth={maxDate ?? LAST_MONTH}
          autoFocus
        />
        <div className='flex items-center gap-2 border-t p-3'>
          <Input
            type='time'
            aria-label='Time'
            value={time}
            onChange={onTime}
            className='h-8 flex-1 [&::-webkit-calendar-picker-indicator]:hidden'
          />
          <Button size='sm' onClick={close}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---- DateRangePicker ----

export type DateRangeValue = { from: string; to: string }

export type DateRangePickerProps = CommonProps & {
  from: string
  to: string
  onChange: (range: DateRangeValue) => void

  /** 'yyyy-MM-dd' */
  min?: string

  /** 'yyyy-MM-dd' */
  max?: string

  /** Show the preset column (default true). */
  presets?: boolean
}

type Preset = { label: string; range: () => { from: Date; to: Date } }

const PRESETS: Preset[] = [
  { label: 'Today', range: () => ({ from: new Date(), to: new Date() }) },
  { label: 'Yesterday', range: () => ({ from: subDays(new Date(), 1), to: subDays(new Date(), 1) }) },
  { label: 'Last 7 days', range: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: 'Last 30 days', range: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: 'This month', range: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) }
]

function rangeLabel(from: Date | undefined, to: Date | undefined) {
  if (!from && !to) return undefined

  if (from && to) {
    if (toDateString(from) === toDateString(to)) return format(from, DISPLAY)

    return from.getFullYear() === to.getFullYear()
      ? `${format(from, 'dd MMM')} – ${format(to, DISPLAY)}`
      : `${format(from, DISPLAY)} – ${format(to, DISPLAY)}`
  }

  return from ? `From ${format(from, DISPLAY)}` : `Until ${format(to!, DISPLAY)}`
}

export function DateRangePicker({
  from,
  to,
  onChange,
  min,
  max,
  presets = true,
  placeholder = 'Pick a date range',
  clearable = true,
  align = 'start',
  name,
  required,
  className,
  ...rest
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  const fromDate = React.useMemo(() => parseDate(from), [from])
  const toDate = React.useMemo(() => parseDate(to), [to])
  const label = React.useMemo(() => rangeLabel(fromDate, toDate), [fromDate, toDate])

  const onClear = React.useCallback(() => onChange({ from: '', to: '' }), [onChange])

  const commit = React.useCallback(
    (r: { from: Date; to: Date }) => {
      onChange({ from: toDateString(r.from), to: toDateString(r.to) })
      setOpen(false)
    },
    [onChange]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative w-full max-w-full min-w-0 sm:w-64', className)}>
        <PickerTrigger {...rest} placeholder={placeholder} label={label} clearable={clearable} onClear={onClear} />
        <HiddenValue name={name} required={required} value={from && to ? `${from}/${to}` : ''} />
      </div>
      <PopoverContent className='w-auto max-w-[calc(100vw-2rem)] gap-0 p-0' align={align}>
        <RangeBody from={fromDate} to={toDate} min={min} max={max} presets={presets} onCommit={commit} />
      </PopoverContent>
    </Popover>
  )
}

/** Mounted only while the popover is open, so its draft state resets on every open. */
function RangeBody({
  from,
  to,
  min,
  max,
  presets,
  onCommit
}: {
  from: Date | undefined
  to: Date | undefined
  min?: string
  max?: string
  presets: boolean
  onCommit: (r: { from: Date; to: Date }) => void
}) {
  const wide = useIsWide()
  const { minDate, maxDate, disabled } = useBounds(min, max)
  const [draft, setDraft] = React.useState<DateRange | undefined>(from || to ? { from, to } : undefined)

  // Click 1 starts a range, click 2 finishes it and commits. A click on a finished range starts over.
  const onSelect = React.useCallback(
    (_: DateRange | undefined, day: Date) => {
      if (!draft?.from || draft.to) return setDraft({ from: day, to: undefined })
      const [a, b] = day < draft.from ? [day, draft.from] : [draft.from, day]

      onCommit({ from: a, to: b })
    },
    [draft, onCommit]
  )

  const defaultMonth = React.useMemo(() => {
    const anchor = from ?? to ?? maxDate ?? new Date()

    // With two months showing, open on the previous month so "today" sits on the right.
    return wide && !from ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) : anchor
  }, [from, to, maxDate, wide])

  return (
    <div className='flex flex-col md:flex-row'>
      {presets && (
        <div className='flex flex-wrap gap-1 border-b p-2 md:w-36 md:flex-col md:flex-nowrap md:border-r md:border-b-0'>
          {PRESETS.map(p => (
            <Button
              key={p.label}
              variant='ghost'
              size='sm'
              className='h-7 justify-start rounded-md text-xs font-medium'
              onClick={() => onCommit(p.range())}
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}
      <Calendar
        mode='range'
        selected={draft}
        onSelect={onSelect}
        numberOfMonths={wide ? 2 : 1}
        defaultMonth={defaultMonth}
        disabled={disabled}
        startMonth={minDate}
        endMonth={maxDate}
        autoFocus
      />
    </div>
  )
}
