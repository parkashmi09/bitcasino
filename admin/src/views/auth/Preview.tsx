'use client'

// React Imports
import { useEffect, useRef, useState } from 'react'

// Next Imports
import { useSearchParams } from 'next/navigation'

// Third-party Imports
import { Loader2Icon } from 'lucide-react'

// Component Imports
import Logo from '@/components/shared/Logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// Lib Imports
import { errorMessage, request } from '@/lib/api/client'

/**
 * The parent site's Whitelabel "Preview": `/preview?code=` with a one-time code (valid about a
 * minute) becomes a READ-ONLY session as this site's company — every write answers
 * READ_ONLY_PREVIEW. Same cookie hand-off as the login screen.
 */
const Preview = () => {
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // The code works once: React's dev double-effect must not spend it twice.
    if (started.current) return
    started.current = true

    const open = async () => {
      try {
        const { data } = await request<{ token: string }>('/api/gw/api/v1/admin/whitelabel-link/preview/redeem', {
          raw: true,
          method: 'POST',
          body: { code: params.get('code') ?? '' }
        })

        await request('/api/auth/session', { raw: true, method: 'POST', body: { token: data.token } })

        // A full page load, as after sign-in (Login.tsx): the app starts with an empty query cache.
        window.location.assign('/dashboard')
      } catch (err) {
        setError(errorMessage(err))
      }
    }

    void open()
  }, [params])

  return (
    <div className='flex min-h-screen items-center justify-center px-4'>
      <Card className='w-full gap-6 py-6 sm:max-w-md'>
        <CardHeader className='px-6'>
          <Logo className='gap-3' />
        </CardHeader>
        <CardContent className='px-6'>
          {error ? (
            <Alert variant='destructive'>
              <AlertTitle>Preview did not open</AlertTitle>
              <AlertDescription>{error} Go back and press Preview again.</AlertDescription>
            </Alert>
          ) : (
            <p className='text-muted-foreground flex items-center gap-2 text-sm'>
              <Loader2Icon className='size-4 animate-spin' /> Opening a read-only preview…
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Preview
