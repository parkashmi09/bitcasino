import type { jsPDF } from 'jspdf'
import type autoTableFn from 'jspdf-autotable'

import type { Branch, BranchTotals } from './BranchView'

/**
 * The branch reports as PDF, built in the browser (jsPDF, as views/exchange/exportList), with their
 * charts drawn as vectors: the KPIs, the daily trend of money in / out and of GGR, the branches
 * side by side (all-branches report) and the daily table.
 */

/** One UTC day of a branch's figures (only days with activity come back). */
export type BranchDay = BranchTotals & { bucket: string }

export type BranchFigures = { branch: Branch; players: number; currency: string | null; totals: BranchTotals; buckets?: BranchDay[] }

type Range = { from: string; to: string }
type RGB = [number, number, number]

// The dataviz reference palette (categorical slots 1–4, light) and ink.
const BLUE: RGB = [42, 120, 214]
const ORANGE: RGB = [235, 104, 52]
const AQUA: RGB = [27, 175, 122]
const VIOLET: RGB = [98, 80, 214]
const INK: RGB = [11, 11, 11]
const INK_2: RGB = [82, 81, 78]
const MUTED: RGB = [140, 139, 134]
const GRID: RGB = [228, 227, 223]
const TILE: RGB = [246, 246, 244]
const HEAD: RGB = [41, 128, 185]

const M = 36 // page margin

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0

const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 })

/** jsPDF's built-in font has no ₹ glyph — the code goes in front instead. */
const money = (v: string | number | null | undefined, cur?: string | null) => `${cur ? `${cur} ` : ''}${fmt.format(num(v))}`

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })

/** Every day from the range's first (or an earlier UTC bucket's) to its last, so quiet days show as 0. */
const daysOf = (range: Range, buckets: BranchDay[]) => {
  const first = [range.from, ...buckets.map(b => b.bucket)].sort()[0]
  const last = [range.to, ...buckets.map(b => b.bucket)].sort().at(-1) as string
  const out: string[] = []

  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))

  return out
}

/** Sum branches' daily buckets day by day (the all-branches trend). */
const sumBuckets = (rows: BranchFigures[]): BranchDay[] => {
  const by = new Map<string, Record<string, number>>()

  for (const r of rows)
    for (const b of r.buckets ?? []) {
      const acc = by.get(b.bucket) ?? {}

      for (const [k, v] of Object.entries(b)) if (k !== 'bucket') acc[k] = (acc[k] ?? 0) + num(v as string | number)
      by.set(b.bucket, acc)
    }

  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([bucket, v]) => ({ bucket, ...v }) as unknown as BranchDay)
}

/** A "nice" axis: 0 included, ~5 steps of 1 / 2 / 5 × 10ⁿ. */
const niceScale = (values: number[]) => {
  let lo = Math.min(0, ...values)
  let hi = Math.max(0, ...values)

  if (lo === hi) hi = lo + 1
  const raw = (hi - lo) / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(f => f * mag).find(s => s >= raw) as number

  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const ticks: number[] = []

  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.abs(t) < step / 1e6 ? 0 : t)

  return { lo, hi, ticks }
}

const text = (doc: jsPDF, s: string, x: number, y: number, { size = 9, color = INK_2, bold = false, align = 'left' as 'left' | 'center' | 'right' } = {}) => {
  doc.setFont('helvetica', bold ? 'bold' : 'normal')
  doc.setFontSize(size)
  doc.setTextColor(...color)
  doc.text(s, x, y, { align })
}

/** Swatch + name (+ value) per series, laid out right to left from `right`. */
const legend = (doc: jsPDF, items: { name: string; color: RGB }[], right: number, y: number) => {
  let x = right

  for (const it of [...items].reverse()) {
    doc.setFontSize(8)
    const w = doc.getTextWidth(it.name)

    x -= w
    text(doc, it.name, x, y, { size: 8, color: INK_2 })
    doc.setFillColor(...it.color)
    doc.roundedRect(x - 12, y - 6.5, 8, 8, 1.5, 1.5, 'F')
    x -= 24
  }
}

type Series = { name: string; color: RGB; values: number[] }

