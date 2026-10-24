import { Suspense } from 'react'

import ExecutivesList from '@/views/access/ExecutivesList'

export const metadata = { title: 'Executives' }

export default function Page() {
  return (
    <Suspense>
      <ExecutivesList />
    </Suspense>
  )
}
