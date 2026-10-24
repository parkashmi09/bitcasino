import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot='textarea'
      className={cn(
        'border-input placeholder:text-muted-foreground hover:border-foreground focus-visible:border-foreground focus-visible:shadow-[inset_0_0_0_1px_var(--foreground)] aria-invalid:border-destructive aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] flex field-sizing-content min-h-16 w-full bg-card rounded-lg border px-3.5 py-2 text-base transition-[color,border-color,box-shadow] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
