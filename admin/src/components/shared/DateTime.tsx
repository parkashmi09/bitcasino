import { formatDate, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const DateTime = ({ value, relative }: { value: string | number | Date | null | undefined; relative?: boolean }) => {
  if (!value) return <span className='text-muted-foreground'>—</span>

  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={formatDate(value)}
      className={cn('whitespace-nowrap tabular-nums', relative && 'text-muted-foreground')}
    >
      {relative ? relativeTime(value) : formatDate(value)}
    </time>
  )
}

export default DateTime
