import { Suspense } from 'react'

import PlayerReports from '@/views/reports/PlayerReports'

export const metadata = { title: 'User reports' }

export default function Page() {
  return (
    <Suspense>
      <PlayerReports />
    </Suspense>
  )
}
