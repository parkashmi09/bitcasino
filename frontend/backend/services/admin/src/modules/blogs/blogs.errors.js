'use strict';

const { defineErrors } = require('@ibitplay/common');
const { MAX_UPLOAD_BYTES } = require('../banners/banners.constants');

/**
 * Legacy answered every failure with `{ status: 'error', message }` and a 500
 * for anything it did not anticipate — including a duplicate slug, which is a
 * client-fixable collision, not a server fault.
 *
 * The first five keys match the names `banners/upload.js` throws, because this
 * module reuses its `inspect()`. See the note on that function.
 */
module.exports = defineErrors('BLOGS', {
  NOT_FOUND: { status: 404, message: 'Blog post not found' },

  NO_FILE: { status: 400, message: 'No image was uploaded' },

  NOT_AN_IMAGE: {
    status: 415,
    message: 'That file is not a PNG, JPEG or WebP image',
  },

  FORMAT_REFUSED: {
    status: 415,
    message: 'That image format is not accepted here',
  },

  TOO_LARGE: {
    status: 413,
    message: `An image may not exceed ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
  },

  TOO_SMALL: {
    status: 400,
    message: 'That upload is too small to be an image — it may have been truncated',
  },

  SLUG_TAKEN: {
    status: 409,
    /**
     * Legacy derived the slug from the title plus `Date.now()`, so two posts
     * created in the same millisecond collided on the UNIQUE index and the
     * second got a 500 with a Postgres error string in the body.
     */
    message: 'A post with that address already exists',
  },

  NOTHING_TO_UPDATE: {
    status: 400,
    // Legacy threw a bare `Error('No valid fields to update.')` from inside the
    // repository, which surfaced as a 500.
    message: 'The request changed nothing',
  },

  NO_IMAGE: { status: 404, message: 'That post has no image' },
});
