/**
 * The admin's chart kit (ApexCharts with the Luno template's options, themed from the CSS tokens). See README.md in this folder.
 * Import from '@/components/shared/charts' only — the file layout behind this barrel may change.
 */
export { TimeSeriesChart, BarChart, DonutChart, Sparkline } from './Charts'
export type { ChartSeries, TimeSeriesChartProps, BarChartProps, DonutChartProps, SparklineProps } from './Charts'
export { ChartFrame, isEmptySeries } from './ChartFrame'
export type { CommonChartProps } from './ChartFrame'
export { default as ChartCard, ChartTable, seriesTable, categoryTable } from './ChartCard'
export type { ChartTableData } from './ChartCard'
export { default as KpiCard } from './KpiCard'
export { default as FilterBar } from './FilterBar'
export { useStatsFilters, toApiRange, PRESETS, MAX_RANGE_DAYS, MAX_DAY_SPAN } from './useStatsFilters'
export type { Preset, StatsFilters, StatsFilterPatch } from './useStatsFilters'
export {
  bucketKeys,
  bucketStart,
  bucketLabel,
  fillBuckets,
  formatValue,
  formatAxisValue,
  percentChange,
  sumOf,
  GRANULARITIES
} from './format'
export type { Granularity, ValueFormat } from './format'
export { useChartTheme, toRgb, SERIES_TOKENS } from './theme'
export type { ChartColor, ChartTheme } from './theme'
