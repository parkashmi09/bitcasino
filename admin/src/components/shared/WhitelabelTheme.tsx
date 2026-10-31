'use client'

import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { TEMPLATE_PALETTES } from '@/views/whitelabels/palettes'
import { PALETTE_KEYS, type Palette } from '@/views/whitelabels/types'

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * The player site's colours on this admin's own tokens (globals.css): the brand colour in both
 * themes, the dark surfaces only in dark mode (the player palettes are dark ones).
 */
const themeCss = (p: Palette) =>
  `:root,.dark{--primary:${p.primary};--primary-foreground:${p.ink};--ring:${p.primary};--chart-1:${p.primary};--sidebar-primary:${p.primary};--sidebar-primary-foreground:${p.ink}}` +
  `.dark{--background:${p.bg};--sidebar:${p.bg};--card:${p.s1};--popover:${p.s1};--muted:${p.s2};--border:${p.border};--input:${p.border};` +
  `--foreground:${p.text};--card-foreground:${p.text};--muted-foreground:${p.muted};--accent:color-mix(in srgb,${p.primary} 15%,transparent)}`

/**
 * A whitelabel copy's admin (NEXT_PUBLIC_WHITELABEL_MODE) in its player site's colours: the custom
 * palette the parent set (admin modules/whitelabel-link `theme`), else its template's. Its own
 * query key: `admin/features/public` is cached by SessionContext in another shape.
 */
const WhitelabelTheme = () => {
  const { data: palette } = useQuery<Palette | null>({
    queryKey: ['whitelabel-theme'],
    queryFn: async () => {
      const [theme, features] = await Promise.all([
        api.get<{ palette: Palette | null }>('admin/whitelabel-link/theme').catch(() => null),
        api.get<Array<{ feature: string; variant?: string }>>('admin/features/public').catch(() => null)
      ])

      const template = Array.isArray(features) ? features.find(f => f.feature === 'theme')?.variant : undefined

      return theme?.palette ?? (template ? TEMPLATE_PALETTES[template] : undefined) ?? TEMPLATE_PALETTES.hash_game
    },
    staleTime: 60_000,
    retry: false
  })

  // Values reach a <style>: only #RRGGBB passes.
  if (!palette || !PALETTE_KEYS.every(k => HEX.test(palette[k]))) return null

  return <style id='whitelabel-theme'>{themeCss(palette)}</style>
}

export default WhitelabelTheme
