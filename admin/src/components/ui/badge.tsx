import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[6px] border border-transparent px-1.5 py-0.5 text-xs font-bold whitespace-nowrap transition-all duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:ring-[3px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        // ccpayment soft labels: the colour at 16% under its dark text tone (light mode) / light tone (dark mode).
        default:
          'bg-primary/16 text-[color-mix(in_oklch,var(--primary),black_30%)] dark:text-accent-foreground [a]:hover:bg-primary/24',
        secondary: 'bg-muted-foreground/16 text-secondary-foreground [a]:hover:bg-muted-foreground/24',
        destructive:
          'bg-danger-soft text-danger focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/24',
        outline: 'border-muted-foreground/32 text-foreground [a]:hover:bg-muted-foreground/8',
        ghost: 'hover:bg-muted-foreground/8',
        link: 'text-primary underline-offset-4 hover:underline'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className)
      },
      props
    ),
    render,
    state: {
      slot: 'badge',
      variant
    }
  })
}

export { Badge, badgeVariants }
