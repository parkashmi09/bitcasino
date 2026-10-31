import type { ReactNode } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Props = {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  loading?: boolean
  className?: string
}

/**
 * One number, ccpayment's stat card: 14px secondary label, the 24px semibold number, the hint in
 * muted print, and the icon in a soft primary tile on the right.
 */
const StatCard = ({ label, value, hint, icon, loading, className }: Props) => (
  <Card className={cn('gap-0 py-0', className)}>
    <CardContent className='flex flex-1 items-center justify-between gap-3 p-6'>
      <div className='min-w-0'>
        <p className='text-muted-foreground text-sm font-medium'>{label}</p>
        {loading ? (
          <Skeleton className='mt-2 h-9 w-24' />
        ) : (
          <p className='text-heading mt-2 truncate text-2xl font-semibold tabular-nums motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-500'>
            {value}
          </p>
        )}
        {hint && <p className='text-muted-foreground mt-1.5 text-[13px]'>{hint}</p>}
      </div>
      {icon && <div className='bg-accent text-primary flex size-12 shrink-0 items-center justify-center rounded-xl [&_svg]:size-6'>{icon}</div>}
    </CardContent>
  </Card>
)

export default StatCard
