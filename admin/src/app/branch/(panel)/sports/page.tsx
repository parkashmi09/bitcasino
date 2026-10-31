import { Suspense } from 'react'

import { PanelBets } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Sports' }

export default function Page() {
  return (
    <Suspense>
      <PanelBets kind='sports' />
    </Suspense>
  )
}
