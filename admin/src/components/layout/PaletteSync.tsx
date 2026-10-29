'use client'

// React Imports
import { useEffect, useSyncExternalStore } from 'react'

// Third-party Imports
import { useQueryClient } from '@tanstack/react-query'

/** The last palette seen, so a reload paints in the owner's colours at once (read by app/layout.tsx's boot script). */
const PALETTE_KEY = 'admin.palette'

/** rainbet: a custom theme's `--pal-*` variables, for the boot script (JSON object). */
const VARS_KEY = 'admin.palette.vars'

/** rainbet: "Original" (`hash_game`) on this site is Rainbet's own colours (globals.css `rainbet` block). */
const ORIGINAL = 'hash_game'

/** Mix `hex` with white (t > 0) or black (t < 0); 6-digit hex in and out, no `#`. */
const mix = (hex: string, t: number) =>
  [0, 2, 4]
    .map(i => {
      const v = parseInt(hex.slice(i, i + 2), 16)
      const out = t > 0 ? v + (255 - v) * t : v * (1 + t)

      return Math.round(out).toString(16).padStart(2, '0')
    })
    .join('')

const rgb = (hex: string) => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ')

/**
 * rainbet: an owner-made theme (owner panel → Template → Add theme) as the `--pal-*` variables the
 * generic html[data-palette] rules in globals.css derive everything else from.
 */
function customVars(p: Record<string, string>): Record<string, string> {
  const light = mix(p.accent, 0.25)
  const dark = mix(p.accent, -0.2)

  return {
    '--pal': `#${p.accent}`,
    '--pal-rgb': rgb(p.accent),
    '--pal-light': `#${light}`,
    '--pal-light-rgb': rgb(light),
    '--pal-dark': `#${dark}`,
    '--pal-dark-rgb': rgb(dark),
    '--pal-on': `#${p.onAccent}`,
    '--pal-ink': `#${mix(p.accent, -0.3)}`,
    '--pal-ink-dark': `#${light}`,
    '--pal-bg': `#${p.bg}`,
    '--pal-card': `#${p.card}`,
    '--pal-border': `#${p.border}`,
    '--pal-input': `#${p.input}`,
    '--brand-secondary': `#${p.secondary}`
  }
}

let applied: string[] = [] // the inline variables this component set, to take them off again

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
    // rainbet: the owner's own theme comes with its colours (SessionContext keeps them as `theme_palette`).
    const ownColours = theme && theme === data.get('theme') ? data.get('theme_palette') : undefined
    const vars = ownColours ? customVars(JSON.parse(ownColours)) : null

    const palette = vars ? 'custom' : theme === ORIGINAL ? null : theme && PALETTES.has(theme) ? theme : null
    const html = document.documentElement

    for (const name of applied) html.style.removeProperty(name)
    applied = vars ? Object.keys(vars) : []
    if (vars) for (const [name, value] of Object.entries(vars)) html.style.setProperty(name, value)

    if (palette) html.dataset.palette = palette
    else delete html.dataset.palette

    try {
      if (palette) localStorage.setItem(PALETTE_KEY, palette)
      else localStorage.removeItem(PALETTE_KEY)
      if (vars) localStorage.setItem(VARS_KEY, JSON.stringify(vars))
      else localStorage.removeItem(VARS_KEY)
    } catch {
      /* private mode: the next load starts in the default colours */
    }
  }, [data])

  return null
}

export default PaletteSync
