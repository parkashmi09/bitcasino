import { Suspense } from 'react'

import WhitelabelsReport from '@/views/whitelabels/WhitelabelsReport'

export const metadata = { title: 'Revenue share report' }

// The report reads `?id=` (useSearchParams), which needs a Suspense boundary to build.
export default function Page() {
  return (
    <Suspense>
      <WhitelabelsReport />
    </Suspense>
  )
}
