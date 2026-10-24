'use client'

// React Imports
import { type ComponentType, type MouseEvent } from 'react'

import { useCallback, useMemo, useState } from 'react'

// Next Imports
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

// Third-party Imports
import { ChevronRightIcon, SquareArrowOutUpRightIcon } from 'lucide-react'

// Type Imports
import {
  firstNavHref,
  navIcons,
  navItems,
  type MenuGroupSubItem,
  type MenuItem,
  type MenuLeafSubItem,
  type MenuSubItem,
  type NavItem
} from '@/configs/navConfig'

// Component Imports
import BrandMark from '@/components/shared/BrandMark'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar
} from '@/components/ui/sidebar'

// Config Imports
import themeConfig from '@/configs/themeConfig'
import { siteConfig } from '@/configs/site'
import { useSession } from '@/contexts/SessionContext'
import { useNavVisible } from '@/hooks/use-nav-visible'

// Util Imports
import { cn } from '@/lib/utils'

const isSubGroup = (item: MenuSubItem): item is MenuGroupSubItem => 'childItems' in item

// ── Shell styling (ccpayment console) ────────────────────────────────────────
// White (dark #1f2125) rail, 44px rows of 14px medium text with the icon, the current page a
// primary-ink pill on an 8% primary tint, 8px radius; groups collapse over 250ms.

const EASE = 'ease-[cubic-bezier(0.4,0,0.2,1)]'

// A top-level row: 44px, 20px icon, label, chevron.
const menuRowClass =
  'relative h-11 gap-3 rounded-lg px-3 text-[14px] font-medium text-muted-foreground transition-colors duration-250 not-data-active:hover:bg-[rgb(113_117_126/8%)]! not-data-active:hover:text-sidebar-foreground [&_svg]:size-5 group-data-[collapsible=icon]:justify-center'

const menuRowActiveClass =
  'data-active:bg-sidebar-accent! data-active:text-sidebar-accent-foreground data-active:font-semibold data-active:[&_svg]:text-sidebar-accent-foreground'

// A branch that holds the current page reads primary like ccpayment's open parent; an open one only darkens.
const menuRowBranchClass =
  'data-active:bg-sidebar-accent! data-active:text-sidebar-accent-foreground data-active:font-semibold group-data-open/collapsible:text-sidebar-foreground data-active:group-data-open/collapsible:text-sidebar-accent-foreground'

// The open submenu: children indented under the parent's icon.
const subMenuClass = 'relative mx-0 translate-x-0 gap-0.5 border-l-0 px-0 pt-0.5 pb-1 pl-6'

// Sub-rows: 36px, 14px; the current one gets the same primary pill, an open sub-group only darkens.
const subRowClass =
  'relative h-9 translate-x-0 justify-between overflow-visible rounded-lg px-3 text-[14px] text-muted-foreground transition-colors duration-250 not-data-active:hover:bg-[rgb(113_117_126/8%)] not-data-active:hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:font-semibold data-active:text-sidebar-accent-foreground [&>svg]:text-current'

const subBranchClass =
  'relative h-9 translate-x-0 justify-between rounded-lg px-3 text-[14px] text-muted-foreground transition-colors duration-250 hover:bg-[rgb(113_117_126/8%)] hover:text-sidebar-foreground data-active:bg-transparent! data-active:font-semibold data-active:text-sidebar-foreground [&>svg]:text-current'

// Sections are plain: no box, no rules between rows.
const sectionRowsClass = 'gap-1'

const collapseClass = `h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-250 ${EASE} data-ending-style:h-0 data-starting-style:h-0`

// Bottom shortcut row: real pages, shown only when the menu shows them to this session.
const SHORTCUT_HREFS = ['/transactions/deposit', '/transactions/withdraw', '/kyc', '/users']

// Counts are information, not decoration.
// top-3! re-centres the badge against the 44px row.
const badgeClass = 'bg-muted top-3! max-w-24 truncate rounded-full px-1.5 text-[11px] font-semibold tabular-nums'

