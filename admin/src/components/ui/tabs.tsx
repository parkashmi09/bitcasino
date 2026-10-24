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

// MUI Tabs look: text tabs on a transparent strip, the active one marked by a sliding 2px primary underline.
const tabsListVariants = cva(
  'group/tabs-list text-muted-foreground relative inline-flex w-fit items-center justify-center group-data-horizontal/tabs:h-auto group-data-horizontal/tabs:min-h-12 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        line: 'gap-1 bg-transparent'
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
      <TabsPrimitive.Indicator className='border-primary pointer-events-none absolute top-(--active-tab-top) left-(--active-tab-left) h-(--active-tab-height) w-(--active-tab-width) transition-[left,top,width,height] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none group-data-horizontal/tabs:border-b-2 group-data-vertical/tabs:border-r-2' />
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot='tabs-trigger'
      className={cn(
        "text-muted-foreground not-data-active:hover:text-foreground focus-visible:bg-[rgb(113_117_126/8%)] data-active:text-primary relative inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 px-4 py-3 text-sm leading-[1.5] font-semibold whitespace-nowrap transition-colors duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none motion-reduce:transition-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
