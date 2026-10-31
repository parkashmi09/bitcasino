// React Imports
import type { ReactNode } from 'react'

// Component Imports
import BlankLayout from '@/components/layout/BlankLayout'

const PublicLayout = ({ children }: { children: ReactNode }) => {
  return <BlankLayout>{children}</BlankLayout>
}

export default PublicLayout
