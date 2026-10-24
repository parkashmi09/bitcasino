import { Suspense } from 'react'

import View from '@/views/push/PushTemplates'

export const metadata = { title: 'Push templates' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
