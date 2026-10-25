import NotFoundCard from '@/components/shared/NotFoundCard'

// Unknown URL outside the panel chrome (signed-out visitors are sent to /login by the proxy first).
const NotFound = () => (
  <div className='bg-background flex min-h-svh w-full items-center justify-center p-4'>
    <NotFoundCard />
  </div>
)

export default NotFound
