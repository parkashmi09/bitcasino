'use strict';

const { defineErrors } = require('@ibitplay/common');
const { MAX_UPLOAD_BYTES } = require('../banners/banners.constants');

module.exports = defineErrors('PROMOTIONS', {
  NOT_FOUND: { status: 404, message: 'Promotion not found' },

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
    message: 'A promotion with that address already exists in this segment',
  },

  NOTHING_TO_UPDATE: {
    status: 400,
    message: 'The request changed nothing',
  },

  NO_IMAGE: { status: 404, message: 'That promotion has no image' },
});
