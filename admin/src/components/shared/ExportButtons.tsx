'use client'

import { useState } from 'react'

import { DownloadIcon, FileTextIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/api/client'
import type { Query } from '@/lib/api/types'
import { exportPdf } from '@/views/exchange/exportList'

export type Cell = string | number | null | undefined

/** One CSV cell, safe to open in a spreadsheet: quoted, and a leading = + - @ forced to text (not a negative number). */
const csvCell = (v: Cell) => {
  const s = v == null ? '' : String(v)
  const safe = /^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d/.test(s)) ? `'${s}` : s

  return `"${safe.replace(/"/g, '""')}"`
}

export function exportCsv(fileName: string, head: string[], rows: Cell[][]) {
  const text = [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')

  a.href = URL.createObjectURL(blob)
  a.download = `${fileName}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

const PAGE = 200
const MAX_PAGES = 50

/**
 * Every row of a `{ rows, totalPages }` report (or a paginated list with `paged`) for the same
 * filters, page by page at 200 — the export is the whole period, not the page on screen.
 * Capped at 10,000 rows.
 */
export async function fetchAllRows<T>(path: string, query: Query, { paged = false }: { paged?: boolean } = {}): Promise<T[]> {
  const out: T[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (paged) {
      const res = await api.paged<T>(path, { ...query, page, limit: PAGE })

      out.push(...res.rows)
      if (!res.pagination?.hasNext) break
    } else {
      const res = await api.get<{ rows: T[]; totalPages: number }>(path, { ...query, page, limit: PAGE })

      out.push(...(res?.rows ?? []))
      if (!res || page >= (res.totalPages ?? 1)) break
    }
  }

  return out
}

type Props = {
  fileName: string
  title: string
  head: string[]

  /** The rows to export — fetched on click (all pages), or already on screen. */
  rows: () => Promise<Cell[][]> | Cell[][]
  disabled?: boolean
}

/** CSV and PDF of a table, built in the browser (PDF: jsPDF, as views/exchange/exportList). */
const ExportButtons = ({ fileName, title, head, rows, disabled }: Props) => {
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null)

  const run = async (kind: 'csv' | 'pdf') => {
    setBusy(kind)

    try {
      const data = await rows()

      if (!data.length) {
        toast.info('Nothing to export for this period')

        return
      }

      // jsPDF's built-in font has no ₹ glyph.
      if (kind === 'csv') exportCsv(fileName, head, data)
      else await exportPdf(fileName, title, head, data.map(r => r.map(v => (v == null ? '' : String(v).replace(/₹/g, 'INR ')))))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className='flex gap-1'>
      <Button size='sm' variant='outline' disabled={disabled || busy !== null} onClick={() => run('csv')}>
        {busy === 'csv' ? <Loader2Icon className='animate-spin' /> : <DownloadIcon />} CSV
      </Button>
      <Button size='sm' variant='outline' disabled={disabled || busy !== null} onClick={() => run('pdf')}>
        {busy === 'pdf' ? <Loader2Icon className='animate-spin' /> : <FileTextIcon />} PDF
      </Button>
    </div>
  )
}

export default ExportButtons
