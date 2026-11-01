'use client'

import { useState } from 'react'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import PageHeader from '@/components/shared/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApi, usePagedApi } from '@/hooks/use-api'

import { CsvButton, MonthPicker, PdfButton, StatementView, monthPeriod, thisMonth, type Statement } from './RevenueShare'

type Named = Statement & { id: number; name: string; slug: string; status: string }

type AllStatements = {
  from: string
  to: string
  totalGgr: string
  totalShare: string
  whitelabels: Named[]
}

type Option = { id: number; name: string; status: string }

const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const StatementCard = ({ w }: { w: Named }) => (
  <Card>
    <CardHeader>
      <CardTitle>
        <Link href={`/whitelabels/${w.id}`} className='hover:underline'>
          {w.name}
        </Link>
      </CardTitle>
      <CardDescription>
        {w.slug} · {w.status} · share due {inr(w.totalShare)}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <StatementView statement={w} who='parent' />
    </CardContent>
  </Card>
)

/**
 * Revenue-share statements by month (Super Admin): every whitelabel with the totals, or one
 * (`?id=`, the list's Report button), each with its own CSV.
 */
const WhitelabelsReport = () => {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const id = params.get('id') ?? 'all'
  const [month, setMonth] = useState(thisMonth)
  const period = monthPeriod(month)

  // Built whitelabels for the picker (a deleted one can still be reported on purpose).
  const options = usePagedApi<Option>('admin/whitelabels', { limit: 200, page: 1 })
  const choices = (options.data?.rows ?? []).filter(o => !['queued', 'creating'].includes(o.status))

  const all = useApi<AllStatements>(id === 'all' ? 'admin/whitelabels/report' : null, period)
  const one = useApi<Named>(id === 'all' ? null : `admin/whitelabels/${id}/report`, period)
  const loading = id === 'all' ? all.isLoading : one.isLoading
  const error = id === 'all' ? all.error : one.error

  const choose = (value: string) => router.replace(value === 'all' ? pathname : `${pathname}?id=${value}`)

  const description =
    id === 'all'
      ? all.data
        ? `All whitelabels: GGR ${inr(all.data.totalGgr)} · revenue share due ${inr(all.data.totalShare)}. Reported, not collected.`
        : 'All whitelabels, by month.'
      : one.data
        ? `${one.data.name}: GGR ${inr(one.data.totalGgr)} · revenue share due ${inr(one.data.totalShare)}. Reported, not collected.`
        : 'One whitelabel, by month.'

  return (
    <div className='grid gap-6'>
      <PageHeader
        title='Revenue share report'
        description={description}
        actions={
          <div className='flex flex-wrap items-center gap-2'>
            <Select value={id} onValueChange={v => v && choose(String(v))}>
              <SelectTrigger className='w-48'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All whitelabels</SelectItem>
                {choices.map(o => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.name}
                    {o.status === 'deleted' ? ' (deleted)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <MonthPicker value={month} onChange={setMonth} />
            <PdfButton
              title={id === 'all' ? `Revenue share — all whitelabels — ${month}` : `Revenue share — ${one.data?.name ?? `whitelabel ${id}`} — ${month}`}
              fileName={id === 'all' ? `whitelabels-revenue-share-${month}` : `${one.data?.slug ?? `whitelabel-${id}`}-revenue-share-${month}`}
              get={() =>
                id === 'all'
                  ? all.data
                    ? { statements: all.data.whitelabels, totals: { totalGgr: all.data.totalGgr, totalShare: all.data.totalShare } }
                    : null
                  : one.data
                    ? { statements: [one.data] }
                    : null
              }
            />
            <CsvButton
              path={id === 'all' ? 'admin/whitelabels/report.csv' : `admin/whitelabels/${id}/report.csv`}
              period={period}
              fileName={id === 'all' ? `whitelabels-revenue-share-${month}.csv` : `${one.data?.slug ?? `whitelabel-${id}`}-revenue-share-${month}.csv`}
            />
          </div>
        }
      />
      {loading && <p className='text-muted-foreground text-sm'>Loading…</p>}
      {error && <p className='text-destructive text-sm'>{String((error as Error).message)}</p>}
      {id === 'all' && all.data?.whitelabels.length === 0 && <p className='text-muted-foreground text-sm'>No whitelabel had any activity this month.</p>}
      {id === 'all' && all.data?.whitelabels.map(w => <StatementCard key={w.id} w={w} />)}
      {id !== 'all' && one.data && <StatementCard w={one.data} />}
    </div>
  )
}

export default WhitelabelsReport
