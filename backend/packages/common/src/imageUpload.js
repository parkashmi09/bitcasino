'use strict';

const multer = require('multer');

/**
 * Accepting an uploaded image — the shared implementation.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS IN `common` AND NOT IN A MODULE
 *
 * THREE modules across TWO services take an image from a client:
 *
 *   admin-service  banners   the home-page hero
 *   admin-service  blogs     the article cover
 *   user-service   p2p       payment proofs, QR codes, dispute screenshots
 *
 * Every one of them was the same defect in legacy — the format was judged from
 * `file.mimetype` (the client's declared Content-Type) or from
 * `path.extname(file.originalname)` (the client's filename), and the bytes were
 * never opened. So a request declaring `image/png` while naming the file
 * `x.html` was written to a statically-served directory and served from the
 * platform's own origin.
 *
 * One signature table, in one place. Three copies would drift, and a format
 * accepted in one copy and refused in another is a hole that opens the moment
 * somebody adds a format to the wrong file.
 *
 * Domain-specific things stay in the modules: their own error namespaces (a
 * blog failure should read `BLOGS_*`), their own size limits where they differ,
 * and what they do with the bytes afterwards.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * The signatures we accept, and what each one really is.
 *
 * Matching on magic bytes rather than the declared MIME type or the filename
 * closes the case where a client sends `Content-Type: image/png` over something
 * that is not a PNG. The stored content type comes from THIS table, so what is
 * served back is what was actually detected.
 */
const IMAGE_SIGNATURES = Object.freeze([
  {
    contentType: 'image/png',
    extension: '.png',
    // \x89 P N G \r \n \x1a \n — the full 8-byte signature, including the
    // CRLF/EOF trap bytes that catch a transfer mangled by a text-mode proxy.
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    offset: 0,
  },
  {
    contentType: 'image/jpeg',
    extension: '.jpg',
    // SOI marker. Every JPEG starts FF D8 FF regardless of JFIF/Exif flavour.
    bytes: [0xff, 0xd8, 0xff],
    offset: 0,
  },
  {
    contentType: 'image/webp',
    extension: '.webp',
    // 'WEBP' at offset 8, inside the RIFF container. The RIFF magic alone is
    // shared with AVI and WAV, so the check has to reach past it.
    bytes: [0x57, 0x45, 0x42, 0x50],
    offset: 8,
  },
]);

/**
 * Deliberately NOT accepted: SVG.
 *
 * An SVG is a document, not a bitmap. It can carry `<script>`, and served from
 * the platform's own origin that is stored cross-site scripting on the page
 * where players type their password. Legacy's extension whitelist excluded it
 * by accident; this excludes it on purpose, and the reason is written down so
 * nobody adds it back as an obvious omission.
 */
const REJECTED_FORMATS = Object.freeze({
  '.svg': 'An SVG can carry script and would run on the platform origin',
});

/** 4 MB. Generous for a hero image or a payment screenshot. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Smaller than any real image header — a truncated or empty upload. */
const MIN_UPLOAD_BYTES = 64;

/**
 * What these bytes actually are.
 *
 * Reads the CONTENT. The filename and the declared MIME type are both chosen by
 * whoever is uploading, so neither is evidence.
 *
 * @returns {{contentType: string, extension: string}|null} null if it matches nothing we serve.
 */
function sniff(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  for (const format of IMAGE_SIGNATURES) {
    const { bytes, offset } = format;
    if (buffer.length < offset + bytes.length) continue;
    if (bytes.every((byte, i) => buffer[offset + i] === byte)) {
      return { contentType: format.contentType, extension: format.extension };
    }
  }
  return null;
}

/**
 * Turn a multer file into something safe to store, or throw.
 *
 * @param file a multer file with `.buffer` (memory storage — see below).
 * @param E the caller's error set. Must define NO_FILE, TOO_LARGE, TOO_SMALL,
 *   FORMAT_REFUSED and NOT_AN_IMAGE. Each module passes its own so failures
 *   read in that module's namespace rather than a shared one.
 * @param maxBytes override for a module whose limit genuinely differs.
 */
