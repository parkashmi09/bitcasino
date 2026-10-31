import { Suspense } from 'react'

import View from '@/views/push/PushCampaigns'

export const metadata = { title: 'Push campaigns' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
