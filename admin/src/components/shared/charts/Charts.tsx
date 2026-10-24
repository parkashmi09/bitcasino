'use client'

import { useMemo } from 'react'

import dynamic from 'next/dynamic'

import type { ApexOptions } from 'apexcharts'

import { ChartFrame, isEmptySeries, useBoxSize, type CommonChartProps } from './ChartFrame'
import { bucketLabel, formatAxisValue, formatValue, type Granularity, type ValueFormat } from './format'
import { useChartTheme, type ChartColor, type ChartTheme } from './theme'

// ApexCharts touches `window` on import, so it is loaded on the client only (ChartFrame shows a skeleton until then).
const Apex = dynamic(() => import('react-apexcharts'), { ssr: false })

export type ChartSeries = {
  name: string
  data: (number | null)[]

  /** A token (`chart-1`…`chart-8`, `primary`, …). Default: the next categorical slot, by position. */
  color?: ChartColor

  /** Per-series mark in a mixed chart (bars + a line). Defaults to the chart's `kind`. */
  kind?: 'line' | 'area' | 'bar'
}

/** About how many px one x-axis label ("w/c 05 Oct") needs, gap included. */
const X_LABEL_PX = 64

const valueFormatter = (format: ValueFormat, currency: string | null | undefined) => (v: number | null | undefined) =>
  formatValue(v, format, format === 'money' ? currency : undefined)

/**
 * One entrance for every chart: series ease in over 0.8s (points a touch staggered), and a data or theme
 * update glides in 0.35s. Off for visitors who ask for reduced motion, like the rest of the admin's motion.
 */
const animations = (): NonNullable<ApexOptions['chart']>['animations'] => {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return reduce
    ? { enabled: false }
    : { enabled: true, easing: 'easeinout', speed: 800, animateGradually: { enabled: true, delay: 60 }, dynamicAnimation: { enabled: true, speed: 350 } }
}

/**
 * The Luno template's chart look: ApexCharts' own defaults (Luno sets only toolbar off, dataLabels off,
 * legend bottom-centre, solid fill), with the grid, axis text and tooltip taken from the admin tokens so
 * dark mode reads.
 */
function lunoBase(theme: ChartTheme, colors: string[], format: ValueFormat): ApexOptions {
  const label = { colors: theme.color['muted-foreground'], fontSize: '12px' }

  return {
    chart: { toolbar: { show: false }, zoom: { enabled: false }, background: 'transparent', parentHeightOffset: 0, redrawOnParentResize: true, animations: animations() },
    colors,
    dataLabels: { enabled: false },
    legend: { position: 'bottom', horizontalAlign: 'center', labels: { colors: theme.color.foreground } },
    grid: { borderColor: theme.color.border, strokeDashArray: 0, padding: { left: 4, right: 8 } },
    xaxis: { labels: { style: label }, axisBorder: { color: theme.color.border }, axisTicks: { color: theme.color.border } },
    yaxis: { labels: { style: label, formatter: (v: number) => formatAxisValue(v, format) } },
    tooltip: { theme: theme.mode },
    states: { active: { filter: { type: 'none' } } }
  }
}

/** Line/area/bar over time buckets. One y-axis, always — two measures of different scale are two charts. */
export type TimeSeriesChartProps = CommonChartProps & {

  /** Bucket keys ('yyyy-MM-dd', the bucket's first day) — see `bucketKeys()`. */
  buckets: string[]
  granularity?: Granularity
  series: ChartSeries[]
  kind?: 'line' | 'area' | 'bar'
  stacked?: boolean
}

