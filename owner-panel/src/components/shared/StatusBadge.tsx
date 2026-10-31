import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TONES: Record<string, string> = {
  active: 'bg-green-500/15 text-green-700 dark:text-green-400',
  approved: 'bg-green-500/15 text-green-700 dark:text-green-400',
  completed: 'bg-green-500/15 text-green-700 dark:text-green-400',
  settled: 'bg-green-500/15 text-green-700 dark:text-green-400',
  won: 'bg-green-500/15 text-green-700 dark:text-green-400',
  verified: 'bg-green-500/15 text-green-700 dark:text-green-400',
  published: 'bg-green-500/15 text-green-700 dark:text-green-400',
  enabled: 'bg-green-500/15 text-green-700 dark:text-green-400',
  entitled: 'bg-green-500/15 text-green-700 dark:text-green-400',
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  processing: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  open: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  submitted: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  suspended: 'bg-red-500/15 text-red-700 dark:text-red-400',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-400',
  cancelled: 'bg-red-500/15 text-red-700 dark:text-red-400',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  lost: 'bg-red-500/15 text-red-700 dark:text-red-400',
  locked: 'bg-red-500/15 text-red-700 dark:text-red-400',
  closed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  disabled: 'bg-red-500/15 text-red-700 dark:text-red-400',
  blocked: 'bg-red-500/15 text-red-700 dark:text-red-400',
  void: 'bg-muted text-muted-foreground',
  inactive: 'bg-muted text-muted-foreground',
  draft: 'bg-muted text-muted-foreground'
}

const StatusBadge = ({ value, className }: { value: string | boolean | null | undefined; className?: string }) => {
  if (value === null || value === undefined || value === '') return <span className='text-muted-foreground'>—</span>
  const text = typeof value === 'boolean' ? (value ? 'enabled' : 'disabled') : String(value)
  const tone = TONES[text.toLowerCase()] ?? 'bg-secondary text-secondary-foreground'

  return (
    <Badge variant='outline' className={cn('border-transparent font-medium capitalize', tone, className)}>
      {text.replace(/[_-]+/g, ' ')}
    </Badge>
  )
}

export default StatusBadge
