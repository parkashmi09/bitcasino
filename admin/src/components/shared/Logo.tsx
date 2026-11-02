// Component Imports
import BrandMark, { BrandName } from '@/components/shared/BrandMark'

// Util Imports
import { cn } from '@/lib/utils'

const Logo = ({ className }: { className?: string }) => {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className='text-foreground text-lg font-semibold'>
        <BrandName />
      </span>
    </div>
  )
}

export default Logo
