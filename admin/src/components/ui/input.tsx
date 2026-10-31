import * as React from 'react'

import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '@/lib/utils'

function Input({ className, type, autoComplete = 'off', ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}

      // stop the browser dropping saved logins/history into search and filter boxes; login fields pass their own
      autoComplete={autoComplete}
      data-slot='input'
      className={cn(
        'border-input placeholder:text-(--input-placeholder) hover:border-foreground focus-visible:border-foreground aria-invalid:border-destructive aria-invalid:hover:border-destructive bg-transparent text-foreground rounded-lg border transition-[border-color] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none motion-reduce:transition-none file:text-foreground h-10 w-full min-w-0 px-3.5 py-2 text-sm file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Input }