/** Lines over days: a recessive grid, one zero-based y axis, ≤ 8 day labels, a legend. */
const lineChart = (doc: jsPDF, box: { x: number; y: number; w: number; h: number }, title: string, days: string[], series: Series[]) => {
  const { x, y, w, h } = box

  text(doc, title, x, y + 10, { size: 10.5, color: INK, bold: true })
  legend(doc, series, x + w, y + 10)

  const plot = { x: x + 44, y: y + 26, w: w - 50, h: h - 46 }
  const { lo, hi, ticks } = niceScale(series.flatMap(s => s.values))
  const yOf = (v: number) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h
  const xOf = (i: number) => (days.length === 1 ? plot.x + plot.w / 2 : plot.x + (i / (days.length - 1)) * plot.w)

  doc.setLineWidth(0.5)

  for (const t of ticks) {
    doc.setDrawColor(...(t === 0 ? MUTED : GRID))
    doc.line(plot.x, yOf(t), plot.x + plot.w, yOf(t))
    text(doc, compact.format(t), plot.x - 6, yOf(t) + 2.5, { size: 7, color: MUTED, align: 'right' })
  }

  const every = Math.max(1, Math.ceil(days.length / 8))

  days.forEach((d, i) => {
    if ((i % every === 0 && days.length - 1 - i > every / 2) || i === days.length - 1) text(doc, dayLabel(d), xOf(i), plot.y + plot.h + 12, { size: 7, color: MUTED, align: 'center' })
  })

  for (const s of series) {
    doc.setDrawColor(...s.color)
    doc.setLineWidth(1.6)
    doc.setLineJoin('round')

    for (let i = 1; i < s.values.length; i++) doc.line(xOf(i - 1), yOf(s.values[i - 1]), xOf(i), yOf(s.values[i]))

    // Markers only while there is room for them.
    if (days.length <= 31) {
      doc.setFillColor(...s.color)
      s.values.forEach((v, i) => doc.circle(xOf(i), yOf(v), 1.8, 'F'))
    }
  }
}

/**
 * Horizontal bars, one row per category, one bar per series in the row, from a zero baseline
 * (negative values grow left), each labelled with its value.
 */
const barChart = (doc: jsPDF, box: { x: number; y: number; w: number }, title: string, cats: string[], series: Series[]) => {
  const { x, y, w } = box
  const barH = 9
  const rowH = series.length * (barH + 2) + 10

  text(doc, title, x, y + 10, { size: 10.5, color: INK, bold: true })
  if (series.length > 1) legend(doc, series, x + w, y + 10)

  const labelW = 110
  const valueW = 70
  const plot = { x: x + labelW, y: y + 24, w: w - labelW - valueW }
  const { lo, hi } = niceScale(series.flatMap(s => s.values))
  const xOf = (v: number) => plot.x + ((v - lo) / (hi - lo)) * plot.w
  const h = cats.length * rowH

  cats.forEach((c, i) => {
    const top = plot.y + i * rowH + 5

    doc.setFontSize(8)
    const lines = doc.splitTextToSize(c, labelW - 14) as string[]
    const name = lines.length > 1 ? `${lines[0]}...` : lines[0]

    text(doc, name, x, top + (series.length * (barH + 2)) / 2 + 2, { size: 8, color: INK_2 })

    series.forEach((s, j) => {
      const v = s.values[i]
      const by = top + j * (barH + 2)
      const a = xOf(Math.min(0, v))
      const b = xOf(Math.max(0, v))

      doc.setFillColor(...s.color)
      if (b - a > 0.3) doc.roundedRect(a, by, b - a, barH, 1.5, 1.5, 'F')
      text(doc, compact.format(v), v < 0 ? a - 4 : b + 4, by + barH - 1.5, { size: 7, color: INK_2, align: v < 0 ? 'right' : 'left' })
    })
  })

  doc.setDrawColor(...MUTED)
  doc.setLineWidth(0.5)
  doc.line(xOf(0), plot.y, xOf(0), plot.y + h)

  return y + 24 + h
}

