import { Suspense } from 'react'

import View from '@/views/content/Notifications'

export const metadata = { title: 'Notifications' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
