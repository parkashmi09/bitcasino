'use strict';

const { imageUpload } = require('@ibitplay/common');

/**
 * Banner constants.
 *
 * ── THE UPLOAD RULES ARE NOT HERE ────────────────────────────────────────
 *
 * The signature table, the SVG refusal and the size bounds moved to
 * `@ibitplay/common/imageUpload` once a third module needed them — banners,
 * blogs and p2p all take an image from a client, and all three had the same
 * legacy defect: the format judged from `file.mimetype` or from
 * `path.extname(file.originalname)`, both chosen by whoever was uploading.
 *
 * They are re-exported so existing callers keep working, and so there is
 * exactly ONE answer to "how large may an image be" across the platform.
 */
const { IMAGE_SIGNATURES, REJECTED_FORMATS, MAX_UPLOAD_BYTES, MIN_UPLOAD_BYTES } = imageUpload;

/**
 * How long a browser may cache a banner.
 *
 * Five minutes: long enough that the home page is not re-fetching hero images
 * on every navigation, short enough that an operator replacing a banner sees it
 * change without being told to hard-refresh.
 */
const CACHE_SECONDS = 300;

/** Placement names are an identifier, not free text. */
const TYPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

module.exports = {
  IMAGE_SIGNATURES,
  REJECTED_FORMATS,
  MAX_UPLOAD_BYTES,
  MIN_UPLOAD_BYTES,
  CACHE_SECONDS,
  TYPE_PATTERN,
};
