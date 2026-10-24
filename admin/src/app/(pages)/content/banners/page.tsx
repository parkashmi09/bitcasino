import { Suspense } from 'react'

import View from '@/views/content/Banners'

export const metadata = { title: 'Banners' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