const isExternalLink = (href: string) => href.startsWith('http://') || href.startsWith('https://')

// Key used to track the open state of a nested sub-group, namespaced by its parent
// so two sub-groups sharing a label in different parents never collide.
const subGroupKey = (itemLabel: string, subItemLabel: string) => `${itemLabel}::${subItemLabel}`

// Collapsible sidebar group (section) ka key — item labels se takraye nahi.
/** navIcons se icon (sub-item / section heading ke liye chhota). */
const NavIcon = ({ name, className }: { name?: keyof typeof navIcons; className?: string }) => {
  if (!name) return null
  const Tag = navIcons[name] as ComponentType<{ className?: string }>

  return <Tag className={cn('size-3.5! shrink-0 opacity-80', className)} />
}

const groupKey = (groupLabel: string) => `group::${groupLabel}`

function isLinkActive(
  href: string,
  activePath: string | undefined,
  pathname: string,
  searchParams: Pick<URLSearchParams, 'get'>
): boolean {
  if (activePath) {
    return pathname.startsWith(activePath)
  }

  if (href.includes('?')) {
    const [hrefPath, hrefQuery] = href.split('?')

    if (pathname !== hrefPath) return false

    const hrefParams = new URLSearchParams(hrefQuery)

    for (const [key, value] of hrefParams.entries()) {
      if (searchParams.get(key) !== value) return false
    }

    return true
  }

  return pathname === href
}

// Keys of every branch (top-level item, plus nested sub-group) that contains the active
// route. Branches the user has never toggled fall back to this, so the tree opens itself
// on first render and follows the route on every navigation.
function getActiveBranchKeys(
  groups: NavItem[],
  pathname: string,
  searchParams: Pick<URLSearchParams, 'get'>
): Set<string> {
  const keys = new Set<string>()

  groups.forEach(group => {
    const before = keys.size
    let leafHit = false

    group.items.forEach(item => {
      item.childItems?.forEach(subItem => {
        if (isSubGroup(subItem)) {
          if (subItem.childItems.some(leaf => isLinkActive(leaf.href, leaf.activePath, pathname, searchParams))) {
            keys.add(item.label)
            keys.add(subGroupKey(item.label, subItem.label))
          }
        } else if (isLinkActive(subItem.href, subItem.activePath, pathname, searchParams)) {
          keys.add(item.label)
        }
      })

      if (!item.childItems && isLinkActive(item.href, undefined, pathname, searchParams)) leafHit = true
    })

    // Group ke andar ka page khula hai to group bhi khula rahe.
    if (group.groupLabel && (leafHit || keys.size > before)) keys.add(groupKey(group.groupLabel))
  })

  return keys
}

// A single navigable link inside the icon-mode flyout, at either nesting level.
const FlyoutMenuLink = ({ item, isActive }: { item: MenuLeafSubItem; isActive: boolean }) => (
  <DropdownMenuItem
    className={cn('justify-between gap-2', isActive && 'bg-accent text-accent-foreground font-medium')}
    render={<Link href={item.href} target={item.target} />}
  >
    <span className='truncate'>{item.label}</span>
    <div className='flex items-center gap-2'>
      {item.badge && (
        <span className={cn('bg-muted ml-auto rounded-full px-1.5 text-xs font-normal', item.badgeClassName)}>
          {item.badge}
        </span>
      )}
      {isExternalLink(item.href) && <SquareArrowOutUpRightIcon className='ml-auto size-3.5 shrink-0 opacity-50' />}
    </div>
  </DropdownMenuItem>
)

