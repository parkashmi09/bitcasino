// Branding rules (contract §8) — what PUT /api/owner/entitlements and the upload route accept.
//   node --test scripts/branding.test.mjs        (Node 22.18+ strips the .ts types itself)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { brandingProblem, cleanBranding, diffBranding, EMPTY_BRANDING, inspectBrandingImage, keywordList, sanitiseSvg } from '../src/lib/entitlements/branding.ts'

const enc = s => new TextEncoder().encode(s)
const HASH = 'a'.repeat(64)
const asset = (over = {}) => ({ file: `${HASH}.png`, type: 'image/png', bytes: 1200, width: 576, height: 128, ...over })
const good = (over = {}) => ({ ...EMPTY_BRANDING, siteName: 'parker567', title: 'Parker567 — Casino & Sports', keywords: ['casino'], logo: asset(), ...over })

/** A minimal PNG header of the given size (signature + IHDR); enough for the magic-byte sniff. */
function png(width, height, total = 200) {
  const b = new Uint8Array(total)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  return b
}

const svg = body => enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 64" width="288" height="64">${body}<path d="M0 0h10v10H0z"/></svg>`)

test('a full, valid block passes; all-empty (not branded) passes', () => {
  assert.equal(brandingProblem(good()), null)
  assert.equal(brandingProblem(EMPTY_BRANDING), null)
  assert.equal(brandingProblem(good({ titleTemplate: '%s · Parker567', themeColor: '#24EE89', mark: asset({ file: `${'b'.repeat(64)}.svg`, type: 'image/svg+xml', width: 128, height: 128 }) })), null)
})

test('fields are strict', () => {
  assert.match(brandingProblem(good({ favicon: 'x' })), /not a branding field/)
  assert.match(brandingProblem(good({ siteName: '' })), /Site name is required/)
  assert.match(brandingProblem(good({ title: 'x'.repeat(71) })), /at most 70/)
  assert.match(brandingProblem(good({ title: '<script>alert(1)</script>' })), /< >/)
  assert.match(brandingProblem(good({ description: 'a\u0000b' })), /control/)
  assert.match(brandingProblem(good({ titleTemplate: 'Parker567' })), /%s exactly once/)
  assert.match(brandingProblem(good({ titleTemplate: '%s %s' })), /%s exactly once/)
  assert.match(brandingProblem(good({ themeColor: 'red' })), /#1A2B3C/)
  assert.match(brandingProblem(good({ keywords: 'a,b' })), /list/)
  assert.match(brandingProblem(good({ keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) })), /At most 20/)
  assert.match(brandingProblem(good({ title: 42 })), /text/)
})

test('an image reference must be an upload name of the right type and size', () => {
  assert.match(brandingProblem(good({ logo: asset({ file: '../../etc/passwd' }) })), /uploaded image name/)
  assert.match(brandingProblem(good({ logo: asset({ file: 'https://evil.example/x.png' }) })), /uploaded image name/)
  assert.match(brandingProblem(good({ logo: asset({ type: 'image/svg+xml' }) })), /does not match/)
  assert.match(brandingProblem(good({ logo: asset({ bytes: 300 * 1024 }) })), /bytes/)
  assert.match(brandingProblem(good({ ogImage: 'x.png' })), /uploaded image or null/)
  assert.equal(brandingProblem(good({ ogImage: asset({ bytes: 900 * 1024 }) })), null)
})

test('clean reads malformed values as unset; keywords are trimmed and de-duplicated', () => {
  const c = cleanBranding({ siteName: '  parker567 ', title: '<b>', themeColor: '#24ee89', keywords: [' Casino ', 'casino', '', 'Sports'], logo: { file: 'nope' }, extra: 1 })
  assert.equal(c.siteName, 'parker567')
  assert.equal(c.title, '')
  assert.equal(c.themeColor, '#24EE89')
  assert.deepEqual(c.keywords, ['Casino', 'Sports'])
  assert.equal(c.logo, null)
  assert.equal('extra' in c, false)
  assert.deepEqual(keywordList('a, b ,, A'), ['a', 'b'])
})

test('diff: one change per field, images by file', () => {
  assert.deepEqual(diffBranding(undefined, EMPTY_BRANDING), [])
  const changes = diffBranding(undefined, good())
  assert.deepEqual(changes.map(c => c.key), ['siteName', 'title', 'keywords', 'logo'])
  assert.equal(changes.find(c => c.key === 'logo').to, `${HASH}.png`)
  assert.deepEqual(diffBranding(good(), good({ logo: null })), [{ kind: 'branding', key: 'logo', from: `${HASH}.png`, to: null }])
})

