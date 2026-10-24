import { Suspense } from 'react'

import View from '@/views/finance/BankDetails'

export const metadata = { title: 'Bank details' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
