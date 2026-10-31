import { Suspense } from 'react'

import GeneralLock from '@/views/exchange/settings/GeneralLock'

export const metadata = { title: 'General Lock' }

export default function Page() {
  return (
    <Suspense>
      <GeneralLock />
    </Suspense>
  )
}
