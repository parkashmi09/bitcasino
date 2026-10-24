'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('PREFERENCES', {
  UNKNOWN_THEME: { status: 422, message: 'That theme is not available' },
  UNKNOWN_LANGUAGE: { status: 422, message: 'That language is not available' },
  NOTHING_TO_UPDATE: { status: 400, message: 'The request changed nothing' },
  /**
   * Legacy answered `socket.emit("identify-error", "uid must be a number")` —
   * on an event whose whole problem was that a number was all it required.
   */
  NOT_PERMITTED: { status: 403, message: 'You cannot read another player’s settings' },
});
