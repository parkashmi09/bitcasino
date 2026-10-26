import { Suspense } from 'react'

import { PanelBets } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Casino' }

export default function Page() {
  return (
    <Suspense>
      <PanelBets kind='casino' />
    </Suspense>
  )
}
