'use strict';

const { imageUpload } = require('@ibitplay/common');
const { checkSvg } = require('../currencies/coinImage');

/**
 * The owner's branding block (docs/OWNER-PANEL.md §8), as the backend believes it.
 *
 * Mirrors owner-panel/src/lib/entitlements/branding.ts: the same fields and limits. The owner
 * panel validates strictly on save; here a malformed field simply reads as unset, so a bad
 * value can never reach a <title>, a <meta> or an image URL, and the rest still applies.
 */

const TEXT_LIMITS = Object.freeze({
  siteName: 40,
  title: 70,
  titleTemplate: 80,
  description: 300,
  ogTitle: 90,
  ogDescription: 300,
});

const SLOTS = Object.freeze(['logo', 'mark', 'ogImage']);
const MAX_IMAGE_BYTES = Object.freeze({ logo: 256 * 1024, mark: 256 * 1024, ogImage: 1024 * 1024 });
const MIN_IMAGE_BYTES = 64;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 40;

const ASSET_FILE_RE = /^[0-9a-f]{64}\.(png|webp|svg)$/;
const CONTENT_TYPES = Object.freeze({ png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' });
const BAD_TEXT = /[<>\u0000-\u001f\u007f]/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function cleanAsset(a, slot) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  if (typeof a.file !== 'string' || !ASSET_FILE_RE.test(a.file)) return null;
  const type = CONTENT_TYPES[a.file.split('.')[1]];
  if (a.type !== type) return null;
  if (!Number.isInteger(a.bytes) || a.bytes < MIN_IMAGE_BYTES || a.bytes > MAX_IMAGE_BYTES[slot]) return null;
  const side = (v) => (Number.isInteger(v) && v >= 1 && v <= 4096 ? v : undefined);
  return { file: a.file, type, bytes: a.bytes, width: side(a.width), height: side(a.height) };
}

/**
 * The href a floating chat button opens, or '' when the value is neither (site admin →
 * Site config → Branding). A number: + and 6–15 digits, spaces and dashes dropped. A link: https
 * on the app's own hosts. Telegram also takes @username.
 */
function chatLink(kind, value) {
  const raw = str(value);
  if (/^\+?[\d\s-]+$/.test(raw)) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return '';
    return kind === 'telegram' ? `https://t.me/+${digits}` : `https://wa.me/${digits}`;
  }
  if (kind === 'telegram' && /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(raw)) return `https://t.me/${raw.replace(/^@/, '')}`;
  if (raw.length > 300) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const hosts = kind === 'telegram' ? ['t.me', 'telegram.me'] : ['wa.me', 'whatsapp.com'];
    const ours = hosts.includes(host) || (kind === 'whatsapp' && host.endsWith('.whatsapp.com'));
    return url.protocol === 'https:' && ours ? url.href : '';
  } catch {
    return '';
  }
}

/** Every field, well-formed or unset. `null` when the document has no branding (not branded). */
function cleanBranding(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    const v = str(input[key]);
    out[key] = v.length <= max && !BAD_TEXT.test(v) ? v : '';
  }
  if (out.titleTemplate && out.titleTemplate.split('%s').length !== 2) out.titleTemplate = '';
  const words = [];
  for (const k of Array.isArray(input.keywords) ? input.keywords : []) {
    const w = str(k).replace(/\s+/g, ' ');
    if (w && w.length <= MAX_KEYWORD_LENGTH && !BAD_TEXT.test(w) && !words.some((o) => o.toLowerCase() === w.toLowerCase())) words.push(w);
  }
  out.keywords = words.slice(0, MAX_KEYWORDS);
  const color = str(input.themeColor);
  out.themeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : '';
  for (const slot of SLOTS) out[slot] = cleanAsset(input[slot], slot);
  // Which floating chat buttons the site admin may show (owner panel → Branding).
  out.whatsappEnabled = input.whatsappEnabled === true;
  out.telegramEnabled = input.telegramEnabled === true;
  return out;
}

/**
 * Are these the bytes the document promised, and an image we serve? The name is the SHA-256 of
 * the content (checked by the caller); here: PNG / WebP by magic bytes, else an inert SVG (the
 * coin image rules), within the slot's size. Returns a reason, or null when acceptable.
 */
function imageProblem(buffer, file, slot) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_IMAGE_BYTES) return 'too small';
  if (buffer.length > MAX_IMAGE_BYTES[slot]) return 'too large';
  const ext = file.split('.')[1];
  const sniffed = imageUpload.sniff(buffer);
  if (ext === 'png' || ext === 'webp') {
    return sniffed?.contentType === CONTENT_TYPES[ext] ? null : `not a ${ext.toUpperCase()}`;
  }
  if (sniffed) return 'an SVG name on a raster file';
  const verdict = checkSvg(buffer.toString('utf8'));
  return verdict.ok ? null : `unsafe SVG (${verdict.reason})`;
}

module.exports = { TEXT_LIMITS, SLOTS, MAX_IMAGE_BYTES, MAX_KEYWORDS, MAX_KEYWORD_LENGTH, ASSET_FILE_RE, CONTENT_TYPES, BAD_TEXT, cleanBranding, imageProblem, chatLink };
