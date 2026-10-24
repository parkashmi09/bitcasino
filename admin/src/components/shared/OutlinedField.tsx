import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * MUI's outlined TextField frame (ccpayment's sign-in, measured live): the label rests inside the 56px field in
 * the disabled grey and, on focus or once filled, floats to the border at 75% in the secondary grey while the
 * outline opens a notch for it. Wraps the page's own <input> (give it `placeholder=' '` and `border-0`), so the
 * input keeps its handlers; this only draws the label and the outline.
 */
const FLOAT =
  'group-has-[input:focus]/of:-translate-y-[9px] group-has-[input:focus]/of:scale-75 group-has-[input:focus]/of:text-muted-foreground group-has-[input:not(:placeholder-shown)]/of:-translate-y-[9px] group-has-[input:not(:placeholder-shown)]/of:scale-75 group-has-[input:not(:placeholder-shown)]/of:text-muted-foreground group-has-[input:autofill]/of:-translate-y-[9px] group-has-[input:autofill]/of:scale-75'

const OPEN = 'group-has-[input:focus]/of:max-w-full group-has-[input:not(:placeholder-shown)]/of:max-w-full group-has-[input:autofill]/of:max-w-full'

const OutlinedField = ({ label, htmlFor, children, className }: { label: ReactNode; htmlFor: string; children: ReactNode; className?: string }) => (
  <div className={cn('group/of relative', className)}>
    {children}
    <label
      htmlFor={htmlFor}
      className={cn(
        'pointer-events-none absolute top-0 left-0 max-w-[calc(100%-24px)] origin-top-left translate-x-3.5 translate-y-4 truncate text-base leading-[23px] text-(--input-placeholder) transition-[color,transform] duration-200 ease-[cubic-bezier(0,0,0.2,1)] motion-reduce:transition-none',
        FLOAT
      )}
    >
      {label}
    </label>
    <fieldset
      aria-hidden
      className='border-input group-hover/of:border-foreground group-has-[input:focus]/of:border-foreground group-has-[[aria-invalid=true]]/of:border-destructive pointer-events-none absolute inset-x-0 -top-[5px] bottom-0 m-0 min-w-0 rounded-lg border px-2 transition-colors duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]'
    >
      <legend className={cn('invisible float-none block h-[11px] max-w-[0.01px] overflow-hidden p-0 text-xs whitespace-nowrap transition-[max-width] duration-100', OPEN)}>
        <span className='visible inline-block px-[5px] opacity-0'>{label}</span>
      </legend>
    </fieldset>
  </div>
)

export default OutlinedField
