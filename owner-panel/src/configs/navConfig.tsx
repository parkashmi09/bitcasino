import type * as Icon from 'lucide-react'

type IconName = keyof typeof Icon
export type MenuLeafSubItem = {
  label: string
  href: string
  activePath?: string
  badge?: string
  badgeClassName?: string
  target?: '_blank' | '_self'
  permission?: string | string[]
  flag?: string
}
export type MenuGroupSubItem = {
  label: string
  childItems: MenuLeafSubItem[]
  permission?: string | string[]
  flag?: string
}
export type MenuSubItem = MenuLeafSubItem | MenuGroupSubItem
export type MenuItem = { icon: IconName; label: string; permission?: string | string[]; flag?: string } & (
  | { href: string; badge?: string; badgeClassName?: string; childItems?: never; target?: '_blank' | '_self' }
  | { href?: never; badge?: string; badgeClassName?: string; childItems: MenuSubItem[] }
)
export type NavItem = { groupLabel?: string; items: MenuItem[] }

export const navItems: NavItem[] = [
  { items: [{ icon: 'LayoutGrid', label: 'Overview', href: '/overview' }] },
  {
    groupLabel: 'Control',
    items: [
      { icon: 'ShieldCheck', label: 'Features & plan', href: '/entitlements' },
      { icon: 'Coins', label: 'Coins', href: '/coins' },
      { icon: 'Palette', label: 'Branding', href: '/branding' },
      { icon: 'History', label: 'Audit log', href: '/audit' }
    ]
  },
  {
    // Site ke paise ki jaanch (zip ka System Tracker) — sirf owner panel me
    groupLabel: 'Monitoring',
    items: [{ icon: 'Activity', label: 'System Tracker', href: '/system-tracker' }]
  }
]
