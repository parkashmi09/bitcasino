import { Suspense } from 'react'

import PageHeader from '@/components/shared/PageHeader'
import ExchangeDashboard from '@/views/exchange/ExchangeDashboard'

export const metadata = { title: 'Agent Dashboard' }

/** Agent Management ka apna Dashboard — sirf agent system (points / P&L), direct users nahi. */
export default function Page() {
  return (
    <Suspense>
      <PageHeader title='Agent Dashboard' />
      <ExchangeDashboard />
    </Suspense>
  )
}
