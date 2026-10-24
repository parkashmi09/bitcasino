import type { ReactNode } from 'react'

import BlankLayout from '@/components/layout/BlankLayout'

const PublicLayout = ({ children }: { children: ReactNode }) => <BlankLayout>{children}</BlankLayout>

export default PublicLayout
