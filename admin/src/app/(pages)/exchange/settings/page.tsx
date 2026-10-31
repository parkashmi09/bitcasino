import { Suspense } from 'react'

import GlobalSettings from '@/views/exchange/settings/GlobalSettings'

export const metadata = { title: 'Global Settings' }

export default function Page() {
  return (
    <Suspense>
      <GlobalSettings />
    </Suspense>
  )
}