/** Eight tiles: the figure, and what it counts. */
const kpis = (doc: jsPDF, y: number, players: number, t: BranchTotals, cur: string | null) => {
  const W = doc.internal.pageSize.getWidth() - 2 * M
  const gap = 8
  const tw = (W - 3 * gap) / 4
  const th = 46

  const tiles: [string, string, string][] = [
    ['Players', String(players), `${t.registrations} new in the period`],
    ['Total deposit', money(t.deposits, cur), `${t.depositCount} deposits`],
    ['Total withdraw', money(t.withdrawals, cur), `${t.withdrawalCount} withdrawals`],
    ['Net (deposit - withdraw)', money(t.net, cur), num(t.net) >= 0 ? 'more in than out' : 'more out than in'],
    ['Casino bets', money(t.casinoWagered, cur), `${t.casinoBets} bets · won ${money(t.casinoWon)}`],
    ['Casino GGR', money(t.casinoGgr, cur), 'bets - wins'],
    ['Sports bets', money(t.sportsStaked, cur), `${t.sportsBets} bets`],
    ['Sports GGR', money(t.sportsGgr, cur), 'house result']
  ]

  tiles.forEach(([label, value, hint], i) => {
    const tx = M + (i % 4) * (tw + gap)
    const ty = y + Math.floor(i / 4) * (th + gap)

    doc.setFillColor(...TILE)
    doc.roundedRect(tx, ty, tw, th, 4, 4, 'F')
    text(doc, label, tx + 10, ty + 13, { size: 7.5, color: MUTED })
    text(doc, value, tx + 10, ty + 29, { size: 12, color: INK, bold: true })
    text(doc, hint, tx + 10, ty + 40, { size: 7, color: MUTED })
  })

  return y + 2 * th + gap
}

/** Title block at the top of a page; returns where the content starts. */
const header = (doc: jsPDF, title: string, sub: string) => {
  const W = doc.internal.pageSize.getWidth()

  text(doc, title, M, M + 8, { size: 16, color: INK, bold: true })
  text(doc, sub, M, M + 22, { size: 8.5, color: MUTED })
  doc.setDrawColor(...GRID)
  doc.setLineWidth(0.75)
  doc.line(M, M + 30, W - M, M + 30)

  return M + 42
}

const footer = (doc: jsPDF, note: string) => {
  const n = doc.getNumberOfPages()
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()

  for (let p = 1; p <= n; p++) {
    doc.setPage(p)
    text(doc, note, M, H - 16, { size: 7, color: MUTED })
    text(doc, `Page ${p} of ${n}`, W - M, H - 16, { size: 7, color: MUTED, align: 'right' })
  }
}

const NOTE = "Amounts in other coins are converted at today's rate. Charts by UTC day. GGR = bets - wins."

const subOf = (range: Range, cur: string | null) =>
  `${range.from} to ${range.to}${cur ? ` · amounts in ${cur}` : ''} · generated ${new Date().toLocaleString('en-IN')}`

type AutoTable = typeof autoTableFn

/** One branch's pages: KPIs, two trend charts, the daily table. */
const branchSection = (doc: jsPDF, autoTable: AutoTable, r: BranchFigures, range: Range, title: string) => {
  const W = doc.internal.pageSize.getWidth()
  const cur = r.currency
  let y = header(doc, title, `${r.branch.username ? `Login ${r.branch.username} · ${r.branch.status} · ` : ''}${subOf(range, cur)}`)

  y = kpis(doc, y, r.players, r.totals, cur) + 18

  const buckets = r.buckets ?? []

  if (!buckets.length) {
    text(doc, 'No activity in this period.', M, y + 10, { size: 10, color: MUTED })

    return
  }

  const days = daysOf(range, buckets)
  const by = new Map(buckets.map(b => [b.bucket, b]))
  const col = (k: keyof BranchTotals) => days.map(d => num(by.get(d)?.[k]))
  const half = (W - 2 * M - 24) / 2
  const h = doc.internal.pageSize.getHeight() - y - 50

  lineChart(doc, { x: M, y, w: half, h }, 'Deposits and withdrawals per day', days, [
    { name: 'Deposit', color: BLUE, values: col('deposits') },
    { name: 'Withdraw', color: ORANGE, values: col('withdrawals') }
  ])
  lineChart(doc, { x: M + half + 24, y, w: half, h }, 'GGR per day', days, [
    { name: 'Casino GGR', color: AQUA, values: col('casinoGgr') },
    { name: 'Sports GGR', color: VIOLET, values: col('sportsGgr') }
  ])

  doc.addPage()
  y = header(doc, `${title} - daily`, subOf(range, cur))
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    margin: { top: M, left: M, right: M, bottom: 30 },
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: HEAD, textColor: 255, fontStyle: 'bold' },
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => [i, { halign: 'right' as const }])),
    head: [['Day', 'New', 'Deposit', 'Withdraw', 'Net', 'Casino bets', 'Casino won', 'Casino GGR', 'Sports bets', 'Sports GGR']],
    body: [
      ...buckets.map(b => [b.bucket, b.registrations, money(b.deposits), money(b.withdrawals), money(b.net), money(b.casinoWagered), money(b.casinoWon), money(b.casinoGgr), money(b.sportsStaked), money(b.sportsGgr)]),
      ['Total', r.totals.registrations, money(r.totals.deposits), money(r.totals.withdrawals), money(r.totals.net), money(r.totals.casinoWagered), money(r.totals.casinoWon), money(r.totals.casinoGgr), money(r.totals.sportsStaked), money(r.totals.sportsGgr)]
    ],
    didParseCell: data => {
      if (data.section === 'body' && data.row.index === buckets.length) data.cell.styles.fontStyle = 'bold'
    }
  })
}

