'use client'

// React Imports
import { useState, type ReactNode } from 'react'

// Third-party Imports
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

// Component Imports
import { ThemeProvider } from './ThemeProvider'
import { SidebarProvider } from './ui/sidebar'
import { TooltipProvider } from './ui/tooltip'
import { SessionProvider } from '@/contexts/SessionContext'
import { ApiError, errorMessage } from '@/lib/api/client'
import MuiProvider from '@/theme/MuiProvider'

type Props = {
  children: ReactNode
  sidebarDefaultOpen?: boolean
}

const Providers = ({ children, sidebarDefaultOpen }: Props) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // A REFRESH that fails while old data is still on screen would otherwise be silent (the
        // first load shows an ErrorState in the page) — say so once per query.
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (query.state.data === undefined) return
            toast.error(`Could not refresh: ${errorMessage(error)}`, { id: `q-${query.queryHash}` })
          }
        }),
        defaultOptions: {
          queries: {
            // A 4xx (403 forbidden, 404, 422) answers the same on a second try — retrying only doubled every refused request.
            retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
            refetchOnWindowFocus: false,
            staleTime: 10_000
          }
        }
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        {/* Own storage key: a `light` saved under next-themes' shared `theme` key no longer overrides the dark default. */}
        <ThemeProvider attribute='class' defaultTheme='dark' enableSystem={false} storageKey='admin-theme-v2'>
          <MuiProvider>
            <TooltipProvider>
              <SidebarProvider defaultOpen={sidebarDefaultOpen}>{children}</SidebarProvider>
            </TooltipProvider>
          </MuiProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}

export default Providers
