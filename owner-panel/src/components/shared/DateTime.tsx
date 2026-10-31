import { formatDate, relativeTime } from '@/lib/format'

const DateTime = ({ value, relative }: { value: string | number | Date | null | undefined; relative?: boolean }) => {
  if (!value) return <span className='text-muted-foreground'>—</span>

  return (
    <time dateTime={new Date(value).toISOString()} title={formatDate(value)} className='whitespace-nowrap tabular-nums'>
      {relative ? relativeTime(value) : formatDate(value)}
    </time>
  )
}

export default DateTime
