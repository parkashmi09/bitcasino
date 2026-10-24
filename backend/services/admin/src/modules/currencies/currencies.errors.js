'use strict';

const { defineErrors } = require('@ibitplay/common');

const { MAX_IMAGE_BYTES } = require('./coinImage.constants');

module.exports = defineErrors('CURRENCIES', {
  NOT_FOUND: { status: 404, message: 'No coin with that code' },
  NO_IMAGE: { status: 404, message: 'That coin has no image' },
  RETIRED: { status: 409, message: 'A retired coin cannot be switched on' },
  UNKNOWN_NETWORK: { status: 400, message: 'That network is not one of this coin’s networks' },
  HOUSE_ONLY: { status: 403, message: 'Coins are managed by the house, not agent accounts' },

  NO_FILE: { status: 400, message: 'No image was uploaded' },
  NOT_AN_IMAGE: { status: 415, message: 'That file is not a PNG, SVG or WebP image' },
  FORMAT_REFUSED: { status: 415, message: 'That image format is not accepted for a coin (PNG, SVG or WebP)' },
  UNSAFE_SVG: { status: 415, message: 'That SVG carries script, external references or other active content' },
  TOO_LARGE: { status: 413, message: `A coin image may not exceed ${Math.round(MAX_IMAGE_BYTES / 1024)} KB` },
  TOO_SMALL: { status: 400, message: 'That upload is too small to be an image — it may have been truncated' },
});
