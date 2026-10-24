import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

const Money = ({
  value,
  currency,
  signed,
  digits,
  className
}: {
  value: string | number | null | undefined
  currency?: string | null
  signed?: boolean

  /** Fixed fraction digits; by default whole numbers under 1,000 print without decimals. */
  digits?: number
  className?: string
}) => {
  const n = value === null || value === undefined ? NaN : Number(value)
  const tone = signed && Number.isFinite(n) ? (n > 0 ? 'text-success' : n < 0 ? 'text-danger' : '') : ''

  return (
    <span className={cn('whitespace-nowrap tabular-nums', tone, className)}>
      {signed && Number.isFinite(n) && n > 0 ? '+' : ''}
      {formatMoney(value, undefined, { digits, of: currency })}
      {currency && (
        <>
          {' '}
          <span className='text-muted-foreground text-[0.9em] font-normal'>{currency}</span>
        </>
      )}
    </span>
  )
}

export default Money
