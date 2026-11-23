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

/** Who sees a placement: `agent-…` placements are agent mode's (/agent), every other one the direct players' site. */
const AGENT_PREFIX = 'agent-';
const modeOf = (type) => (String(type).startsWith(AGENT_PREFIX) ? 'agent' : 'direct');

/**
 * The placements the player site draws BUILT-IN art for while nothing is uploaded: agent mode's
 * four game slides (frontend-next spa/hooks/useHeroSlides.js, /brand/agent/slide-<n>.webp). Each
 * is its own slot: an upload replaces only that one, and a built-in can be hidden on its own — a
 * row with no image and `is_active = false` is that "hidden" marker. Stake's direct site has no
 * built-in hero art, so no direct placement is listed (admin Banners.tsx BUILTINS must match).
 */
const BUILTIN_PLACEMENTS = Object.freeze([
  'agent-slider-1',
  'agent-slider-2',
  'agent-slider-3',
  'agent-slider-4',
]);

module.exports = {
  BUILTIN_PLACEMENTS,
  AGENT_PREFIX,
  modeOf,
  IMAGE_SIGNATURES,
  REJECTED_FORMATS,
  MAX_UPLOAD_BYTES,
  MIN_UPLOAD_BYTES,
  CACHE_SECONDS,
  TYPE_PATTERN,
};
