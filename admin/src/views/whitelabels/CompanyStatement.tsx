'use client'

import { useState } from 'react'

import PageHeader from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { useApi } from '@/hooks/use-api'

import { CsvButton, MonthPicker, PdfButton, StatementView, monthPeriod, thisMonth, type Statement } from './RevenueShare'

/**
 * A whitelabel company's own revenue-share statement (whitelabel builds only): the same numbers the
 * parent's Super Admin sees (backend admin modules/whitelabel-statement).
 */
const CompanyStatement = () => {
  const [month, setMonth] = useState(thisMonth)
  const period = monthPeriod(month)
  const report = useApi<Statement>('admin/whitelabel-statement', period)

  return (
    <div className='grid gap-6'>
      <PageHeader
        title='Revenue share'
        description='Your GGR by product and the share due to the parent site, by month. Gateway charges are already on your Direct balance statement.'
        actions={
          <div className='flex items-center gap-2'>
            <MonthPicker value={month} onChange={setMonth} />
            <PdfButton title={`Revenue share statement — ${month}`} fileName={`revenue-share-${month}`} get={() => (report.data ? { statements: [report.data] } : null)} />
            <CsvButton path='admin/whitelabel-statement/csv' period={period} fileName={`revenue-share-${month}.csv`} />
          </div>
        }
      />
      <Card>
        <CardContent className='pt-6'>
          {report.isLoading ? (
            <p className='text-muted-foreground text-sm'>Loading…</p>
          ) : report.data ? (
            <StatementView statement={report.data} who='company' />
          ) : (
            <p className='text-destructive text-sm'>{String((report.error as Error)?.message ?? 'Could not load the statement')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default CompanyStatement
