'use client'

// React Imports
import { useEffect, useSyncExternalStore } from 'react'

// Third-party Imports
import { useQueryClient } from '@tanstack/react-query'

/** The last palette seen, so a reload paints in the owner's colours at once (read by app/layout.tsx's boot script). */
const PALETTE_KEY = 'admin.palette'

/** The owner's colour templates that have rules in globals.css ([data-palette]); any other key = the admin's own colours. */
const PALETTES = new Set([
  'carbon_gold',
  'violet_night',
  'emerald_dark',
  'neon_navy',
  'lapis_ledger',
  'seashell_teal',
  'navy_coral',
  'indigo_mint',
  'cobalt_citrine',
  'copper_harbour',
  'wisteria',
  'jade_night',
  'magma',
  'royal_dusk',
  'tangerine_field',
  'ocean_ruby',
])

/*
 * The owner panel's template (Features & plan → Template) is published as the `theme` row of
 * GET /admin/features/public. SessionContext already reads that list (as a Map) for every
 * session; this only watches that cache entry (never fetches, never adds an observer whose
 * missing queryFn a refetch would trip on), so the palette follows the owner's save on the
 * session's next poll / refocus.
 */
const FEATURES_KEY = ['api', 'admin/features/public', null]

const PaletteSync = () => {
  const qc = useQueryClient()

  const data = useSyncExternalStore(
    onChange => qc.getQueryCache().subscribe(onChange),
    () => qc.getQueryData<Map<string, string | undefined> | null>(FEATURES_KEY),
    () => undefined
  )

  useEffect(() => {
    if (!(data instanceof Map)) return // not read yet / failed: keep what is showing
    // The owner's admin theme (policy `admin_theme`): `same` / unset follows the site's template.
    const pick = data.get('admin_theme')
    const theme = !pick || pick === 'same' ? data.get('theme') : pick === 'original' ? null : pick
    const palette = theme && PALETTES.has(theme) ? theme : null
    const html = document.documentElement

    if (palette) html.dataset.palette = palette
    else delete html.dataset.palette

    try {
      if (palette) localStorage.setItem(PALETTE_KEY, palette)
      else localStorage.removeItem(PALETTE_KEY)
    } catch {
      /* private mode: the next load starts in the default colours */
    }
  }, [data])

  return null
}

export default PaletteSync
