import { Suspense } from 'react'

import Bank from '@/views/exchange/Bank'

export const metadata = { title: 'Bank' }

export default function Page() {
  return (
    <Suspense>
      <Bank />
    </Suspense>
  )
}
