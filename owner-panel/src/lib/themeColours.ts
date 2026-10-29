/**
 * rainbet: theme colours for the owner's previews and the Add theme editor. Hex is 6 digits without
 * `#` throughout (as the document stores it). Lightness steps use OKLab, the same space the player
 * site maps colours in (frontend/src/lib/paletteMap.js).
 */
import { BUILTIN_PALETTES, ORIGINAL_PALETTE, type PaletteColours } from '@/configs/builtinPalettes'
import type { OwnerPalette } from '@/lib/entitlements/palettes'

type Lab = [number, number, number]

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function toLab(hex: string): Lab {
  const [r, g, b] = [0, 2, 4].map(i => toLin(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function fromLab([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
    .map(v => Math.round(Math.min(1, Math.max(0, toGam(Math.max(0, v)))) * 255).toString(16).padStart(2, '0'))
    .join('')
}

export const isHex = (v: string) => /^[0-9a-f]{6}$/.test(v)

/** Dark text or white, whichever reads better on `hex`. */
export const onColour = (hex: string) => (toLab(hex)[0] > 0.72 ? '141414' : 'ffffff')

/** The ground's own hue at lightness `L`, with chroma scaled by `c`. */
const tone = (bg: Lab, L: number, c: number) => fromLab([Math.min(0.99, Math.max(0.02, L)), bg[1] * c, bg[2] * c])

/**
 * A full theme from the owner's three colours: panels, borders and inputs step up from the
 * background (down on a light one), text and muted text in the background's hue, and readable
 * text on the accent and secondary.
 */
export function derivePalette(accent: string, secondary: string, bg: string): PaletteColours {
  const g = toLab(bg)
  const dark = g[0] < 0.6
  const step = dark ? 1 : -1

  return {
    accent,
    onAccent: onColour(accent),
    secondary,
    onSecondary: onColour(secondary),
    bg,
    card: tone(g, g[0] + step * 0.045, 1),
    border: tone(g, g[0] + step * 0.1, 1),
    input: tone(g, g[0] + step * 0.17, 0.9),
    fg: tone(g, dark ? 0.94 : 0.2, 0.25),
    muted: tone(g, dark ? 0.68 : 0.5, 0.5)
  }
}

/** The colours template `key` shows on the player site: the owner's own theme, a built-in, or Rainbet's ("Original"). */
export function coloursOf(key: string | undefined, palettes: OwnerPalette[] = []): PaletteColours {
  return palettes.find(p => p.key === key)?.colours ?? (key ? BUILTIN_PALETTES[key] : undefined) ?? ORIGINAL_PALETTE
}
