import { Suspense } from 'react'

import { PanelDashboard } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Branch' }

export default function Page() {
  return (
    <Suspense>
      <PanelDashboard />
    </Suspense>
  )
}
