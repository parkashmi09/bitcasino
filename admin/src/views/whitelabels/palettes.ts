import type { IconKey, Palette, PaletteKey } from './types'

/**
 * The player site's colour templates as their 13 `--p-*` tokens — copied from
 * frontend/src/theme/palettes.css (keep in step when a template changes there). `hash_game` has no
 * block there (it is bc's own colours): its values are the frontend's @theme dark tokens
 * (src/index.css), except `lo`, which bc does not have and is a darker green chosen here.
 */
export const TEMPLATE_PALETTES: Record<string, Palette> = {
  hash_game: { bg: '#1E2121', s1: '#292D2E', s2: '#323738', s3: '#3A4142', border: '#4A5354', text: '#FFFFFF', muted: '#849194', primary: '#24EE89', ink: '#000000', accent: '#957AFF', live: '#FC3C3C', hi: '#9FE871', lo: '#15803D' },
  violet_night: { bg: '#0e0a17', s1: '#171126', s2: '#201834', s3: '#2a2042', border: '#43375e', text: '#f4f0ff', muted: '#a59cbd', primary: '#a78bfa', ink: '#140f1f', accent: '#f0abfc', live: '#ff4d6d', hi: '#ddd6fe', lo: '#7c3aed' },
  emerald_dark: { bg: '#0a0f0c', s1: '#111a15', s2: '#17241d', s3: '#1f3027', border: '#2f4a3b', text: '#eefcf3', muted: '#94ad9f', primary: '#22c55e', ink: '#04140a', accent: '#5eead4', live: '#fb4f5f', hi: '#86efac', lo: '#15803d' },
  carbon_gold: { bg: '#0b0b0b', s1: '#151515', s2: '#1e1e1e', s3: '#282828', border: '#3a3a3a', text: '#f5f5f0', muted: '#9c9c94', primary: '#fcee0a', ink: '#0b0b0b', accent: '#00f0ff', live: '#ff003c', hi: '#fff56b', lo: '#e0a800' },
  neon_navy: { bg: '#0b0f1a', s1: '#12172a', s2: '#192036', s3: '#212a44', border: '#33405f', text: '#eef2ff', muted: '#98a2bf', primary: '#1aff00', ink: '#051003', accent: '#38bdf8', live: '#ff4d6d', hi: '#8cff7a', lo: '#0fa800' }
}

export const TEMPLATE_LABELS: Record<string, string> = {
  hash_game: 'Default',
  violet_night: 'Violet Night',
  emerald_dark: 'Emerald Dark',
  carbon_gold: 'Carbon Gold',
  neon_navy: 'Neon Navy'
}

export const TOKEN_LABELS: Record<PaletteKey, string> = {
  bg: 'Page background',
  s1: 'Header / sidebar',
  s2: 'Cards',
  s3: 'Raised controls',
  border: 'Borders',
  text: 'Text',
  muted: 'Muted text',
  primary: 'Brand colour',
  ink: 'Text on brand',
  accent: 'Accent',
  live: 'Live / error',
  hi: 'Brand light',
  lo: 'Brand dark'
}

export const ICON_LABELS: Record<IconKey, string> = {
  icon: 'Icons',
  iconhov: 'Icons on hover',
  iconact: 'Icons active'
}

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

/**
 * The icon colours the player site uses when a palette sets none — as the built-in templates'
 * recoloured sprites (frontend tools/gen-theme-sprites.mjs, src/theme/customSprites.js): resting =
 * 45% text over muted, hover = text, active = brand colour.
 */
export const iconDefaults = (p: Palette): Record<IconKey, string> => {
  const [t, m] = [hex(p.text), hex(p.muted)]
  const grey = t.map((v, i) => Math.round(v * 0.45 + m[i] * 0.55))

  return {
    icon: `#${grey.map(v => (Number.isFinite(v) ? v : 0).toString(16).padStart(2, '0')).join('')}`,
    iconhov: p.text,
    iconact: p.primary
  }
}

/** The palette's icon colours: its own where set, else the defaults. */
export const iconColours = (p: Palette): Record<IconKey, string> => {
  const d = iconDefaults(p)

  return { icon: p.icon ?? d.icon, iconhov: p.iconhov ?? d.iconhov, iconact: p.iconact ?? d.iconact }
}
