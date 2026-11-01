/**
 * Site branding (contract §8): the name, the page metadata and the logo files the site shows.
 * Saved in the entitlements document as `branding`, through the same review → save → audit as
 * every other owner change. The images themselves are uploaded to the site backend
 * (`owner_branding_assets`, by `<sha256>.<ext>`); the document names them by that hash, so the
 * signature over the document also vouches for the bytes the site serves.
 *
 * Mirrored by backend/services/admin/src/modules/branding/branding.rules.js (same limits).
 * No '@/' imports and no Node APIs: the tests load it as is and the screen uses it too.
 */

export type BrandingImageType = 'image/png' | 'image/webp' | 'image/svg+xml'

/** One uploaded image, named by the SHA-256 of its (sanitised) bytes. */
export type BrandingAsset = { file: string; type: BrandingImageType; bytes: number; width?: number; height?: number }

export type Branding = {
  siteName: string
  title: string

  /** e.g. `%s · TestPlay`: how a page's own title is shown; empty = the title alone. */
  titleTemplate: string
  description: string
  keywords: string[]
  ogTitle: string
  ogDescription: string

  /** `#RRGGBB` or empty (the UI's own). */
  themeColor: string
  logo: BrandingAsset | null
  mark: BrandingAsset | null
  ogImage: BrandingAsset | null

  /** The floating chat buttons the site admin may switch on (Site config → Branding sets the number or link). */
  whatsappEnabled: boolean
  telegramEnabled: boolean
}

export type BrandingSlot = 'logo' | 'mark' | 'ogImage'
export const BRANDING_SLOTS: BrandingSlot[] = ['logo', 'mark', 'ogImage']

export const TEXT_LIMITS = {
  siteName: 40,
  title: 70,
  titleTemplate: 80,
  description: 300,
  ogTitle: 90,
  ogDescription: 300
} as const

export type BrandingTextKey = keyof typeof TEXT_LIMITS
export const TEXT_KEYS = Object.keys(TEXT_LIMITS) as BrandingTextKey[]

export const MAX_KEYWORDS = 20
export const MAX_KEYWORD_LENGTH = 40

/** Bytes per slot: a wordmark or a mark is small; an Open Graph card is 1200x630. */
export const MAX_IMAGE_BYTES: Record<BrandingSlot, number> = { logo: 256 * 1024, mark: 256 * 1024, ogImage: 1024 * 1024 }
export const MIN_IMAGE_BYTES = 64
export const MAX_IMAGE_SIDE = 4096

export const BRANDING_LABELS: Record<keyof Branding, string> = {
  siteName: 'Site name',
  title: 'Page title',
  titleTemplate: 'Title template',
  description: 'Meta description',
  keywords: 'Meta keywords',
  ogTitle: 'Open Graph title',
  ogDescription: 'Open Graph description',
  themeColor: 'Theme colour',
  logo: 'Logo',
  mark: 'Square mark / favicon',
  ogImage: 'Open Graph image',
  whatsappEnabled: 'WhatsApp button allowed',
  telegramEnabled: 'Telegram button allowed'
}

export const EMPTY_BRANDING: Branding = {
  siteName: '',
  title: '',
  titleTemplate: '',
  description: '',
  keywords: [],
  ogTitle: '',
  ogDescription: '',
  themeColor: '',
  logo: null,
  mark: null,
  ogImage: null,
  whatsappEnabled: false,
  telegramEnabled: false
}

export const ASSET_FILE_RE = /^[0-9a-f]{64}\.(png|webp|svg)$/
const TYPE_OF_EXT: Record<string, BrandingImageType> = { png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }

export const EXT_OF_TYPE: Record<BrandingImageType, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

/** Printable text: no control characters, no angle brackets (it lands in <title> and <meta>). */
export const BAD_TEXT = /[<>\u0000-\u001f\u007f]/

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Keywords from a list or a comma-separated string: trimmed, de-duplicated (case-insensitive), empties dropped. */
export function keywordList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const out: string[] = []

  for (const k of raw) {
    const word = str(k).replace(/\s+/g, ' ')

    if (word && !out.some(o => o.toLowerCase() === word.toLowerCase())) out.push(word)
  }

  return out
}

