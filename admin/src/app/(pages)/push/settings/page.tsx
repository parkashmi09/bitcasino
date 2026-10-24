import { Suspense } from 'react'

import View from '@/views/push/PushSettings'

export const metadata = { title: 'Push prompt & settings' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
