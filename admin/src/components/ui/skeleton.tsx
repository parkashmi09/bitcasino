import MuiSkeleton from '@mui/material/Skeleton'

import { cn } from '@/lib/utils'

// MUI rounded skeleton with the wave sweep; size still comes from the caller's className.
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <MuiSkeleton
      component='div'
      variant='rounded'
      animation='wave'
      data-slot='skeleton'
      className={cn('rounded-lg', className)}
      {...props}
    />
  )
}

export { Skeleton }
