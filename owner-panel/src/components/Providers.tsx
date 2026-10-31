'use client'

// React Imports
import { useState, type ReactNode } from 'react'

// Third-party Imports
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Component Imports
import { ThemeProvider } from './ThemeProvider'
import { SidebarProvider } from './ui/sidebar'
import { TooltipProvider } from './ui/tooltip'
import { SessionProvider } from '@/contexts/SessionContext'

type Props = {
  children: ReactNode
  sidebarDefaultOpen?: boolean
}

const Providers = ({ children, sidebarDefaultOpen }: Props) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 }
        }
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider attribute='class' defaultTheme='dark' enableSystem={false}>
          <TooltipProvider>
            <SidebarProvider defaultOpen={sidebarDefaultOpen}>{children}</SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}

export default Providers
