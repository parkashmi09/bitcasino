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
 * One number, Luno's stat card: CAPS label with the icon top-right, the big
 * number, the hint in muted print, and a teal strip along the bottom edge.
 *
 * The icon is a hint at what the number counts, so it is drawn plain (no chip):
 * on a screen of six tiles, six coloured squares read as six buttons.
 * The strip is decoration (always full), not a progress value.
 */
const StatCard = ({ label, value, hint, icon, loading, className }: Props) => (
  <Card className={cn('gap-0 py-0 shadow-none', className)}>
    <CardContent className='flex flex-1 items-start justify-between gap-3 px-5 pt-5 pb-4'>
      <div className='min-w-0'>
        <p className='text-muted-foreground text-xs tracking-wide uppercase'>{label}</p>
        {loading ? (
          <Skeleton className='mt-2 h-8 w-24' />
        ) : (
          <p className='text-heading mt-1.5 truncate text-2xl font-medium tabular-nums motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-500'>
            {value}
          </p>
        )}
        {hint && <p className='text-muted-foreground mt-1 text-xs'>{hint}</p>}
      </div>
      {icon && <div className='text-foreground/80 shrink-0 [&_svg]:size-6'>{icon}</div>}
    </CardContent>
    <div aria-hidden className='bg-muted h-1 overflow-hidden'>
      <div className='bg-brand-secondary h-full motion-safe:animate-in motion-safe:slide-in-from-left-full motion-safe:duration-600' />
    </div>
  </Card>
)

export default StatCard
