import { Suspense } from 'react'

import { PanelBets } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Originals' }

export default function Page() {
  return (
    <Suspense>
      <PanelBets kind='originals' />
    </Suspense>
  )
}
