import { Suspense } from 'react'

import TurnoverReport from '@/views/turnover/TurnoverReport'

export const metadata = { title: 'Turnover Report' }

export default function Page() {
  return (
    <Suspense>
      <TurnoverReport />
    </Suspense>
  )
}
