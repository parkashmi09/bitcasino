'use client'

// React Imports
import { useState } from 'react'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import { LogOutIcon, PlusCircleIcon, ShieldCheckIcon, UserCogIcon } from 'lucide-react'

// Component Imports
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// Config Imports
import { siteConfig } from '@/configs/site'

// Context Imports
import { useSession } from '@/contexts/SessionContext'

// View Imports
import OwnerAddBalance from '@/views/exchange/OwnerAddBalance'

const ProfileDropdown = () => {
  const { actor, signOut, can } = useSession()
  const name = actor?.name ?? actor?.roleName ?? 'Staff'

  // Super Admin, or its executive granted wallet:adjust (the owner-wallet routes' permission).
  const isOwner = actor?.level === 1 && can('wallet:adjust')
  const [addOpen, setAddOpen] = useState(false)

  const initials = name
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant='ghost' size='icon' className='relative rounded-full hover:bg-transparent' />}
        >
          <Avatar>
            <AvatarFallback>{initials || 'S'}</AvatarFallback>
          </Avatar>
          <span className='ring-card absolute right-0 bottom-0 block size-2.5 rounded-full bg-success ring-2' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <DropdownMenuGroup>
            <DropdownMenuLabel className='flex items-center gap-4 px-2 py-2.5 font-normal'>
              <Avatar className='size-10'>
                <AvatarFallback>{initials || 'S'}</AvatarFallback>
              </Avatar>
              <div className='flex flex-1 flex-col items-start gap-1'>
                <span className='text-foreground text-base font-semibold'>{name}</span>
                <span className='text-muted-foreground text-xs'>
                  {actor?.email ?? `staff #${actor?.staffId ?? '?'}`}
                </span>
                <Badge variant='secondary' className='text-xs'>
                  {actor?.roleName ?? '…'} · level {actor?.level ?? '?'}
                </Badge>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link href='/account' />}>
              <UserCogIcon />
              <span>My account</span>
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href='/account?tab=security' />}>
              <ShieldCheckIcon />
              <span>Two-factor &amp; password</span>
            </DropdownMenuItem>
            {/* Owner Add Balance — zip jaisa header menu me; owner apne hi wallet me (executive ko nahi) */}
            {isOwner && (
              <DropdownMenuItem onClick={() => setAddOpen(true)}>
                <PlusCircleIcon />
                <span>{siteConfig.whitelabel ? 'Move to Agent System' : 'Add Balance'}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant='destructive' onClick={() => void signOut()}>
              <LogOutIcon />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Dialog menu ke bahar — menu band hote hi uska content hat jaata hai */}
      {isOwner && <OwnerAddBalance open={addOpen} onOpenChange={setAddOpen} />}
    </>
  )
}

export default ProfileDropdown