export const TimeSeriesChart = ({
  buckets,
  granularity = 'day',
  series,
  kind = 'area',
  stacked,
  height = 280,
  format = 'number',
  currency,
  ...frame
}: TimeSeriesChartProps) => {
  const theme = useChartTheme()
  const [boxRef, { width }] = useBoxSize()

  // Show only as many bucket labels as the width holds; the rest stay in the tooltip.
  const labelPx = granularity === 'week' ? X_LABEL_PX + 16 : X_LABEL_PX
  const fit = width ? Math.max(2, Math.floor((width - 48) / labelPx)) : 8
  const step = buckets.length > fit ? Math.ceil(buckets.length / fit) : 1
  const categories = useMemo(() => buckets.map(b => bucketLabel(b, granularity)), [buckets, granularity])

  const options = useMemo<ApexOptions>(() => {
    const colors = series.map((s, i) => theme.resolve(s.color, i))
    const kinds = series.map(s => s.kind ?? kind)
    const mixed = new Set(kinds).size > 1
    const base = lunoBase(theme, colors, format)
    const fmt = valueFormatter(format, currency)

    return {
      ...base,
      chart: { ...base.chart, type: mixed ? 'line' : kind, stacked: Boolean(stacked) },
      stroke: { curve: 'smooth', width: kinds.map(k => (k === 'bar' ? 0 : 2)) },

      // Mixed charts need the fill per series; a pure area keeps Apex's own area gradient.
      ...(mixed ? { fill: { type: kinds.map(k => (k === 'area' ? 'gradient' : 'solid')), opacity: kinds.map(k => (k === 'area' ? 0.35 : 1)) } } : {}),
      markers: { size: categories.length === 1 ? 4 : 0, strokeWidth: 0, hover: { size: 5 } },
      legend: { ...base.legend, show: series.length > 1 },
      xaxis: {
        ...base.xaxis,
        categories,
        tooltip: { enabled: false },

        // Every `step`-th label only (Apex ignores tickAmount on a bar chart's category axis).
        labels: {
          ...base.xaxis?.labels,
          rotate: 0,
          hideOverlappingLabels: true,
          formatter: (v: string, _ts?: number, opts?: { i?: number }) => {
            const i = opts?.i ?? categories.indexOf(v)

            return i % step === 0 ? v : ''
          }
        }
      },
      tooltip: { ...base.tooltip, shared: true, intersect: false, x: { formatter: (_v: number, o?: { dataPointIndex?: number }) => categories[o?.dataPointIndex ?? 0] ?? '' }, y: { formatter: fmt } }
    }
  }, [series, kind, stacked, categories, step, theme, format, currency])

  const apexSeries = useMemo(() => series.map(s => ({ name: s.name, type: s.kind ?? kind, data: s.data })), [series, kind])

  return (
    <ChartFrame {...frame} height={height} empty={buckets.length === 0 || isEmptySeries(series)}>
      <div ref={boxRef} className='size-full'>
        <Apex type={options.chart?.type} options={options} series={apexSeries} height='100%' width='100%' />
      </div>
    </ChartFrame>
  )
}

/** Bars over named categories (top games, sports, currencies). Horizontal reads best for long names. */
export type BarChartProps = CommonChartProps & {
  categories: string[]
  series: ChartSeries[]
  horizontal?: boolean
  stacked?: boolean
}

export const BarChart = ({ categories, series, horizontal, stacked, height = 280, format = 'number', currency, ...frame }: BarChartProps) => {
  const theme = useChartTheme()

  const options = useMemo<ApexOptions>(() => {
    const colors = series.map((s, i) => theme.resolve(s.color, i))
    const base = lunoBase(theme, colors, format)
    const fmt = valueFormatter(format, currency)
    const axisFmt = (v: string | number) => formatAxisValue(Number(v), format)

    return {
      ...base,
      chart: { ...base.chart, type: 'bar', stacked: Boolean(stacked) },
      plotOptions: { bar: { horizontal: Boolean(horizontal) } },
      fill: { opacity: 1 },
      legend: { ...base.legend, show: series.length > 1 },

      // Horizontal: the value axis is x and the names sit on y (Apex cuts them at 160px).
      xaxis: {
        ...base.xaxis,
        categories,
        labels: { ...base.xaxis?.labels, trim: true, ...(horizontal ? { formatter: axisFmt } : {}) }
      },
      yaxis: horizontal ? { labels: { style: { colors: theme.color.foreground, fontSize: '12px' }, maxWidth: 160 } } : base.yaxis,
      tooltip: { ...base.tooltip, shared: true, intersect: false, y: { formatter: fmt } }
    }
  }, [series, categories, horizontal, stacked, theme, format, currency])

  const apexSeries = useMemo(() => series.map(s => ({ name: s.name, data: s.data })), [series])

  return (
    <ChartFrame {...frame} height={height} empty={categories.length === 0 || isEmptySeries(series)}>
      <Apex type='bar' options={options} series={apexSeries} height='100%' width='100%' />
    </ChartFrame>
  )
}

/** Parts of a whole. Keep it to a handful of slices — fold the tail into "Other" before passing it. */
export type DonutChartProps = CommonChartProps & {
  labels: string[]
  values: number[]
  colors?: ChartColor[]

  /** The label in the middle, over the total ("Total"). */
  totalLabel?: string
}