const load = async () => {
  const { default: JsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  return { doc: new JsPDF('l', 'pt', 'a4'), autoTable }
}

/** One branch, in detail. */
export async function branchReportPdf(fileName: string, r: BranchFigures, range: Range) {
  const { doc, autoTable } = await load()

  branchSection(doc, autoTable, r, range, `${r.branch.name} - branch report`)
  footer(doc, NOTE)
  doc.save(`${fileName}.pdf`)
}

/** Every branch: totals, the branches compared, the comparison table, then each branch in detail. */
export async function allBranchesReportPdf(fileName: string, rows: BranchFigures[], total: BranchTotals & { players: number }, currency: string | null, range: Range) {
  const { doc, autoTable } = await load()
  const half = (doc.internal.pageSize.getWidth() - 2 * M - 24) / 2
  const all: BranchFigures = { branch: { id: 0, name: 'All branches', username: '', status: 'active', createdAt: '', lastLoginAt: null }, players: total.players, currency, totals: total, buckets: sumBuckets(rows) }

  // The totals and their daily trend, as one branch's section.
  branchSection(doc, autoTable, all, range, `Branch report - all ${rows.length} branches`)

  // Branches compared, biggest first; ~12 rows fit a chart beside its neighbour.
  if (rows.length) {
    const ranked = [...rows].sort((a, b) => num(b.totals.deposits) - num(a.totals.deposits))

    for (let i = 0; i < ranked.length; i += 12) {
      const part = ranked.slice(i, i + 12)
      const cats = part.map(r => r.branch.name)
      const more = ranked.length > 12 ? ` (${i + 1}-${i + part.length} of ${ranked.length}, by deposit)` : ''

      doc.addPage()
      const y = header(doc, `Branches compared${more}`, subOf(range, currency))

      barChart(doc, { x: M, y, w: half }, 'Deposit and withdraw', cats, [
        { name: 'Deposit', color: BLUE, values: part.map(r => num(r.totals.deposits)) },
        { name: 'Withdraw', color: ORANGE, values: part.map(r => num(r.totals.withdrawals)) }
      ])
      barChart(doc, { x: M + half + 24, y, w: half }, 'GGR', cats, [
        { name: 'Casino GGR', color: AQUA, values: part.map(r => num(r.totals.casinoGgr)) },
        { name: 'Sports GGR', color: VIOLET, values: part.map(r => num(r.totals.sportsGgr)) }
      ])
    }
  }

  // The comparison table.
  doc.addPage()
  autoTable(doc, {
    startY: header(doc, 'All branches - totals', subOf(range, currency)),
    theme: 'striped',
    margin: { top: M, left: M, right: M, bottom: 30 },
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: HEAD, textColor: 255, fontStyle: 'bold' },
    columnStyles: Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => [i, { halign: 'right' as const }])),
    head: [['Branch', 'Status', 'Players', 'New', 'Deposit', 'Withdraw', 'Net', 'Casino bets', 'Casino GGR', 'Sports bets', 'Sports GGR']],
    body: [...rows, all].map(r => [
      r.branch.name,
      r === all ? '' : r.branch.status,
      r.players,
      r.totals.registrations,
      money(r.totals.deposits),
      money(r.totals.withdrawals),
      money(r.totals.net),
      money(r.totals.casinoWagered),
      money(r.totals.casinoGgr),
      money(r.totals.sportsStaked),
      money(r.totals.sportsGgr)
    ]),
    didParseCell: data => {
      if (data.section === 'body' && data.row.index === rows.length) data.cell.styles.fontStyle = 'bold'
    }
  })

  // Each branch in detail.
  for (const r of rows) {
    doc.addPage()
    branchSection(doc, autoTable, r, range, `${r.branch.name} - branch report`)
  }

  footer(doc, NOTE)
  doc.save(`${fileName}.pdf`)
}
