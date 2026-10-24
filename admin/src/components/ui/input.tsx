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
        'border-input file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 bg-card h-9 w-full min-w-0 rounded-[6px] border px-3 py-1 text-base transition-[color,border-color,box-shadow] duration-150 ease-in-out outline-none motion-reduce:transition-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Input }
