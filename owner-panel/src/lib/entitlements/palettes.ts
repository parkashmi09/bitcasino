/**
 * rainbet: colour themes the owner makes (Template → Add theme). Saved in the entitlements document
 * as `palettes`; the template may name one by its `custom_…` key. Mirrored by the backend's
 * `palettesOf` (services/admin/src/modules/entitlements/entitlements.store.js) — same limits.
 */
import type { PaletteColours } from '@/configs/builtinPalettes'

export type OwnerPalette = { key: string; label: string; colours: PaletteColours }

export const PALETTE_FIELDS: (keyof PaletteColours)[] = ['accent', 'onAccent', 'secondary', 'onSecondary', 'bg', 'card', 'border', 'input', 'fg', 'muted']

export const MAX_PALETTES = 24
export const MAX_LABEL = 40

const KEY_RE = /^custom_[a-z0-9_]{1,40}$/
const HEX_RE = /^[0-9a-f]{6}$/

/** What is wrong with one theme, or null. */
export function paletteProblem(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'a theme must be an object'
  const t = p as Partial<OwnerPalette>

  if (typeof t.key !== 'string' || !KEY_RE.test(t.key)) return 'a theme key is custom_ followed by letters, digits or _'
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.length > MAX_LABEL) return `a theme name is 1–${MAX_LABEL} characters`

  for (const f of PALETTE_FIELDS) {
    if (typeof t.colours?.[f] !== 'string' || !HEX_RE.test(t.colours[f])) return `${t.label}: ${f} must be a 6-digit hex colour`
  }

  return null
}

/** The list as stored: bad entries dropped (strict = refuse instead), keys unique, at most MAX_PALETTES. */
export function cleanPalettes(list: unknown, strict = false): OwnerPalette[] {
  if (!Array.isArray(list)) {
    if (strict) throw new Error('palettes must be a list')

    return []
  }

  if (strict && list.length > MAX_PALETTES) throw new Error(`at most ${MAX_PALETTES} themes`)
  const out: OwnerPalette[] = []

  for (const p of list.slice(0, MAX_PALETTES)) {
    const problem = paletteProblem(p) ?? (out.some(o => o.key === (p as OwnerPalette).key) ? 'two themes share a key' : null)

    if (problem) {
      if (strict) throw new Error(problem)
      continue
    }

    const t = p as OwnerPalette

    out.push({ key: t.key, label: t.label.trim(), colours: { ...t.colours } })
  }

  return out
}

export const samePalettes = (a?: OwnerPalette[], b?: OwnerPalette[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

/** How a theme list reads in the audit: names with their three main colours. */
export const palettesSummary = (list?: OwnerPalette[]) =>
  (list ?? []).map(p => `${p.label} #${p.colours.accent}/#${p.colours.secondary}/#${p.colours.bg}`)
