import { Suspense } from 'react'

import View from '@/views/settings/ProvidersPriority'

export const metadata = { title: 'Providers Priority' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