// Icon-mode stand-in for a collapsible menu item. The rail is too narrow to show the
// inline sub-menu, so the children open in a dropdown to the right of the rail — with
// nested sub-groups rendered as submenus so every leaf stays reachable.
const FlyoutMenuItem = ({
  item,
  childItems,
  isChildActive,
  pathname,
  searchParams
}: {
  item: MenuItem
  childItems: MenuSubItem[]
  isChildActive: boolean
  pathname: string
  searchParams: Pick<URLSearchParams, 'get'>
}) => {
  const Tag = item.icon ? (navIcons[item.icon] as ComponentType) : null

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuButton isActive={isChildActive} className={cn(menuRowClass, menuRowActiveClass)} />}
        >
          {Tag && <Tag />}
          <span className='min-w-0 flex-1 truncate'>{item.label}</span>
          <ChevronRightIcon className='ml-auto' />
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start' sideOffset={12} className='w-auto min-w-52'>
          {/* The label must live inside a Group — Base UI's GroupLabel throws without one. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className='text-foreground flex items-center gap-2 text-sm'>
              <span className='truncate'>{item.label}</span>
              {item.badge && (
                <span className={cn('bg-muted rounded-full px-1.5 text-xs font-normal', item.badgeClassName)}>
                  {item.badge}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {childItems.map(subItem =>
              isSubGroup(subItem) ? (
                <DropdownMenuSub key={subItem.label}>
                  <DropdownMenuSubTrigger
                    className={cn(
                      subItem.childItems.some(leaf =>
                        isLinkActive(leaf.href, leaf.activePath, pathname, searchParams)
                      ) && 'bg-accent text-accent-foreground font-medium'
                    )}
                  >
                    <span className='truncate'>{subItem.label}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent sideOffset={9} className='w-auto min-w-48'>
                    {subItem.childItems.map(leaf => (
                      <FlyoutMenuLink
                        key={leaf.label}
                        item={leaf}
                        isActive={isLinkActive(leaf.href, leaf.activePath, pathname, searchParams)}
                      />
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <FlyoutMenuLink
                  key={subItem.label}
                  item={subItem}
                  isActive={isLinkActive(subItem.href, subItem.activePath, pathname, searchParams)}
                />
              )
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

const SidebarGroupedMenuItems = ({
  data,
  groupLabel,
  collapsible,
  pathname,
  searchParams,
  isIconMode,
  isBranchOpen,
  setOpenItem
}: {
  data: MenuItem[]
  groupLabel?: string
  groupIcon?: keyof typeof navIcons
  collapsible?: boolean
  pathname: string
  searchParams: Pick<URLSearchParams, 'get'>
  isIconMode: boolean
  isBranchOpen: (key: string) => boolean
  setOpenItem: (key: string, open: boolean) => void
}) => {
  const menu = (
    <SidebarGroupContent>
      <SidebarMenu className={sectionRowsClass}>
        {data.map(item => {
          const Tag = item.icon ? (navIcons[item.icon] as ComponentType) : null

          const isChildActive =
            item.childItems?.some(subItem =>
              isSubGroup(subItem)
                ? subItem.childItems.some(leaf => isLinkActive(leaf.href, leaf.activePath, pathname, searchParams))
                : isLinkActive(subItem.href, subItem.activePath, pathname, searchParams)
            ) ?? false

          if (item.childItems && isIconMode) {
            return (
              <FlyoutMenuItem
                key={item.label}
                item={item}
                childItems={item.childItems}
                isChildActive={isChildActive}
                pathname={pathname}
                searchParams={searchParams}
              />
            )
          }

          return item.childItems ? (
            <Collapsible
              className='group/collapsible'
              key={item.label}
              open={isBranchOpen(item.label)}
              onOpenChange={open => setOpenItem(item.label, open)}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={isChildActive}
                      className={cn(menuRowClass, menuRowBranchClass)}
                    />
                  }
                >
                  {Tag && <Tag />}
                  <span className={cn('min-w-0 flex-1 truncate', item.badge && 'pr-14')}>{item.label}</span>
                  {item.badge && (
                    <SidebarMenuBadge className={cn(badgeClass, item.badgeClassName)}>{item.badge}</SidebarMenuBadge>
                  )}
                  <ChevronRightIcon className='text-muted-foreground ml-auto size-3.5! transition-transform duration-250 group-data-open/collapsible:rotate-90' />
                </CollapsibleTrigger>
                <CollapsibleContent className={collapseClass}>
                  <SidebarMenuSub className={subMenuClass}>
                    {item.childItems.map(subItem =>
                      isSubGroup(subItem) ? (
                        <Collapsible
                          className='group/subcollapsible'
                          key={subItem.label}
                          open={isBranchOpen(subGroupKey(item.label, subItem.label))}
                          onOpenChange={open => setOpenItem(subGroupKey(item.label, subItem.label), open)}
                        >
                          <SidebarMenuSubItem>
                            <CollapsibleTrigger
                              nativeButton={false}
                              render={
                                <SidebarMenuSubButton
                                  className={subBranchClass}
                                  isActive={subItem.childItems.some(leaf =>
                                    isLinkActive(leaf.href, leaf.activePath, pathname, searchParams)
                                  )}
                                />
                              }
                            >
                              <NavIcon name={subItem.icon} />
                              {subItem.label}
                              <ChevronRightIcon className='text-muted-foreground ml-auto size-3.5! shrink-0 transition-transform duration-250 group-data-open/subcollapsible:rotate-90' />
                            </CollapsibleTrigger>
                            <CollapsibleContent className={collapseClass}>
                              <SidebarMenuSub className={cn(subMenuClass, 'pb-1')}>
                                {subItem.childItems.map(leaf => (
                                  <SidebarMenuSubItem key={leaf.label}>
                                    <SidebarMenuSubButton
                                      className={subRowClass}
                                      render={<Link href={leaf.href} target={leaf.target} />}
                                      isActive={isLinkActive(leaf.href, leaf.activePath, pathname, searchParams)}
                                    >
                                      <NavIcon name={leaf.icon} />
                                      <span
                                        className={cn(
                                          'min-w-0 flex-1 truncate',
                                          leaf.badge && isExternalLink(leaf.href) && 'pr-8',
                                          leaf.badge && !isExternalLink(leaf.href) && 'pr-14',
                                          !leaf.badge && isExternalLink(leaf.href) && 'pr-6'
                                        )}
                                      >
                                        {leaf.label}
                                      </span>
                                      {leaf.badge && (
                                        <SidebarMenuBadge
                                          className={cn(
                                            badgeClass,
                                            'top-2!',
                                            isExternalLink(leaf.href) && 'right-6',
                                            leaf.badgeClassName
                                          )}
                                        >
                                          {leaf.badge}
                                        </SidebarMenuBadge>
                                      )}
                                      {isExternalLink(leaf.href) && (
                                        <SquareArrowOutUpRightIcon className='ml-auto size-3.5! shrink-0 opacity-50' />
                                      )}
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                ))}
                              </SidebarMenuSub>
                            </CollapsibleContent>
                          </SidebarMenuSubItem>
                        </Collapsible>
                      ) : (
                        <SidebarMenuSubItem key={subItem.label}>
                          <SidebarMenuSubButton
                            className={subRowClass}
                            render={<Link href={subItem.href} target={subItem.target} />}
                            isActive={isLinkActive(subItem.href, subItem.activePath, pathname, searchParams)}
                          >
                            <NavIcon name={subItem.icon} />
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate',
                                subItem.badge && isExternalLink(subItem.href) && 'pr-8',
                                subItem.badge && !isExternalLink(subItem.href) && 'pr-14',
                                !subItem.badge && isExternalLink(subItem.href) && 'pr-6'
                              )}
                            >
                              {subItem.label}
                            </span>
                            {subItem.badge && (
                              <SidebarMenuBadge
                                className={cn(
                                  badgeClass,
                                  'top-2!',
                                  isExternalLink(subItem.href) && 'right-6',
                                  subItem.badgeClassName
                                )}
                              >
                                {subItem.badge}
                              </SidebarMenuBadge>
                            )}
                            {isExternalLink(subItem.href) && (
                              <SquareArrowOutUpRightIcon className='ml-auto size-3.5! shrink-0 opacity-50' />
                            )}
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ) : (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton
                tooltip={item.label}
                render={<Link href={item.href} target={item.target} />}
                isActive={pathname === item.href}
                className={cn(menuRowClass, menuRowActiveClass)}
              >
                {Tag && <Tag />}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    item.badge && isExternalLink(item.href) && 'pr-8',
                    item.badge && !isExternalLink(item.href) && 'pr-14',
                    !item.badge && isExternalLink(item.href) && 'pr-6'
                  )}
                >
                  {item.label}
                </span>
                {item.badge && (
                  <SidebarMenuBadge
                    className={cn(badgeClass, isExternalLink(item.href) && 'right-6', item.badgeClassName)}
                  >
                    {item.badge}
                  </SidebarMenuBadge>
                )}
                {isExternalLink(item.href) && (
                  <SquareArrowOutUpRightIcon className='ml-auto size-3.5! shrink-0 opacity-50' />
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroupContent>
  )

  // ccpayment's section title: a small caps label in disabled ink.
  const title = groupLabel && (
    <span className='min-w-0 flex-1 truncate text-left text-[11px] leading-tight font-bold tracking-wider text-[var(--mui-palette-text-disabled,#b3b9c5)] uppercase'>
      {groupLabel}
    </span>
  )

  const labelClass = 'h-auto rounded-none px-3 pt-4 pb-2 group-data-[collapsible=icon]:hidden'

  // Collapsible group (jaise Sports Exchange): label pe click = poora section khule / band ho.
  // Icon rail me label dikhta hi nahi, wahan items hamesha dikhte hain.
  if (collapsible && groupLabel && !isIconMode) {
    const key = groupKey(groupLabel)

    return (
      <Collapsible className='group/section' open={isBranchOpen(key)} onOpenChange={open => setOpenItem(key, open)}>
        <SidebarGroup className='px-4 py-0'>
          <div>
            <CollapsibleTrigger
              nativeButton={false}
              render={
                <SidebarGroupLabel
                  className={cn(
                    labelClass,
                    'hover:[&>span]:text-sidebar-foreground cursor-pointer'
                  )}
                />
              }
            >
              {title}
              <ChevronRightIcon className='text-muted-foreground ml-auto size-3.5! transition-transform duration-250 group-data-open/section:rotate-90' />
            </CollapsibleTrigger>
            <CollapsibleContent className={collapseClass}>
              {menu}
            </CollapsibleContent>
          </div>
        </SidebarGroup>
      </Collapsible>
    )
  }

  return (
    <SidebarGroup className='px-4 py-0'>
      <div>
        {groupLabel && <SidebarGroupLabel className={labelClass}>{title}</SidebarGroupLabel>}
        {menu}
      </div>
    </SidebarGroup>
  )
}

const SidebarLayout = () => {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { state, isMobile, setOpenMobile } = useSidebar()

  // Agent-tree logins (no promotions) see every section open by default (user, 2026-10-17).
  const { actor } = useSession()
  const allOpen = actor?.promotions === false

  const visible = useNavVisible()
  const homeHref = firstNavHref(visible)

  // On mobile the menu is a sheet over the page: following any link in it closes the sheet.
  const closeOnNavigate = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (isMobile && (e.target as HTMLElement).closest('a[href]')) setOpenMobile(false)
    },
    [isMobile, setOpenMobile]
  )

  // Branches the user has explicitly opened or closed, keyed by label. It lives here rather
  // than inside each Collapsible so it survives the swap between the inline sub-menu and the
  // icon-mode flyout — collapsing and re-expanding the sidebar keeps the tree as it was.
  // Anything absent from this map falls back to "open if it holds the active route".
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})

  // Hide what the role cannot reach, what the operator switched off and what the owner left out
  // of the plan. A flag or entitlement that has not loaded yet (or is not readable) hides nothing.
  const navGroups = useMemo(() => {
    return navItems
      .map(group => ({
        ...group,
        items: group.items
          .filter(item => visible(item))
          .map(item => {
            if (!item.childItems) return item

            const childItems = item.childItems
              .map(sub =>
                isSubGroup(sub)
                  ? visible(sub)
                    ? { ...sub, childItems: sub.childItems.filter(visible) }
                    : null
                  : visible(sub)
                    ? sub
                    : null
              )
              .filter((sub): sub is MenuSubItem => sub !== null && (!isSubGroup(sub) || sub.childItems.length > 0))

            return { ...item, childItems }
          })
          .filter(item => !item.childItems || item.childItems.length > 0)
      }))
      .filter(group => group.items.length > 0)
  }, [visible])

  // The bottom row: Deposits, Withdrawals, KYC, Users — taken from the menu this session sees,
  // so a role that cannot open a page never gets its shortcut.
  const shortcuts = useMemo(() => {
    const leaves = navGroups.flatMap(group =>
      group.items.flatMap(item =>
        item.childItems
          ? item.childItems.flatMap(sub => (isSubGroup(sub) ? sub.childItems : [sub]))
          : [item as MenuLeafSubItem]
      )
    )

    return SHORTCUT_HREFS.flatMap(href => leaves.filter(leaf => leaf.href === href).slice(0, 1))
  }, [navGroups])

  const activeBranchKeys = useMemo(
    () => getActiveBranchKeys(navGroups, pathname, searchParams),
    [navGroups, pathname, searchParams]
  )

  // A user toggle wins; otherwise the branch mirrors whether it holds the active route (agents: open).
  const isBranchOpen = useCallback(
    (key: string) => openItems[key] ?? (allOpen || activeBranchKeys.has(key)),
    [openItems, activeBranchKeys, allOpen]
  )

  const setOpenItem = useCallback((key: string, open: boolean) => {
    setOpenItems(prev => ({ ...prev, [key]: open }))
  }, [])

  // Only the icon rail is too narrow for the inline sub-menu. Mobile renders the full-width
  // sheet, so it keeps the normal tree.
  const isIconMode = state === 'collapsed' && !isMobile

  return (
    <Sidebar collapsible='icon' variant='sidebar'>
      <SidebarHeader className='gap-0 px-5 pt-5 pb-4 group-data-[collapsible=icon]:px-2' onClick={closeOnNavigate}>
        <div className='flex items-center gap-2'>
          <Link href={homeHref} className='flex min-w-0 flex-1 items-center gap-2.5 rounded-md'>
            <BrandMark className='size-9' />
            <span className='flex min-w-0 flex-col group-data-[collapsible=icon]:hidden'>
              <span className='text-heading truncate text-[18px] leading-tight font-semibold'>
                {themeConfig.templateName}
              </span>
              <span className='text-muted-foreground truncate text-xs'>{siteConfig.tagline}</span>
            </span>
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent className='gap-0 py-1 group-data-[collapsible=icon]:overflow-y-auto' onClick={closeOnNavigate}>
        {navGroups.map((navItem, index) => {
          return (
            <SidebarGroupedMenuItems
              key={navItem.groupLabel || index}
              data={navItem.items}
              groupLabel={navItem.groupLabel}
              groupIcon={navItem.groupIcon}
              collapsible={navItem.collapsible}
              pathname={pathname}
              searchParams={searchParams}
              isIconMode={isIconMode}
              isBranchOpen={isBranchOpen}
              setOpenItem={setOpenItem}
            />
          )
        })}
      </SidebarContent>
      {shortcuts.length > 0 && (
        <SidebarFooter className='px-4 pt-2 pb-4 group-data-[collapsible=icon]:hidden' onClick={closeOnNavigate}>
          <nav
            aria-label='Shortcuts'
            className='bg-muted/60 flex rounded-lg px-2'
          >
            {shortcuts.map(item => {
              const Tag = item.icon ? (navIcons[item.icon] as ComponentType<{ className?: string }>) : null

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    'text-muted-foreground hover:text-sidebar-primary flex h-10 flex-1 items-center justify-center rounded-lg transition-colors duration-250',
                    pathname === item.href && 'text-sidebar-primary'
                  )}
                >
                  {Tag && <Tag className='size-[18px]' />}
                </Link>
              )
            })}
          </nav>
        </SidebarFooter>
      )}
    </Sidebar>
  )
}

export default SidebarLayout