function inspect(file, E, { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  if (!E?.NOT_AN_IMAGE) {
    // A programming error, not a request error — caught at first use rather
    // than surfacing as `E.NO_FILE is not a function` inside a money path.
    throw new Error('inspect() needs an error set with NO_FILE/TOO_LARGE/TOO_SMALL/FORMAT_REFUSED/NOT_AN_IMAGE');
  }

  if (!file || !file.buffer?.length) throw E.NO_FILE();

  const { buffer } = file;

  if (buffer.length > maxBytes) throw E.TOO_LARGE({ bytes: buffer.length });
  if (buffer.length < MIN_UPLOAD_BYTES) throw E.TOO_SMALL({ bytes: buffer.length });

  const detected = sniff(buffer);

  if (!detected) {
    /**
     * Name the refused format when we recognise it, so an operator uploading an
     * SVG is told why rather than left guessing at a generic "not an image".
     */
    const claimed = String(file.originalname || '').toLowerCase();
    for (const [extension, reason] of Object.entries(REJECTED_FORMATS)) {
      if (claimed.endsWith(extension)) throw E.FORMAT_REFUSED({ format: extension, reason });
    }

    throw E.NOT_AN_IMAGE({
      // What the client SAID it was, kept distinct from what it is.
      declaredType: file.mimetype || null,
      declaredName: claimed.slice(0, 80) || null,
    });
  }

  return {
    data: buffer,
    contentType: detected.contentType,
    byteSize: buffer.length,
    extension: detected.extension,
  };
}

/**
 * The multer instance.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MEMORY, NOT DISK
 *
 * Legacy used `multer.diskStorage` everywhere, which writes the file out BEFORE
 * any handler runs. Two consequences it lived with:
 *
 *   - a rejected upload had already been written. The `fileFilter` ran on the
 *     filename or the declared type, so anything claiming to be a PNG reached
 *     the disk whatever it contained, and only the database row was skipped.
 *     The bytes stayed.
 *
 *   - the file was on ONE server's disk. Nothing else could serve it, and a
 *     restart lost it.
 *
 * `memoryStorage` keeps the bytes in the request until the handler has decided
 * they are real, and the limits are what stop "in memory" from meaning
 * "unbounded".
 * ─────────────────────────────────────────────────────────────────────────
 */
function createUploader({ maxBytes = MAX_UPLOAD_BYTES } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes,
      // One image, one field. Without these a single request may carry hundreds
      // of parts, each up to fileSize.
      files: 1,
      fields: 20,
      parts: 24,
    },
  });
}

/**
 * Multer's own errors are not HTTP errors.
 *
 * Without this a file one byte over the limit surfaces as an unhandled
 * `MulterError` and the client gets a 500 for something entirely their fault.
 */
function createUploadErrorHandler(E, maxBytes = MAX_UPLOAD_BYTES) {
  return function handleUploadErrors(err, _req, _res, next) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(E.TOO_LARGE({ limit: maxBytes }));
      return next(E.NO_FILE({ reason: err.code }));
    }
    return next(err);
  };
}

/**
 * The middleware pair an upload route uses: parse, then translate the failures.
 *
 * @returns an array to spread into the route — `...singleImage({errors: E})`.
 */
function singleImage({ field = 'image', errors, maxBytes = MAX_UPLOAD_BYTES } = {}) {
  const uploader = createUploader({ maxBytes });
  return [uploader.single(field), createUploadErrorHandler(errors, maxBytes)];
}

module.exports = {
  IMAGE_SIGNATURES,
  REJECTED_FORMATS,
  MAX_UPLOAD_BYTES,
  MIN_UPLOAD_BYTES,
  sniff,
  inspect,
  createUploader,
  createUploadErrorHandler,
  singleImage,
};
