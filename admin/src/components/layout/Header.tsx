'use client'

// React Imports
import { useId, useMemo, useState, type FormEvent } from 'react'

// Next Imports
import { useRouter } from 'next/navigation'

// Third-party Imports
import { MaximizeIcon, MinimizeIcon, SearchIcon } from 'lucide-react'

// Component Imports
import ModeToggle from '@/components/layout/ModeToggle'
import OwnerBalance from '@/components/layout/OwnerBalance'
import BrandMark from '@/components/shared/BrandMark'
import ProfileDropdown from '@/components/shared/ProfileDropdown'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'

// Config Imports
import { navItems, type MenuSubItem } from '@/configs/navConfig'
import { siteConfig } from '@/configs/site'
import { useNavVisible } from '@/hooks/use-nav-visible'

/**
 * Luno's search box. There is no command palette in this app, so it searches the menu: pick a
 * page from the suggestions (or type its exact name) and Enter opens it. Only pages this
 * session's menu shows are offered.
 */
const MenuSearch = () => {
  const router = useRouter()
  const visible = useNavVisible()
  const listId = useId()
  const [query, setQuery] = useState('')

  const pages = useMemo(() => {
    const out: { label: string; href: string }[] = []

    const leaf = (sub: MenuSubItem) => {
      if ('childItems' in sub) {
        if (visible(sub)) sub.childItems.filter(visible).forEach(l => out.push({ label: l.label, href: l.href }))
      } else if (visible(sub)) out.push({ label: sub.label, href: sub.href })
    }

    navItems.forEach(group =>
      group.items.filter(visible).forEach(item => {
        if (item.childItems) item.childItems.forEach(leaf)
        else out.push({ label: item.label, href: item.href })
      })
    )

    return out.filter(p => !/^https?:/.test(p.href))
  }, [visible])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim().toLowerCase()

    if (!q) return
    const hit = pages.find(p => p.label.toLowerCase() === q) ?? pages.find(p => p.label.toLowerCase().includes(q))

    if (hit) {
      setQuery('')
      router.push(hit.href)
    }
  }

  return (
    <form role='search' onSubmit={onSubmit} className='relative hidden w-full max-w-[405px] md:block'>
      <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
      <input
        type='search'
        aria-label='Search the menu'
        placeholder='Search a page…'
        list={listId}
        value={query}
        onChange={e => setQuery(e.target.value)}
        className='border-input bg-card text-foreground placeholder:text-muted-foreground hover:border-foreground focus-visible:border-primary focus-visible:ring-primary h-10 w-full rounded-lg border pr-3 pl-9 text-[14px] transition-colors duration-250 outline-none focus-visible:ring-1'
      />
      <datalist id={listId}>
        {pages.map(p => (
          <option key={p.href} value={p.label} />
        ))}
      </datalist>
    </form>
  )
}

/** Luno's fullscreen icon: toggles the browser's full screen for the whole panel. */
const FullscreenToggle = () => {
  const [full, setFull] = useState(false)

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().then(() => setFull(false))
    else void document.documentElement.requestFullscreen?.().then(() => setFull(true))
  }

  return (
    <Button variant='ghost' size='icon' className='text-muted-foreground hover:text-foreground hidden rounded-full lg:inline-flex' onClick={toggle}>
      {full ? <MinimizeIcon /> : <MaximizeIcon />}
      <span className='sr-only'>{full ? 'Exit full screen' : 'Full screen'}</span>
    </Button>
  )
}

const Header = () => {
  return (
    <header className='bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-50 backdrop-blur-md'>
      <div className='mx-auto flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:h-[72px] lg:px-10'>
        <div className='flex min-w-0 flex-1 items-center gap-3 lg:gap-6'>
          <SidebarTrigger className='text-muted-foreground hover:text-foreground size-9 rounded-full hover:bg-[rgb(113_117_126/8%)] [&_svg]:size-5!' />
          {/* On a phone the sidebar is a sheet, so the header carries the brand as Luno does. */}
          <span className='flex min-w-0 items-center gap-2 md:hidden'>
            <BrandMark className='size-7' />
            <span className='text-heading truncate text-base font-semibold'>{siteConfig.name}</span>
          </span>
          <MenuSearch />
        </div>
        <div className='flex items-center gap-1 sm:gap-2'>
          <OwnerBalance />
          <FullscreenToggle />
          <ModeToggle />
          <ProfileDropdown />
        </div>
      </div>
    </header>
  )
}

export default Header
