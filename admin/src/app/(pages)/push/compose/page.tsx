import { Suspense } from 'react'

import View from '@/views/push/PushCompose'

export const metadata = { title: 'Compose push' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
