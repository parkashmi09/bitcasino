'use strict';

const { defineErrors } = require('@ibitplay/common');
const { MAX_UPLOAD_BYTES } = require('./banners.constants');

module.exports = defineErrors('BANNERS', {
  NOT_FOUND: { status: 404, message: 'No banner for that placement' },

  NO_FILE: { status: 400, message: 'No image was uploaded' },

  NOT_AN_IMAGE: {
    status: 415,
    /**
     * Says what was wrong without echoing the bytes back. The declared type is
     * in `details` for the operator; the reason it was refused is that the
     * CONTENT did not match any format we serve.
     */
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
    // A truncated upload is far more common than a malicious one and produces
    // a broken image on the home page if it is stored.
    message: 'That upload is too small to be an image — it may have been truncated',
  },

  BAD_TYPE: {
    status: 400,
    message: 'A placement name may contain only lowercase letters, digits, dash and underscore',
  },
});
