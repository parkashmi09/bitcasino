import { Suspense } from 'react'

import { PanelMoney } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Deposits' }

export default function Page() {
  return (
    <Suspense>
      <PanelMoney kind='deposits' />
    </Suspense>
  )
}
