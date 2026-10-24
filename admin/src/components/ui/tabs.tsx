'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot='tabs'
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  )
}

// ccpayment's tabs (its MUI theme follows Minimal UI): bare text tabs 40px apart (24px on phones) over a hairline
// divider, the active one in ink with a sliding 2px ink underline.
const tabsListVariants = cva(
  'group/tabs-list text-muted-foreground relative inline-flex w-fit items-center justify-start group-data-horizontal/tabs:h-auto group-data-horizontal/tabs:min-h-12 group-data-horizontal/tabs:gap-6 group-data-horizontal/tabs:shadow-[inset_0_-1px_0_0_var(--border)] sm:group-data-horizontal/tabs:gap-10 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        line: 'bg-transparent'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function TabsList({
  className,
  variant = 'default',
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot='tabs-list'
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      {/* Box over the active tab (works when the list wraps); its bottom/right border is the indicator. */}
      <TabsPrimitive.Indicator className='border-heading pointer-events-none absolute top-(--active-tab-top) left-(--active-tab-left) h-(--active-tab-height) w-(--active-tab-width) transition-[left,top,width,height] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none group-data-horizontal/tabs:border-b-2 group-data-vertical/tabs:border-r-2' />
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot='tabs-trigger'
      className={cn(
        "text-muted-foreground not-data-active:hover:text-foreground focus-visible:bg-[rgb(113_117_126/8%)] data-active:text-heading relative inline-flex min-h-12 min-w-12 flex-none items-center justify-center gap-2 px-0 py-3 text-sm leading-[1.5] font-semibold whitespace-nowrap group-data-vertical/tabs:px-4 transition-colors duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none motion-reduce:transition-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel data-slot='tabs-content' className={cn('flex-1 text-sm outline-none', className)} {...props} />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
