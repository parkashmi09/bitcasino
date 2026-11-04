// React Imports
import type { ReactNode } from 'react'

// Next Imports
import type { Metadata } from 'next'
import { Geist_Mono, Poppins } from 'next/font/google'

// Third-party Imports
import { NuqsAdapter } from 'nuqs/adapters/next/app'

// Component Imports
import Providers from '@/components/Providers'
import ScrollToTop from '@/components/layout/ScrollToTop'
import WhitelabelTheme from '@/components/shared/WhitelabelTheme'

// Config Imports
import { serverConfig, siteConfig } from '@/configs/site'

// Util Imports
import { cn } from '@/lib/utils'

// Style Imports
import './globals.css'

// ccpayment's body font.
const poppins = Poppins({ variable: '--font-poppins', subsets: ['latin'], weight: ['400', '500', '600', '700'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

/** The owner's site name (owner panel → Branding) for the tab title; this panel's env name if the gateway is slow or down. */
async function ownerSiteName() {
  try {
    const res = await fetch(`${serverConfig.apiUrl}/api/v1/admin/branding/public`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(1500)
    })

    const name: unknown = (await res.json())?.data?.siteName

    return typeof name === 'string' && name.trim() ? name.trim() : siteConfig.name
  } catch {
    return siteConfig.name
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const name = await ownerSiteName()

  return {
    title: { default: name, template: `%s · ${name}` },
    description: name,
    robots: { index: false, follow: false },

    // The owner's mark (app/api/brand/favicon), else the TestPlay one.
    icons: { icon: '/api/brand/favicon', apple: '/api/brand/favicon' }
  }
}

const RootLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
  return (
    <html
      lang='en'
      className={cn(poppins.variable, geistMono.variable, 'flex min-h-full w-full antialiased')}
      data-scroll-behavior='smooth'
      suppressHydrationWarning
    >
      <head>
        {/* The owner's palette from the last visit (components/layout/PaletteSync.tsx), set before paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var p=localStorage.getItem('admin.palette');if(p)document.documentElement.dataset.palette=p;var v=JSON.parse(localStorage.getItem('admin.palette.vars')||'null');if(v)for(var k in v)document.documentElement.style.setProperty(k,v[k])}catch(e){}"
          }}
        />
      </head>
      <body className='flex min-h-full w-full flex-auto flex-col'>
        <NuqsAdapter>
          <Providers sidebarDefaultOpen={true}>
            {siteConfig.whitelabel && <WhitelabelTheme />}
            {children}
          </Providers>
        </NuqsAdapter>
        <ScrollToTop />
      </body>
    </html>
  )
}

export default RootLayout
