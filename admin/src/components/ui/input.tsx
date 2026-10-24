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
        'border-input file:text-foreground placeholder:text-muted-foreground hover:border-foreground focus-visible:border-foreground focus-visible:shadow-[inset_0_0_0_1px_var(--foreground)] aria-invalid:border-destructive aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] bg-card h-9 w-full min-w-0 rounded-lg border px-3.5 py-1 text-base transition-[color,border-color,box-shadow] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none motion-reduce:transition-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Input }
