'use client'

// React Imports
import { Suspense } from 'react'
import type { ReactNode } from 'react'

// Component Imports
import Footer from '@/components/layout/Footer'
import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import RouteGate from '@/components/shared/RouteGate'
import { SidebarInset } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'

// Context Imports
import { useSession } from '@/contexts/SessionContext'

const PagesLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
  const { actor } = useSession()

  return (
    <div className='flex h-full w-full min-w-0'>
      <Suspense>
        <Sidebar />
      </Suspense>
      <SidebarInset className='flex min-w-0 flex-1 flex-col'>
        <Header />
        {actor?.readOnly && (
          <div role='status' className='border-warning bg-warning-soft border-b px-4 py-2 text-center text-sm font-medium'>
            Read-only preview: you can look at everything here, but nothing can be changed.
          </div>
        )}
        <main className='mx-auto size-full flex-1 px-4 py-6 sm:px-6'>
          <RouteGate>{children}</RouteGate>
        </main>
        <Toaster />
        <RealtimeRefresh />
        <Footer />
      </SidebarInset>
    </div>
  )
}

export default PagesLayout
