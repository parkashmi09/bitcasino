// Next Imports
import Link from 'next/link'

// Component Imports
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Page not found' }

// Signed-out visitors never get here: proxy.ts sends every unknown path to /login first,
// and /overview itself bounces to /login if the session has since expired.
const NotFound = () => {
  return (
    <main className='bg-background text-foreground flex min-h-screen w-full flex-col items-center justify-center gap-6 p-6 text-center'>
      <p className='text-primary text-7xl font-bold tracking-tight sm:text-8xl'>404</p>
      <div className='flex flex-col gap-2'>
        <h1 className='text-2xl font-semibold'>Page not found</h1>
        <p className='text-muted-foreground'>This page does not exist or has moved.</p>
      </div>
      <Button render={<Link href='/overview' />} nativeButton={false}>
        Back to overview
      </Button>
    </main>
  )
}

export default NotFound
