// Config Imports
import themeConfig from '@/configs/themeConfig'

// Component Imports
import BrandMark from '@/components/shared/BrandMark'

// Util Imports
import { cn } from '@/lib/utils'

const Logo = ({ className }: { className?: string }) => {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className='text-foreground text-lg font-medium tracking-tight'>{themeConfig.templateName}</span>
    </div>
  )
}

export default Logo
