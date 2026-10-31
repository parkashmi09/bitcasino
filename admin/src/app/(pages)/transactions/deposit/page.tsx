import { Suspense } from 'react'

import Transactions from '@/views/transactions/Transactions'

export const metadata = { title: 'Deposit' }

export default function Page() {
  return (
    <Suspense>
      <Transactions direction='deposit' />
    </Suspense>
  )
}
