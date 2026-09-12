'use strict';

const { imageUpload } = require('@ibitplay/common');

const errors = require('./banners.errors');

/**
 * Accepting a banner upload.
 *
 * The signature table, the memory-storage reasoning and the content check all
 * moved to `@ibitplay/common/imageUpload` once a third module needed them —
 * banners, blogs and p2p all take an image from a client, and all three carried
 * the same legacy defect: the format was judged from `file.mimetype` or
 * `path.extname(file.originalname)`, both chosen by whoever was uploading, and
 * the bytes were never opened.
 *
 * What stays here is what is banner-specific: the error namespace, so a
 * refusal reads `BANNERS_NOT_AN_IMAGE`.
 */

const { sniff } = imageUpload;

/** Inspect a banner upload, throwing in the `BANNERS` namespace. */
function inspect(file, E = errors) {
  return imageUpload.inspect(file, E);
}

/** The middleware pair every banner upload route uses. */
const single = (field = 'image') => imageUpload.singleImage({ field, errors });

module.exports = { single, sniff, inspect };