function assetProblem(a: unknown, slot: BrandingSlot): string | null {
  if (a === null || a === undefined) return null
  if (typeof a !== 'object' || Array.isArray(a)) return `${slot} must be an uploaded image or null`
  const asset = a as BrandingAsset

  if (typeof asset.file !== 'string' || !ASSET_FILE_RE.test(asset.file)) return `${slot}.file is not an uploaded image name`
  if (TYPE_OF_EXT[asset.file.split('.')[1]] !== asset.type) return `${slot}.type does not match the file`
  if (!Number.isInteger(asset.bytes) || asset.bytes < MIN_IMAGE_BYTES || asset.bytes > MAX_IMAGE_BYTES[slot]) return `${slot}.bytes is out of range`

  for (const side of ['width', 'height'] as const) {
    const v = asset[side]

    if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > MAX_IMAGE_SIDE)) return `${slot}.${side} is out of range`
  }

  return null
}

/** The first thing wrong with a branding block (strict, what a save must pass), or null. */
export function brandingProblem(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'branding must be an object'
  const b = input as Record<string, unknown>
  const known = new Set<string>(Object.keys(EMPTY_BRANDING))

  for (const key of Object.keys(b)) if (!known.has(key)) return `branding.${key} is not a branding field`

  for (const key of TEXT_KEYS) {
    const v = b[key]

    if (v === undefined) continue
    if (typeof v !== 'string') return `${BRANDING_LABELS[key]} must be text`
    if (v.trim().length > TEXT_LIMITS[key]) return `${BRANDING_LABELS[key]} is at most ${TEXT_LIMITS[key]} characters`
    if (BAD_TEXT.test(v)) return `${BRANDING_LABELS[key]} may not contain < > or control characters`
  }

  // A branded site has a name (it is the logo's alt text); all-empty = not branded, allowed.
  const anythingElse = Object.entries(b).some(([k, v]) => k !== 'siteName' && (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? !!v.trim() : !!v))

  if (anythingElse && !str(b.siteName)) return 'Site name is required once anything is branded'

  const template = str(b.titleTemplate)

  if (template && (template.split('%s').length !== 2)) return 'Title template must contain %s exactly once (where the page title goes)'

  if (b.keywords !== undefined) {
    if (!Array.isArray(b.keywords)) return 'Meta keywords must be a list'
    if (b.keywords.some(k => typeof k !== 'string')) return 'Meta keywords must be text'
    const words = keywordList(b.keywords)

    if (words.length > MAX_KEYWORDS) return `At most ${MAX_KEYWORDS} meta keywords`
    if (words.some(w => w.length > MAX_KEYWORD_LENGTH)) return `A meta keyword is at most ${MAX_KEYWORD_LENGTH} characters`
    if (words.some(w => BAD_TEXT.test(w))) return 'Meta keywords may not contain < > or control characters'
  }

  if (b.themeColor !== undefined) {
    if (typeof b.themeColor !== 'string') return 'Theme colour must be text'
    if (b.themeColor.trim() && !/^#[0-9a-fA-F]{6}$/.test(b.themeColor.trim())) return 'Theme colour must look like #1A2B3C'
  }

  for (const slot of BRANDING_SLOTS) {
    const problem = assetProblem(b[slot], slot)

    if (problem) return problem
  }

  for (const key of ['whatsappEnabled', 'telegramEnabled'] as const) {
    if (b[key] !== undefined && typeof b[key] !== 'boolean') return `${BRANDING_LABELS[key]} must be on or off`
  }

  return null
}

const cleanAsset = (a: unknown, slot: BrandingSlot): BrandingAsset | null => {
  if (!a || assetProblem(a, slot)) return null
  const x = a as BrandingAsset

  return { file: x.file, type: x.type, bytes: x.bytes, ...(x.width ? { width: x.width } : {}), ...(x.height ? { height: x.height } : {}) }
}

/** Every field present and well-formed; anything malformed reads as unset (reading an older or hand-edited file). */
export function cleanBranding(input: unknown): Branding {
  const b = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const out: Branding = { ...EMPTY_BRANDING, keywords: [] }

  for (const key of TEXT_KEYS) {
    const v = str(b[key])

    out[key] = v.length <= TEXT_LIMITS[key] && !BAD_TEXT.test(v) ? v : ''
  }

  if (out.titleTemplate && out.titleTemplate.split('%s').length !== 2) out.titleTemplate = ''
  out.keywords = keywordList(b.keywords).filter(w => w.length <= MAX_KEYWORD_LENGTH && !BAD_TEXT.test(w)).slice(0, MAX_KEYWORDS)
  const color = str(b.themeColor)

  out.themeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : ''
  for (const slot of BRANDING_SLOTS) out[slot] = cleanAsset(b[slot], slot)
  out.whatsappEnabled = b.whatsappEnabled === true
  out.telegramEnabled = b.telegramEnabled === true

  return out
}

export type BrandingChange = { kind: 'branding'; key: keyof Branding; from: string | null; to: string | null }

const shown = (b: Branding, key: keyof Branding): string | null => {
  const v = b[key]

  if (v === null) return null
  if (typeof v === 'boolean') return v ? 'On' : 'Off'
  if (Array.isArray(v)) return v.length ? v.join(', ') : null
  if (typeof v === 'object') return v.file

  return v || null
}

/** One change per field that moved; images compare by file (= content hash). */
export function diffBranding(before: unknown, after: unknown): BrandingChange[] {
  const a = cleanBranding(before)
  const b = cleanBranding(after)
  const out: BrandingChange[] = []

  for (const key of Object.keys(EMPTY_BRANDING) as (keyof Branding)[]) {
    const from = shown(a, key)
    const to = shown(b, key)

    if (from !== to) out.push({ kind: 'branding', key, from, to })
  }

  return out
}

/* ── Uploads ──────────────────────────────────────────────────────────────────────────────── */

/**
 * SVG, accepted only when inert. The harmless noise (XML declaration, comments, <metadata>) is
 * stripped; anything active is REFUSED, not rewritten — a sanitiser that edits markup is one
 * parser differential away from a bypass, and a clean re-export is easy. Same rules as the
 * backend's coin images (currencies/coinImage.js), which the backend applies again on receipt.
 */
const SVG_BANNED: [RegExp, string][] = [
  [/<\s*script\b/i, 'a <script> element'],
  [/<\s*foreignObject\b/i, 'a <foreignObject> element'],
  [/<\s*(iframe|embed|object|audio|video|canvas|handler|listener)\b/i, 'an embedded document or media element'],
  [/<!\s*(DOCTYPE|ENTITY)\b/i, 'a DOCTYPE or ENTITY declaration'],
  [/<!\[CDATA\[/i, 'a CDATA section'],
  [/<\?(?!xml\b)/i, 'a processing instruction'],
  [/\son[a-z]+\s*=/i, 'an event attribute (on…=)'],
  [/javascript\s*:/i, 'a javascript: URL'],
  [/vbscript\s*:/i, 'a vbscript: URL'],
  [/@import\b/i, 'a CSS @import'],
  [/<\s*(set|animate|animateTransform|animateMotion)\b[^>]*\b(href|attributeName\s*=\s*["']?\s*(href|xlink:href))/i, 'an animated link']
]

const SAFE_REFERENCE = /^(#[\w.:-]*|data:image\/(png|webp|jpeg);base64,[a-z0-9+/=\s]*)$/i

function references(text: string) {
  const out: string[] = []

  for (const m of text.matchAll(/\b(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) out.push(m[2] ?? m[3] ?? m[4] ?? '')
  for (const m of text.matchAll(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi)) out.push(m[2] ?? '')

  return out.map(r => r.trim())
}

/** `{ ok, text }` with the noise stripped, or `{ ok: false, reason }`. */
export function sanitiseSvg(source: string): { ok: true; text: string } | { ok: false; reason: string } {
  let text = source.replace(/^﻿/, '').trim()

  text = text.replace(/^<\?xml[^>]*\?>\s*/i, '')
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  text = text.replace(/<metadata\b[\s\S]*?<\/metadata\s*>/gi, '').trim()

  if (!/^<svg[\s>]/i.test(text)) return { ok: false, reason: 'not an <svg> document' }
  if (!/<\/svg\s*>$/i.test(text)) return { ok: false, reason: 'unterminated <svg>' }
  if ((text.match(/<svg[\s>]/gi) ?? []).length !== 1) return { ok: false, reason: 'a nested <svg>' }

  for (const [pattern, what] of SVG_BANNED) if (pattern.test(text)) return { ok: false, reason: `contains ${what}` }

  if (references(text).some(ref => !SAFE_REFERENCE.test(ref))) return { ok: false, reason: 'contains an external reference (only #id and inline data:image are allowed)' }

  return { ok: true, text: text + '\n' }
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const startsWith = (b: Uint8Array, magic: number[], at = 0) => magic.every((v, i) => b[at + i] === v)
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len))
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]
const u24le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8) + (b[at + 2] << 16)
const u14le = (b: Uint8Array, at: number) => (b[at] + (b[at + 1] << 8)) & 0x3fff

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(b, 12, 4)

  if (chunk === 'VP8X' && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { width: u14le(b, 26), height: u14le(b, 28) }

  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)

    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }

  return null
}

function svgSize(text: string): { width: number; height: number } | null {
  const root = text.match(/^<svg\b[^>]*>/i)?.[0] ?? ''
  const vb = root.match(/\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i)

  if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) }
  const w = root.match(/\bwidth\s*=\s*["']([\d.]+)(px)?["']/i)
  const h = root.match(/\bheight\s*=\s*["']([\d.]+)(px)?["']/i)

  return w && h ? { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) } : null
}

export type InspectedImage = { ok: true; type: BrandingImageType; ext: string; data: Uint8Array; width?: number; height?: number }
export type RefusedImage = { ok: false; code: 'NO_FILE' | 'TOO_LARGE' | 'TOO_SMALL' | 'FORMAT_REFUSED' | 'NOT_AN_IMAGE' | 'UNSAFE_SVG' | 'BAD_SHAPE'; reason: string }

/**
 * What an upload really is, by its bytes (never the name or the declared type): PNG or WebP by
 * magic bytes, else an inert SVG (sanitised). JPEG and GIF are refused (a logo needs
 * transparency and one frame). The mark must be square-ish; the logo wider than tall.
 */
export function inspectBrandingImage(bytes: Uint8Array, slot: BrandingSlot): InspectedImage | RefusedImage {
  if (!bytes || !bytes.length) return { ok: false, code: 'NO_FILE', reason: 'No file' }
  if (bytes.length > MAX_IMAGE_BYTES[slot]) return { ok: false, code: 'TOO_LARGE', reason: `At most ${MAX_IMAGE_BYTES[slot] / 1024} KB for ${BRANDING_LABELS[slot]}` }
  if (bytes.length < MIN_IMAGE_BYTES) return { ok: false, code: 'TOO_SMALL', reason: 'The file is too small to be an image' }

  let result: InspectedImage

  if (startsWith(bytes, PNG_MAGIC)) {
    if (bytes.length < 33 || ascii(bytes, 12, 4) !== 'IHDR') return { ok: false, code: 'NOT_AN_IMAGE', reason: 'A PNG without its header' }
    result = { ok: true, type: 'image/png', ext: 'png', data: bytes, width: u32be(bytes, 16), height: u32be(bytes, 20) }
  } else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const size = webpSize(bytes)

    if (!size) return { ok: false, code: 'NOT_AN_IMAGE', reason: 'A WebP without a readable header' }
    result = { ok: true, type: 'image/webp', ext: 'webp', data: bytes, ...size }
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff]) || ascii(bytes, 0, 4) === 'GIF8') {
    return { ok: false, code: 'FORMAT_REFUSED', reason: 'JPEG and GIF are not accepted: upload a PNG, WebP or SVG (a logo needs transparency)' }
  } else {
    let text: string

    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return { ok: false, code: 'NOT_AN_IMAGE', reason: 'Not a PNG, WebP or SVG' }
    }

    if (!/^\s*(﻿)?\s*</.test(text) || !/<svg[\s>]/i.test(text)) return { ok: false, code: 'NOT_AN_IMAGE', reason: 'Not a PNG, WebP or SVG' }
    const clean = sanitiseSvg(text)

    if (!clean.ok) return { ok: false, code: 'UNSAFE_SVG', reason: `SVG refused: ${clean.reason}` }
    const data = new TextEncoder().encode(clean.text)
    const size = svgSize(clean.text)

    result = { ok: true, type: 'image/svg+xml', ext: 'svg', data, ...(size ?? {}) }
  }

  const { width, height } = result

  if (width !== undefined && height !== undefined) {
    if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) return { ok: false, code: 'BAD_SHAPE', reason: `Each side must be 1–${MAX_IMAGE_SIDE} px` }
    const ratio = width / height

    if (slot === 'mark' && (ratio < 0.8 || ratio > 1.25)) return { ok: false, code: 'BAD_SHAPE', reason: `The square mark must be (nearly) square; this one is ${width}x${height}` }
    if (slot === 'logo' && ratio < 1.5) return { ok: false, code: 'BAD_SHAPE', reason: `The logo is a wordmark: wider than tall (about 4.5:1, e.g. 288x64); this one is ${width}x${height}` }
  }

  return result
}
