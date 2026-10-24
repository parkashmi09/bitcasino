import { Suspense } from 'react'

import View from '@/views/content/Blogs'

export const metadata = { title: 'Blogs' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
