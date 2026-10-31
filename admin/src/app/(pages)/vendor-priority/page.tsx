import { Suspense } from 'react'

import View from '@/views/settings/VendorPriority'

export const metadata = { title: 'Vendor Priority' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
