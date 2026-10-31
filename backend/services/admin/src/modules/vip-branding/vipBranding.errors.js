'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('VIP_BRANDING', {
  NOT_FOUND: { status: 404, message: 'No badge for that card' },
  UNKNOWN_LEVEL: { status: 404, message: 'That level is not on the VIP ladder' },
  BAD_THRESHOLD: { status: 422, message: 'A level threshold must be above the level below it and below the level above it' },
  LAST_LEVEL: { status: 422, message: 'At least one VIP level must stay on' },
  BUILT_IN_LEVEL: { status: 422, message: 'A built-in level can be switched off but not deleted' },
  LADDER_FULL: { status: 422, message: 'The VIP ladder cannot take more levels' },
  BAD_CARD: { status: 422, message: 'That tier is not on this ladder' },
  PERK_NOT_FOUND: { status: 404, message: 'No such perk' },
  NO_FILE: { status: 400, message: 'No image was uploaded' },
  NOT_AN_IMAGE: { status: 415, message: 'That file is not a PNG, JPEG or WebP image' },
  FORMAT_REFUSED: { status: 415, message: 'That image format is not accepted here' },
  TOO_LARGE: { status: 413, message: 'A badge may not exceed 1 MB' },
  TOO_SMALL: { status: 400, message: 'That upload is too small to be an image — it may have been truncated' },
});
