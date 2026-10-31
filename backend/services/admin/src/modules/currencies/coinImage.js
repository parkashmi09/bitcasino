'use strict';

const { imageUpload } = require('@ibitplay/common');

const errors = require('./currencies.errors');
const { MAX_IMAGE_BYTES } = require('./coinImage.constants');

/**
 * Accepting a coin image: PNG, WebP or SVG, at most 200 KB.
 *
 * PNG and WebP are recognised by their magic bytes (the shared table in
 * `@ibitplay/common/imageUpload`), never by the declared type or filename.
 * JPEG is refused: a coin icon needs transparency.
 *
 * ── SVG ────────────────────────────────────────────────────────────────────
 * The shared uploader refuses SVG on purpose: an SVG is a document and can
 * carry script. Coin artwork is overwhelmingly SVG, so this module accepts it
 * under three conditions:
 *
 *   1. it parses as text whose root is `<svg` (after an optional XML
 *      declaration / comments), with no DOCTYPE or ENTITY (no XXE, no
 *      billion-laughs);
 *   2. nothing active anywhere in it: no `<script>`, no `on*=` handler, no
 *      `javascript:`, no `<foreignObject>` / `<iframe>` / `<embed>` /
 *      `<object>` / `<animate … href>`, no `@import`, and every `href` /
 *      `url(…)` points inside the file (`#id`) or at an inline raster
 *      (`data:image/png|webp|jpeg`) — so it cannot pull or link anything;
 *   3. it is served with `Content-Security-Policy: default-src 'none';
 *      style-src 'unsafe-inline'; sandbox` and `nosniff` (see the image
 *      route), so even opened directly it is an inert picture.
 *
 * Anything failing (2) is refused with `CURRENCIES_UNSAFE_SVG` rather than
 * "cleaned": a sanitiser that rewrites markup is a parser differential away
 * from a bypass, and an operator can re-export a clean file.
 */

const SVG_BANNED = [
  /<\s*script\b/i,
  /<\s*foreignObject\b/i,
  /<\s*(iframe|embed|object|audio|video|canvas|handler|listener)\b/i,
  /<!\s*(DOCTYPE|ENTITY)\b/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /@import\b/i,
  /<\s*(set|animate|animateTransform|animateMotion)\b[^>]*\b(href|attributeName\s*=\s*["']?\s*(href|xlink:href))/i,
];

/** Every `href="…"` / `xlink:href='…'` value and every `url(…)` target. */
function references(text) {
  const out = [];
  for (const m of text.matchAll(/\b(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) out.push(m[2] ?? m[3] ?? m[4] ?? '');
  for (const m of text.matchAll(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi)) out.push(m[2] ?? '');
  return out.map((r) => r.trim());
}

const SAFE_REFERENCE = /^(#[\w.:-]*|data:image\/(png|webp|jpeg);base64,[a-z0-9+/=\s]*)$/i;

/** `{ ok: true }` or `{ ok: false, reason }` for an SVG document's text. */
function checkSvg(text) {
  const body = text.replace(/^﻿/, '').trim();
  // Optional XML declaration and comments before the root element.
  const rest = body.replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  if (!/^<svg[\s>]/i.test(rest)) return { ok: false, reason: 'not an <svg> document' };
  if (!/<\/svg\s*>\s*(?:<!--[\s\S]*?-->\s*)*$/i.test(rest)) return { ok: false, reason: 'unterminated <svg>' };
  for (const pattern of SVG_BANNED) if (pattern.test(rest)) return { ok: false, reason: `banned content (${pattern.source.slice(0, 40)})` };
  const external = references(rest).find((ref) => !SAFE_REFERENCE.test(ref));
  if (external !== undefined) return { ok: false, reason: 'external reference' };
  return { ok: true };
}

/** True when the bytes look like an SVG/XML document (text, starts with `<`). */
function looksLikeSvg(buffer) {
  const head = buffer.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  return head.startsWith('<') && /<svg[\s>]/i.test(buffer.toString('utf8'));
}

/**
 * Inspect an upload; returns `{ data, contentType, byteSize, extension }` or
 * throws in the CURRENCIES namespace.
 */
function inspectCoinImage(file) {
  if (!file || !file.buffer?.length) throw errors.NO_FILE();
  const { buffer } = file;
  if (buffer.length > MAX_IMAGE_BYTES) throw errors.TOO_LARGE({ bytes: buffer.length, limit: MAX_IMAGE_BYTES });
  if (buffer.length < imageUpload.MIN_UPLOAD_BYTES) throw errors.TOO_SMALL({ bytes: buffer.length });

  const detected = imageUpload.sniff(buffer);
  if (detected) {
    if (detected.contentType !== 'image/png' && detected.contentType !== 'image/webp') {
      throw errors.FORMAT_REFUSED({ format: detected.extension });
    }
    return { data: buffer, contentType: detected.contentType, byteSize: buffer.length, extension: detected.extension };
  }

  if (looksLikeSvg(buffer)) {
    const verdict = checkSvg(buffer.toString('utf8'));
    if (!verdict.ok) throw errors.UNSAFE_SVG({ reason: verdict.reason });
    return { data: buffer, contentType: 'image/svg+xml', byteSize: buffer.length, extension: '.svg' };
  }

  throw errors.NOT_AN_IMAGE({
    declaredType: file.mimetype || null,
    declaredName: String(file.originalname || '').slice(0, 80) || null,
  });
}

/** The multer pair for the upload route: one `image` field, 200 KB. */
const singleCoinImage = () => imageUpload.singleImage({ field: 'image', errors, maxBytes: MAX_IMAGE_BYTES });

module.exports = { inspectCoinImage, checkSvg, singleCoinImage, MAX_IMAGE_BYTES };