test('uploads: PNG and WebP by magic bytes, never by name', () => {
  const r = inspectBrandingImage(png(576, 128), 'logo')
  assert.equal(r.ok, true)
  assert.equal(r.type, 'image/png')
  assert.equal(r.width, 576)

  const webp = new Uint8Array(64)
  webp.set(enc('RIFF'), 0)
  webp.set(enc('WEBPVP8X'), 8)
  webp.set([127, 0, 0, 127, 0, 0], 24) // 128 x 128
  const w = inspectBrandingImage(webp, 'mark')
  assert.equal(w.ok, true)
  assert.equal(w.type, 'image/webp')
  assert.equal(w.width, 128)
})

test('uploads: JPEG, GIF, text and junk are refused; size limits per slot', () => {
  const jpeg = new Uint8Array(200).fill(1)
  jpeg.set([0xff, 0xd8, 0xff])
  assert.equal(inspectBrandingImage(jpeg, 'logo').code, 'FORMAT_REFUSED')
  assert.equal(inspectBrandingImage(enc('GIF89a' + 'x'.repeat(100)), 'logo').code, 'FORMAT_REFUSED')
  assert.equal(inspectBrandingImage(enc('hello world, I am not an image at all, really not at all, not even close to one'), 'logo').code, 'NOT_AN_IMAGE')
  assert.equal(inspectBrandingImage(new Uint8Array(10), 'logo').code, 'TOO_SMALL')
  assert.equal(inspectBrandingImage(png(576, 128, 257 * 1024), 'logo').code, 'TOO_LARGE')
  assert.equal(inspectBrandingImage(png(1200, 630, 900 * 1024), 'ogImage').ok, true)
  assert.equal(inspectBrandingImage(new Uint8Array(0), 'logo').code, 'NO_FILE')
})

test('uploads: the mark is square, the logo wider than tall', () => {
  assert.equal(inspectBrandingImage(png(576, 128), 'mark').code, 'BAD_SHAPE')
  assert.equal(inspectBrandingImage(png(128, 128), 'logo').code, 'BAD_SHAPE')
  assert.equal(inspectBrandingImage(png(256, 256), 'mark').ok, true)
  assert.equal(inspectBrandingImage(png(5000, 1000), 'logo').code, 'BAD_SHAPE')
})

test('SVG: an inert one passes, noise is stripped', () => {
  const r = inspectBrandingImage(enc(`<?xml version="1.0"?>\n<!-- made by hand --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 64"><metadata>x</metadata><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h288v64H0z"/></svg>`), 'logo')
  assert.equal(r.ok, true)
  assert.equal(r.type, 'image/svg+xml')
  assert.equal(r.width, 288)
  const text = new TextDecoder().decode(r.data)
  assert.doesNotMatch(text, /<!--|<\?xml|metadata/)
  assert.match(text, /^<svg/)
})

test('SVG: scripts, event attributes and external references are refused', () => {
  const cases = [
    '<script>alert(1)</script>',
    '<SCRIPT >alert(1)</SCRIPT>',
    '<rect onload="alert(1)"/>',
    '<rect\nonclick =\'x\'/>',
    '<a href="javascript:alert(1)"><rect/></a>',
    '<image href="https://evil.example/x.png"/>',
    '<image xlink:href="//evil.example/x.png"/>',
    '<use href="other.svg#a"/>',
    '<rect style="fill:url(https://evil.example/x)"/>',
    '<style>@import url(https://evil.example/x.css);</style>',
    '<foreignObject><div/></foreignObject>',
    '<iframe src="x"/>',
    '<set attributeName="href" to="javascript:alert(1)"/>',
    '<![CDATA[x]]>',
    '<svg><rect/></svg>'
  ]

  for (const body of cases) assert.equal(inspectBrandingImage(svg(body), 'logo').code, 'UNSAFE_SVG', body)
  assert.equal(inspectBrandingImage(enc('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 64"><path d="M0 0"/></svg>'), 'logo').code, 'UNSAFE_SVG')
  assert.equal(sanitiseSvg('<html><svg></svg></html>').ok, false)
  assert.equal(inspectBrandingImage(svg('<image href="data:image/png;base64,iVBORw0KGgo="/>'), 'logo').ok, true)
})

test('the committed parker567 files pass as they are', () => {
  for (const [file, slot] of [['parker567-logo.svg', 'logo'], ['parker567-mark.svg', 'mark'], ['parker567-logo@2x.png', 'logo'], ['parker567-mark@2x.png', 'mark']]) {
    const r = inspectBrandingImage(new Uint8Array(readFileSync(new URL(`../../branding/${file}`, import.meta.url))), slot)
    assert.equal(r.ok, true, `${file}: ${r.reason}`)
  }
})
