'use client'

import { useEffect, type ReactNode } from 'react'

import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import { ThemeProvider, useColorScheme } from '@mui/material/styles'
import { useTheme as useNextTheme } from 'next-themes'

import { theme } from './theme'

// next-themes owns the mode (ModeToggle, storage); MUI follows it.
const FollowNextTheme = () => {
  const { resolvedTheme } = useNextTheme()
  const { setMode } = useColorScheme()

  useEffect(() => {
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') setMode(resolvedTheme)
  }, [resolvedTheme, setMode])

  return null
}

// `enableCssLayer` puts MUI's styles in @layer mui, so Tailwind utilities a view passes in className still win.
const MuiProvider = ({ children }: { children: ReactNode }) => (
  <AppRouterCacheProvider options={{ enableCssLayer: true }}>
    <ThemeProvider theme={theme} defaultMode='dark' disableTransitionOnChange>
      <FollowNextTheme />
      {children}
    </ThemeProvider>
  </AppRouterCacheProvider>
)

export default MuiProvider
