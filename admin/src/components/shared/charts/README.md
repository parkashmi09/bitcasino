# Chart kit

[ApexCharts](https://apexcharts.com) (`apexcharts@3.53.0` + `react-apexcharts@1.5.0`, MIT — the version the Luno
template ships) with Luno's chart options, coloured from the admin's CSS tokens. Charts are drawn on the client only
(a skeleton holds the box until mount).
Import everything from `@/components/shared/charts`.

## Filters (URL state)

```tsx
const f = useStatsFilters({ defaultPreset: '30d', defaultGranularity: 'day', extraKeys: ['sport'] })
<FilterBar filters={f}>{/* extra dimension selects */}</FilterBar>
```

URL params: `preset` (today|7d|30d|90d|mtd|custom), `from`/`to` (only with `custom`, `yyyy-MM-dd`),
`granularity` (day|week|month), plus your `extraKeys`. No currency filter: routes answer every
currency, valued in the site's default coin.

`f` gives: `from`/`to` (inclusive UTC days), `days`, `granularity`, `buckets`
(every bucket key in the window), `apiRange` (half-open ISO instants), `previous` (the same-length
window right before, with its own `apiRange`, for deltas), `query` (`{from, to, granularity}`
as instants — send only keys your route's `.strict()` validator accepts), `extra`, and `set(patch)`.

Limits: windows longer than `MAX_RANGE_DAYS` (731) are clamped; day buckets over `MAX_DAY_SPAN`
(366) step up to weeks. Days and buckets are UTC; weeks start Monday (matches Postgres `date_trunc`).

## Charts

All take `ariaLabel` (required), `height`, `loading`, `error`, `emptyMessage`, `format`
(`'number' | 'money' | 'percent'`) and `currency` (tooltip suffix for money). The frame keeps its
height while loading (skeleton), on error (`ErrorState`) and when empty (all blank/zero).

- `TimeSeriesChart` `{ buckets, granularity, series, kind: 'area'|'line'|'bar', stacked }` —
  `series: { name, data: (number|null)[], color?, kind? }[]`. Mixed bar+line via per-series `kind`.
  One y-axis only: different scales belong in two charts.
- `BarChart` `{ categories, series, horizontal, stacked }` — top-N lists; use `horizontal` for names.
- `DonutChart` `{ labels, values, colors?, totalLabel }` — fold the tail into "Other" first.
- `Sparkline` `{ data, color, kind, labels?, format?, currency? }` — no axes, for tiles.

Colours: tokens `chart-1`…`chart-8` (categorical, fixed order, validated for colour-blind
separation in both modes), or `primary | success | danger | warning | info | muted-foreground`
(status tokens only for status meaning). Series without `color` take the slots in order.
Theme switches re-render automatically (`useChartTheme`).

## Framing

- `ChartCard` `{ title, description?, actions?, table?, footer? }` — pass `table` to get a
  Chart/Table toggle. Build it with `seriesTable({ buckets, granularity, series, format, currency })`
  or `categoryTable({ categories, series, format, currency })`.
- `KpiCard` `{ label, value, unit?, hint?, icon?, loading?, delta?, goodWhen?, spark?, sparkColor?,
  sparkLabels?, sparkFormat?, sparkCurrency? }` — `delta` is a percent (`percentChange(cur, prev)`).

## Helpers

`fillBuckets(keys, rows, row => row.bucket, row => row.value)` lines API rows up with every
bucket (gaps → 0). `bucketKeys`, `bucketLabel`, `bucketStart`, `formatValue`, `formatAxisValue`,
`percentChange`, `sumOf` (display only — never money arithmetic).
