import { Suspense } from 'react'

import AccountList from '@/views/exchange/AccountList'

export const metadata = { title: 'Account List' }

export default function Page() {
  return (
    <Suspense>
      <AccountList />
    </Suspense>
  )
}
