import { Suspense } from 'react'

import { PanelStatement } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Statement' }

export default function Page() {
  return (
    <Suspense>
      <PanelStatement />
    </Suspense>
  )
}
