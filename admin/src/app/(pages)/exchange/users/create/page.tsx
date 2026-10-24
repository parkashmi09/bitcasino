import { Suspense } from 'react'

import CreateAccount from '@/views/exchange/accounts/CreateAccount'

export const metadata = { title: 'Create Account' }

export default function Page() {
  return (
    <Suspense>
      <CreateAccount />
    </Suspense>
  )
}
