import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

const Money = ({
  value,
  currency,
  signed,
  className
}: {
  value: string | number | null | undefined
  currency?: string | null
  signed?: boolean
  className?: string
}) => {
  const n = value === null || value === undefined ? NaN : Number(value)
  const tone = signed && Number.isFinite(n) ? (n > 0 ? 'text-green-600 dark:text-green-400' : n < 0 ? 'text-red-600 dark:text-red-400' : '') : ''

  return (
    <span className={cn('font-mono tabular-nums', tone, className)}>
      {signed && Number.isFinite(n) && n > 0 ? '+' : ''}
      {formatMoney(value, currency ?? undefined)}
    </span>
  )
}

export default Money
