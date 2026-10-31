'use strict';

const crypto = require('crypto');
const { imageUpload } = require('@ibitplay/common');

const { MAX_IMAGE_BYTES, RECOMMENDED_IMAGE } = require('./push.constants');

/**
 * Notification images: what the bytes are, how big they are, and whether a
 * URL is one OneSignal (and the browser) can fetch.
 *
 * GIF is accepted here although the shared sniffer does not list it: a push
 * image is a bitmap served with nosniff + a sandbox CSP, like banners, and
 * Chrome shows a GIF's first frame. SVG stays refused (it can carry script).
 */

const GIF = { contentType: 'image/gif', extension: '.gif' };

function sniff(buffer) {
  const shared = imageUpload.sniff(buffer);
  if (shared) return shared;
  if (Buffer.isBuffer(buffer) && buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('latin1');
    if (head === 'GIF87a' || head === 'GIF89a') return GIF;
  }
  return null;
}

/** Width × height from the header, or null. PNG, GIF, JPEG (SOFn), WebP (VP8 / VP8L / VP8X). */
function dimensions(buffer, contentType) {
  try {
    if (contentType === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (contentType === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (contentType === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buffer.length) {
        if (buffer[i] !== 0xff) return null;
        const marker = buffer[i + 1];
        const len = buffer.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (contentType === 'image/webp' && buffer.length >= 30) {
      const chunk = buffer.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buffer.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') {
        return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Plain-language hints for an image that will show, but not well. Never a refusal. */
function sizeHints({ width, height, byteSize }) {
  const hints = [];
  if (width && height) {
    const ratio = width / height;
    if (Math.abs(ratio - RECOMMENDED_IMAGE.ratio) > 0.15) {
      hints.push(`Image is ${width}x${height}; Chrome crops big pictures to 2:1 — ${RECOMMENDED_IMAGE.width}x${RECOMMENDED_IMAGE.height} is recommended.`);
    }
    if (width < 512) hints.push(`Image is only ${width}px wide and will look blurry; ${RECOMMENDED_IMAGE.width}px is recommended.`);
  }
  if (byteSize && byteSize > 500 * 1024) hints.push('Images over 500 KB may load too slowly to be shown on mobile.');
  return hints;
}

/** Inspect an upload: real image bytes, ≤ 1 MB, with its size. Throws in the PUSH namespace. */
function inspectUpload(file, E) {
  if (!file || !file.buffer?.length) throw E.NO_FILE();
  const { buffer } = file;
  if (buffer.length > MAX_IMAGE_BYTES) throw E.TOO_LARGE({ bytes: buffer.length, limit: MAX_IMAGE_BYTES });
  if (buffer.length < imageUpload.MIN_UPLOAD_BYTES) throw E.TOO_SMALL({ bytes: buffer.length });
  const detected = sniff(buffer);
  if (!detected) {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.svg')) throw E.FORMAT_REFUSED({ format: '.svg', reason: 'An SVG can carry script' });
    throw E.NOT_AN_IMAGE({ declaredType: file.mimetype || null });
  }
  const dims = dimensions(buffer, detected.contentType) ?? {};
  return {
    data: buffer,
    contentType: detected.contentType,
    extension: detected.extension,
    byteSize: buffer.length,
    width: dims.width ?? null,
    height: dims.height ?? null,
    tag: crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12),
  };
}

const LOCAL_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|.+\.local|.+\.localhost)$/i;

/**
 * Check a URL that goes into a push (image, icon, button icon).
 *
 * @returns {{ url: string, warnings: string[] }} or throws `E.BAD_URL`.
 * https is required, except a loopback host is ALLOWED WITH A WARNING so a
 * local build can save drafts — OneSignal's servers cannot fetch it, so the
 * notification will arrive without the image.
 */
function checkMediaUrl(raw, E, field = 'imageUrl') {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw E.BAD_URL({ field, reason: 'not an absolute URL' });
  }
  const warnings = [];
  const local = LOCAL_HOSTS.test(u.hostname);
  if (u.protocol !== 'https:') {
    if (!(u.protocol === 'http:' && local)) throw E.BAD_URL({ field, reason: 'must be https://' });
  }
  if (local) warnings.push(`${field}: ${u.host} is not reachable from OneSignal's servers — the push will arrive without this image. Use a public https domain in production.`);
  if (/\.svg($|\?)/i.test(u.pathname)) throw E.BAD_URL({ field, reason: 'SVG images are not shown in notifications' });
  return { url: u.toString(), warnings };
}

/**
 * Turn a click URL into an absolute one. Site paths ('/vip', '#transactions')
 * are joined to the public origin so the click opens inside the site.
 */
function absoluteUrl(raw, origin) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (!origin) return null;
  const base = String(origin).replace(/\/+$/, '');
  if (s.startsWith('#')) return `${base}/${s}`;
  if (s.startsWith('/')) return `${base}${s}`;
  return null;
}

function isLocalOrigin(origin) {
  try {
    return LOCAL_HOSTS.test(new URL(origin).hostname);
  } catch {
    return true;
  }
}

/**
 * Optional reachability probe for an external image URL (admin preview only).
 * A HEAD with a short timeout; failures become warnings, never errors.
 */
async function probeImage(url, fetchImpl = globalThis.fetch, timeoutMs = 4000) {
  const warnings = [];
  try {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      warnings.push(`imageUrl answered HTTP ${res.status} — OneSignal will not be able to fetch it.`);
      return warnings;
    }
    const type = res.headers.get('content-type') || '';
    if (type && !/^image\/(png|jpe?g|webp|gif)/i.test(type)) warnings.push(`imageUrl is served as "${type}", not a PNG/JPEG/WebP/GIF image.`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_IMAGE_BYTES) warnings.push(`imageUrl is ${(len / 1024 / 1024).toFixed(1)} MB; keep push images under 1 MB.`);
  } catch (error) {
    warnings.push(`imageUrl could not be reached from the server (${error.name === 'TimeoutError' ? 'timeout' : error.message}).`);
  }
  return warnings;
}

module.exports = { sniff, dimensions, sizeHints, inspectUpload, checkMediaUrl, absoluteUrl, isLocalOrigin, probeImage };
