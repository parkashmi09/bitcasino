'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('BRANDING', {
  NO_FILE: { status: 400, message: 'Send the image as the form field "image"' },
  TOO_LARGE: { status: 413, message: 'The image is too large' },
});
