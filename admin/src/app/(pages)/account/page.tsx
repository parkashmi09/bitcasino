import { Suspense } from 'react'

import AccountPage from '@/views/account/AccountPage'

export const metadata = { title: 'My account' }

export default function Page() {
  return (
    <Suspense>
      <AccountPage />
    </Suspense>
  )
}
