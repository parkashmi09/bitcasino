import { Suspense } from 'react'

import Transactions from '@/views/transactions/Transactions'

export const metadata = { title: 'Withdraw' }

export default function Page() {
  return (
    <Suspense>
      <Transactions direction='withdraw' />
    </Suspense>
  )
}
