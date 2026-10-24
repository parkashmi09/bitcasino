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

const StatCard = ({ label, value, hint, icon, loading, className }: Props) => (
  <Card className={cn('py-4 shadow-none', className)}>
    <CardContent className='flex items-start justify-between gap-3 px-4'>
      <div className='min-w-0'>
        <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>{label}</p>
        {loading ? <Skeleton className='mt-2 h-7 w-24' /> : <p className='mt-1 truncate text-2xl font-semibold tabular-nums'>{value}</p>}
        {hint && <p className='text-muted-foreground mt-1 text-xs'>{hint}</p>}
      </div>
      {icon && <div className='bg-primary/10 text-primary rounded-md p-2 [&_svg]:size-5'>{icon}</div>}
    </CardContent>
  </Card>
)

export default StatCard
