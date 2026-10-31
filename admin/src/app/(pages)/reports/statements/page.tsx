import { Suspense } from 'react'

import Statements from '@/views/reports/Statements'

export const metadata = { title: 'Statements' }

export default function Page() {
  return (
    <Suspense>
      <Statements />
    </Suspense>
  )
}