export const DonutChart = ({ labels, values, colors, totalLabel = 'Total', height = 260, format = 'number', currency, ...frame }: DonutChartProps) => {
  const theme = useChartTheme()
  const data = useMemo(() => values.map(v => Math.max(0, Number(v) || 0)), [values])

  const options = useMemo<ApexOptions>(() => {
    const base = lunoBase(theme, labels.map((_, i) => theme.resolve(colors?.[i], i)), format)
    const fmt = valueFormatter(format, currency)
    const text = (c: string) => ({ show: true, color: c })

    // The hole fits about ten characters: past 10,000 the middle goes compact (1.2M USDT); hover and the table keep it exact.
    const centre = (v: number) => (Math.abs(v) >= 10000 ? `${formatAxisValue(v, format)}${format === 'money' && currency ? ` ${currency}` : ''}` : fmt(v))

    return {
      ...base,
      chart: { ...base.chart, type: 'donut' },
      labels,
      stroke: { colors: [theme.color.card] },
      plotOptions: {
        pie: {
          donut: {
            size: '72%',
            labels: {
              show: true,
              name: { ...text(theme.color['muted-foreground']), fontSize: '13px', offsetY: -4 },
              value: { ...text(theme.color.foreground), fontSize: '17px', fontWeight: 600, offsetY: 4, formatter: (v: string) => centre(Number(v)) },
              total: { show: true, showAlways: true, label: totalLabel, fontSize: '13px', color: theme.color['muted-foreground'], formatter: () => centre(data.reduce((a, v) => a + v, 0)) }
            }
          }
        }
      },
      tooltip: { ...base.tooltip, y: { formatter: fmt } }
    }
  }, [labels, colors, totalLabel, data, theme, format, currency])

  return (
    <ChartFrame {...frame} height={height} empty={labels.length === 0 || values.every(v => !v)}>
      <Apex type='donut' options={options} series={data} height='100%' width='100%' />
    </ChartFrame>
  )
}

/** A tiny trend with no axes, for a KPI tile. Hover still shows the value. */
export type SparklineProps = {
  data: (number | null)[]
  ariaLabel: string
  color?: ChartColor
  kind?: 'line' | 'area' | 'bar'
  height?: number
  format?: CommonChartProps['format']
  currency?: string | null

  /** Labels for the tooltip, one per point (e.g. bucket labels). */
  labels?: string[]
  className?: string
}

export const Sparkline = ({ data: raw, ariaLabel, color = 'chart-1', kind = 'area', height = 40, format = 'number', currency, labels: rawLabels, className }: SparklineProps) => {
  const theme = useChartTheme()

  // A trend starts at the first bucket with activity (keeping one empty bucket before it), so a long
  // range with everything at its end still draws a wave instead of a flat floor and one spike.
  const start = Math.max(0, Math.min(raw.findIndex(v => v !== null && v !== 0), raw.length - 2) - 1)
  const data = useMemo(() => (start > 0 ? raw.slice(start) : raw), [raw, start])
  const labels = useMemo(() => (start > 0 ? rawLabels?.slice(start) : rawLabels), [rawLabels, start])

  const options = useMemo<ApexOptions>(() => {
    // The y range is the data's own range, so the trend uses the whole height. A flat-zero series has
    // no range: pin it to the floor rather than let it float. Bars always start from zero.
    const nums = data.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    let lo = nums.length ? Math.min(...nums) : 0
    let hi = nums.length ? Math.max(...nums) : 1

    if (kind === 'bar') [lo, hi] = [Math.min(0, lo), Math.max(0, hi)]
    if (nums.every(v => v === 0)) [lo, hi] = [0, 1]
    else if (lo === hi) [lo, hi] = [lo - Math.abs(lo || 1), hi + Math.abs(hi || 1)]

    return {
      chart: { type: kind, sparkline: { enabled: true }, animations: animations(), background: 'transparent' },
      colors: [theme.resolve(color, 0)],
      stroke: { curve: 'smooth', width: kind === 'bar' ? 0 : 2 },
      plotOptions: { bar: { columnWidth: data.length < 8 ? '18%' : '60%', borderRadius: 2 } },
      fill: kind === 'area' ? { type: 'gradient', gradient: { opacityFrom: 0.55, opacityTo: 0.08 } } : { opacity: 1 },

      // show: false again here: Apex's updateOptions (theme change) merges this over the sparkline defaults.
      yaxis: { show: false, min: lo, max: hi },
      xaxis: { categories: labels ?? data.map((_, i) => String(i + 1)) },
      tooltip: {
        theme: theme.mode,
        fixed: { enabled: false },
        x: { show: Boolean(labels) },
        y: { title: { formatter: () => '' }, formatter: valueFormatter(format, currency) },
        marker: { show: false }
      }
    }
  }, [data, kind, color, labels, theme, format, currency])

  const series = useMemo(() => [{ name: ariaLabel, data }], [ariaLabel, data])

  if (data.length < 2) return <div className={className} style={{ height }} aria-hidden />

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} className={className}>
      <Apex type={kind} options={options} series={series} height='100%' width='100%' />
    </ChartFrame>
  )
}
