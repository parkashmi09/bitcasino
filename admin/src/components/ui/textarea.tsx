import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot='textarea'
      className={cn(
        'border-input placeholder:text-(--input-placeholder) hover:border-foreground focus-visible:border-foreground aria-invalid:border-destructive aria-invalid:hover:border-destructive bg-transparent text-foreground rounded-lg border transition-[border-color] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none motion-reduce:transition-none flex field-sizing-content min-h-16 w-full px-3.5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
