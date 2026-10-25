'use client'

import Link from 'next/link'

import { LunoHouse } from '@/components/icons/luno'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useSession } from '@/contexts/SessionContext'
import { useHomeHref } from '@/hooks/use-nav-visible'

/** The 404 screen: inside the panel chrome when signed in, on its own otherwise. */
const NotFoundCard = () => {
  const { actor, loading } = useSession()
  const home = useHomeHref()
  const signedOut = !actor && !loading

  return (
    <div className='animate-page-in flex min-h-[60svh] items-center justify-center'>
      <Card className='w-full max-w-md text-center'>
        <CardContent className='flex flex-col items-center gap-3 py-4'>
          <p className='text-primary text-6xl font-extrabold tracking-tight sm:text-7xl'>404</p>
          <h1 className='text-heading text-xl font-semibold'>Page not found</h1>
          <p className='text-muted-foreground text-sm'>The page you are looking for does not exist or has moved.</p>
          <Button className='mt-3' render={<Link href={signedOut ? '/login' : home} />} nativeButton={false}>
            <LunoHouse />
            {signedOut ? 'Back to sign in' : 'Back to dashboard'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default NotFoundCard
