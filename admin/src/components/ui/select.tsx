'use client'

import * as React from 'react'

import { Select as SelectPrimitive } from '@base-ui/react/select'

import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type SelectItemEntry = { value: unknown; label: React.ReactNode }

/**
 * Walk the JSX passed to <Select> and collect every <SelectItem value>label</SelectItem>.
 * Base UI's <Select.Value> only shows an item's label when the Root is given `items`;
 * without them the trigger shows the raw value ("all", "user"). Collecting them here means
 * every select shows its labels without each screen repeating the option list.
 * Items rendered inside other components can't be seen — pass `items` (or a SelectValue
 * render function) for those.
 */
function collectItems(node: React.ReactNode, out: SelectItemEntry[] = []): SelectItemEntry[] {
  React.Children.forEach(node, child => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: unknown; children?: React.ReactNode }

    if (child.type === SelectItem) {
      if (props.children != null && typeof props.children !== 'function') out.push({ value: props.value, label: props.children })

      return
    }

    if (props.children !== undefined && typeof props.children !== 'function') collectItems(props.children, out)
  })

  return out
}

function Select<Value, Multiple extends boolean | undefined = false>({ items, children, ...props }: SelectPrimitive.Root.Props<Value, Multiple>) {
  const collected = React.useMemo(() => (items === undefined ? collectItems(children) : undefined), [items, children])

  return (
    <SelectPrimitive.Root<Value, Multiple> items={items ?? (collected?.length ? collected : undefined)} {...props}>
      {children}
    </SelectPrimitive.Root>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot='select-group' className={cn('scroll-my-1 p-1', className)} {...props} />
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value data-slot='select-value' className={cn('flex flex-1 text-left', className)} {...props} />
  )
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot='select-trigger'
      data-size={size}
      className={cn(
        "border-input data-placeholder:text-(--input-placeholder) hover:border-foreground focus-visible:border-foreground aria-invalid:border-destructive aria-invalid:hover:border-destructive bg-transparent text-foreground rounded-lg border transition-[border-color] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] outline-none motion-reduce:transition-none focus-visible:border-foreground data-popup-open:border-foreground flex w-fit items-center justify-between gap-1.5 py-2 pr-2.5 pl-3.5 text-sm whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-10 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDownIcon className='text-foreground pointer-events-none size-[18px]! transition-transform duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] in-data-popup-open:rotate-180' />} />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger'>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className='isolate z-50'
      >
        <SelectPrimitive.Popup
          data-slot='select-content'
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            'bg-popover text-popover-foreground motion-safe:data-open:animate-morph-in motion-safe:data-closed:animate-morph-out relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg p-1 shadow-[var(--shadow-dropdown)] data-[align-trigger=true]:animate-none',
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot='select-label'
      className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot='select-item'
      className={cn(
        "data-highlighted:bg-[rgb(113_117_126/8%)] focus:bg-[rgb(113_117_126/8%)] data-selected:bg-[rgb(113_117_126/16%)] data-selected:font-semibold relative mb-1 flex min-h-9 w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm last:mb-0 outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className='flex flex-1 shrink-0 gap-2 whitespace-nowrap'>
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot='select-separator'
      className={cn('bg-border pointer-events-none -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot='select-scroll-up-button'
      className={cn(
        "bg-popover top-0 z-10 flex w-full cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot='select-scroll-down-button'
      className={cn(
        "bg-popover bottom-0 z-10 flex w-full cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue
}
