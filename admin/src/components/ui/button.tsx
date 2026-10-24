import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold capitalize whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none motion-reduce:transition-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // ccpayment contained primary: hover is primary.dark (#1E3EB0), mixed from --primary so no new hex.
        default: 'bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),black_30%)]',

        // ccpayment outlined (inherit): grey 32% border, ink border + 8% grey wash on hover.
        outline:
          'border-muted-foreground/32 bg-transparent text-foreground hover:border-foreground hover:bg-muted-foreground/8 aria-expanded:bg-muted-foreground/8',

        // ccpayment soft: grey 16% wash.
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-muted-foreground/16 aria-expanded:bg-muted-foreground/16',
        ghost: 'hover:bg-muted-foreground/8 aria-expanded:bg-muted-foreground/8',
        destructive:
          'bg-destructive text-white hover:bg-[color-mix(in_oklch,var(--destructive),black_12%)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default:
          'h-9 gap-1.5 px-4 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1 px-3 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
        lg: 'h-10 gap-1.5 px-5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-9',
        'icon-xs':
          "size-6 in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 in-data-[slot=button-group]:rounded-md',
        'icon-lg': 'size-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot='button' className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
