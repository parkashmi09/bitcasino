'use client'

import type { ReactNode } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type PageTab = { value: string; label: string; render: () => ReactNode }

/**
 * Kai screens ek hi page pe, upar tabs se switch (sidebar me jagah bachane ke liye).
 * Tab URL me `?tab=` rehta hai (refresh / link pe wahi khule); sirf khula tab render hota hai,
 * isliye baaki tabs ki API tab tak nahi chalti. Pehla tab default.
 * Tab badalne pe baaki URL params (page, search…) saaf — wo pichhle tab ke the.
 */
const TabbedPage = ({ tabs }: { tabs: PageTab[] }) => {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const active = tabs.find(t => t.value === params.get('tab')) ?? tabs[0]

  const select = (value: string) => {
    router.replace(value === tabs[0].value ? pathname : `${pathname}?tab=${value}`, { scroll: false })
  }

  return (
    <div>
      <Tabs value={active.value} onValueChange={v => select(String(v))}>
        <TabsList className='mb-6 h-auto max-w-full flex-wrap justify-start'>
          {tabs.map(t => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {/* key: tab badalne pe view naya mount ho (purana form state na reh jaye) */}
      <div key={active.value}>{active.render()}</div>
    </div>
  )
}

export default TabbedPage
