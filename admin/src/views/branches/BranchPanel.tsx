'use client'

import { useState, type ReactNode } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  DicesIcon,
  LayoutDashboardIcon,
  Loader2Icon,
  LogOutIcon,
  ReceiptTextIcon,
  SparklesIcon,
  TrophyIcon,
  UsersIcon
} from 'lucide-react'

import Logo from '@/components/shared/Logo'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { useApi } from '@/hooks/use-api'
import { request } from '@/lib/api/client'

import type { Branch } from './BranchView'

const NAV = [
  { href: '/branch', label: 'Dashboard', icon: LayoutDashboardIcon },
  { href: '/branch/users', label: 'Users', icon: UsersIcon },
  { href: '/branch/deposits', label: 'Deposits', icon: ArrowDownToLineIcon },
  { href: '/branch/withdrawals', label: 'Withdrawals', icon: ArrowUpFromLineIcon },
  { href: '/branch/originals', label: 'Originals', icon: SparklesIcon },
  { href: '/branch/casino', label: 'Casino', icon: DicesIcon },
  { href: '/branch/sports', label: 'Sports', icon: TrophyIcon },
  { href: '/branch/statement', label: 'Statement', icon: ReceiptTextIcon }
]

const BranchSidebar = ({ onSignOut, busy }: { onSignOut: () => void; busy: boolean }) => {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <Sidebar collapsible='icon' variant='sidebar'>
      <SidebarHeader className='px-4 pt-4 pb-3 group-data-[collapsible=icon]:px-2'>
        <Logo className='gap-2 [&>*:first-child]:size-8' />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map(item => {
              const active = item.href === '/branch' ? pathname === '/branch' : pathname.startsWith(item.href)

              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={active}
                    tooltip={item.label}
                    render={<Link href={item.href} onClick={() => isMobile && setOpenMobile(false)} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip='Sign out' onClick={onSignOut} disabled={busy}>
              {busy ? <Loader2Icon className='animate-spin' /> : <LogOutIcon />}
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

/** The branch's own panel (/branch): its own sidebar, sign-in and cookie — none of the staff shell. */
const BranchPanel = ({ children }: { children: ReactNode }) => {
  const [busy, setBusy] = useState(false)
  const me = useApi<Branch>('admin/branches/portal/me')

  const signOut = async () => {
    setBusy(true)
    await request('/api/branch/logout', { raw: true, method: 'POST', body: {} }).catch(() => undefined)
    location.assign('/branch/login')
  }

  return (
    <div className='flex h-full w-full min-w-0'>
      <BranchSidebar onSignOut={signOut} busy={busy} />
      <SidebarInset className='flex min-w-0 flex-1 flex-col'>
        <header className='flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-6'>
          <div className='flex items-center gap-2'>
            <SidebarTrigger className='size-9' />
            <span className='text-heading font-semibold'>{me.data?.name ?? 'Branch'}</span>
          </div>
          <Button variant='outline' size='sm' onClick={signOut} disabled={busy}>
            {busy ? <Loader2Icon className='animate-spin' /> : <LogOutIcon />} Sign out
          </Button>
        </header>
        <main className='mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6'>{children}</main>
      </SidebarInset>
      <Toaster />
    </div>
  )
}

export default BranchPanel
