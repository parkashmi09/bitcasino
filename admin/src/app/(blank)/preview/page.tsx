import { Suspense } from 'react'

import Preview from '@/views/auth/Preview'

export const metadata = { title: 'Preview' }

const PreviewPage = () => (
  <Suspense>
    <Preview />
  </Suspense>
)

export default PreviewPage
